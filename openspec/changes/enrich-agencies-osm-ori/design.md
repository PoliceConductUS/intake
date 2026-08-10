## Context

Slice 1 (`intake run`, config-driven sources) landed **Personnel-only** for the AZ POST
roster. This slice adds **Agencies + AgencyPersonnel** from the same roster and solves the
blocker that surfaced: the roster has an agency **name** but no address/coordinates.

Verified constraints (from code + the live dev DB):

- **Creating an Agency requires** `location_path_id` + `latitude` + `longitude` + `slug`
  (`AgencyCreateSpec`). Given only `{name, state}`, agency preparation **throws before any
  geocoding** — it needs `address`/`city`/`zip_code`, or a directly-supplied
  `location_path_id` + `lat`/`lng` (the escape hatch). `slug` derives from `name`.
- **The location target exists.** `public.location_path` holds Arizona as
  `state_or_territory_slug = 'az'`: **1 state, 15 counties, 467 places**; most places carry
  a `centroid` (Phoenix's is null). So real AZ `location_path_id`s exist to attach to.
- **AZ agencies are essentially absent.** `public.agency` has 3,403 rows but **1 in AZ** —
  this slice creates them. Columns: `name, city, state, address, zip_code, contact_name,
contact_email, slug, location_path_id, latitude, longitude`. Phone/email/url/social lists
  live in the related-table maps `AgencySpec` exposes (`emails`, `phones`, `urls`,
  `addresses`).
- **The officer↔agency link is easy** (verified): `AgencyPersonnel.agency_id`/`personnel_id`
  are source-local keys the pipeline mints canonical IDs for from the same envelope; no DB
  lookup. `license_type` is free text; `start_date`/`end_date` need `YYYY-MM-DD`; the
  pipeline topologically orders Agencies+Personnel before AgencyPersonnel.

User goal: **maximize agency data** — address, phone, email, social, coordinates — resolved
**by name**, **OpenStreetMap/Nominatim first, then ORI/NCIC**.

## Goals / Non-Goals

**Goals**

- AZ POST `run` emits `Agencies` (name, state) + `AgencyPersonnel` alongside `Personnel`.
- A **name-based agency enrichment resolver** (Nominatim → LEAIC/ORI) that yields
  `location_path_id`, coordinates, address, and contact/social — enough to create the agency
  and enrich it.
- **Cached, deterministic decisions**: resolve each unique agency once; persist with
  provenance; replay reads the cache and never re-calls an external service.
- A **correction path** for mismatches (confidence + the visitor-correction loop).

**Non-Goals (this slice)**

- National scale / self-hosted Nominatim (AZ is a few hundred agencies).
- Deep social-media scraping beyond OSM tags.
- Making the ORI registry its own agency-source (approach B) — a later evolution.
- Any source other than AZ POST.

## Decisions

### D1. Approach A — the roster creates + enriches agencies.

The AZ POST `run` emits `Agencies` by name; enrichment happens intake-side. (Approach B — a
dedicated ORI registry source that agencies are matched to — is the later evolution.)

### D2. Enrichment is an intake-side resolver, not source code.

Per ADR 0014, resolvers own `ResolvedProperty` state and sources must not. The AZ POST `run`
stays deterministic (emits only `{name, state}`); a **new intake-side agency enrichment
stage** runs during agency preparation **before** the existing missing-field check that
throws on absent address, and populates the missing fields.

### D3. Provider chain, cached with provenance.

Per unique agency `(name, state)`: **Nominatim first** (coords + address components +
`phone`/`website`/`contact:email`/`contact:facebook`/`twitter` tags) → **LEAIC/ORI second**
(authoritative ORI + FIPS place for jurisdiction, and identity validation). Merge into one
decision, persisted as a `ResolvedProperty` with provenance (query, `osm_id`/`ORI`,
fetched-at). Replay reads the cache; it never re-calls. Nominatim policy: ~1 req/s + a real
User-Agent; keyed by unique agency so it's hundreds of calls, not 84k.

### D4. Location vs. contact — division of labor (max reuse).

- **`location_path_id`**: from the resolved **place** — match place-from-name against the
  467 AZ `location_path` places, and/or LEAIC `ORI→FIPS place`.
- **coordinates**: from Nominatim (real point); fall back to the place `centroid` where
  present (some places, e.g. Phoenix, have none — so Nominatim coords are needed, not just
  centroids).
- **address + contact/social**: from Nominatim, into `address/city/zip_code/contact_email`
  and the `emails`/`phones`/`urls` maps.
- **Reuse:** when Nominatim yields a full address, prefer feeding `{address, city, state,
zip}` and letting the **existing** address→location resolver derive `location_path_id` +
  coords (least new code), rather than re-implementing that path.

### D5. Matching quality + corrections.

Each resolution carries a **confidence**; low-confidence/ambiguous matches (substations,
renamed departments) are quarantined to the visitor-correction loop rather than silently
trusted. `osm_id` / `ORI` / place identity are stable anchors for a pinned correction.

### D6. AZ POST field mapping (the `run` change).

- `Agencies` — key = the `AGENCY` string; spec `{ name: AGENCY, state: "AZ" }`.
- `AgencyPersonnel` — key = `${POST ID}:${AGENCY}:${APPOINTED ON}` (unique per stint; a bare
  POST ID would drop an officer's multiple agencies); spec `{ agency_id: AGENCY,
personnel_id: POST ID, start_date: <APPOINTED ON → YYYY-MM-DD>, end_date: <TERMINATED ON →
YYYY-MM-DD | null>, license_type: <CERT TYPE> }`.
- `Personnel` — unchanged from Slice 1.
- One `SourceManifest` with all three kinds; the pipeline orders them.

## Risks / Trade-offs

- **Nominatim rate/policy** → cache by unique agency; self-host when national. Mitigated by D3.
- **Name→POI mismatch** → confidence + corrections + ORI anchor (D5).
- **LEAIC vintage (2012) + ICPSR access/licensing** → use it for FIPS jurisdiction only;
  evaluate the FBI Crime Data Explorer agency list as a current alternative (Open Question).
- **Places without a centroid** (Phoenix) → coordinates must come from Nominatim; never rely
  on centroid alone.
- **Determinism leak** → external calls must be cached-once and must never run inside the
  source `run` (D2). Enforced structurally by keeping enrichment in the resolver seam.

## Open Questions

- **ORI dataset choice + access.** LEAIC (ICPSR study 35158, 2012) gives `ORI→FIPS
state/county/place` but is dated and ICPSR-gated. Is the **FBI Crime Data Explorer** agency
  list (current, county + coordinates) a better primary ORI source? Confirm the exact
  dataset, license, and refresh cadence.
- **FIPS → `location_path` join.** `location_path` exposes slugs/names + a `path`, not an
  obvious FIPS column. How do we map a LEAIC FIPS place code to a `location_path_id`? (Likely
  via the census-gazetteer source's data, which is FIPS-derived — needs a lookup.)
- **Social-media coverage.** OSM `contact:*` tags are sparse. Is Nominatim enough for
  "social media, etc.", or is agency-website discovery a later sub-slice?
- **Address-vs-direct integration.** Supply Nominatim's full address and reuse the existing
  census location resolver, or supply `location_path_id` + coords directly (escape hatch)?
  (Lean: address + contact from Nominatim; reuse existing resolver for location/coords.)
- **Confidence threshold + where the quarantine/correction record lives.**
- **Scope of "other records".** Beyond Agencies/AgencyPersonnel, does `CERTIFICATION`/`TERM
DESC` warrant its own record kind, or fold into AgencyPersonnel/notes for now?
