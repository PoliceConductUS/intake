## Context

Slice 1 (`intake run`, config-driven sources) landed **Personnel-only** for the AZ POST
roster. This slice adds **Agencies + AgencyPersonnel** and solves the blocker that surfaced:
the roster has an agency **name** but no address/coordinates, and the pipeline cannot create
an agency from name alone.

**Strategy shift (this revision):** rather than reconstruct agency address/contact from
third-party services, we **request it from the authoritative source** — a public-records
request to AZPOST for its agency directory (drafted:
`intake.gov.az.post/2026-08-10-AZPOST Form PR - Agency Directory Request.pdf`, asking for
name, ORI, type, street + mailing address, city/state/zip, county, phone, email, website).
That makes the **FOIA-delivered agency directory the primary path** — imported exactly like
the roster — and demotes the OSM/Nominatim + ORI enrichment resolver to a **fallback** for
whatever the directory doesn't cover.

Verified constraints (code + live dev DB):

- **Creating an Agency requires** `location_path_id` + `latitude` + `longitude` + `slug`
  (`AgencyCreateSpec`). From `{name, state}` alone, preparation **throws**. BUT with a full
  **address** (`address`, `city`, `state`, `zip_code`) the **existing** pipeline resolves
  `location_path_id` + coordinates automatically (census resolver, cached). `slug` derives
  from `name`. So a directory that includes addresses needs **no new resolver**.
- **The location target exists.** `location_path` holds AZ as `state_or_territory_slug='az'`:
  1 state, 15 counties, **467 places** (most with a `centroid`; Phoenix's is null).
- **AZ agencies are essentially absent.** `agency` has 3,403 rows but **1 in AZ** — this
  slice creates them. Columns: `name, city, state, address, zip_code, contact_name,
contact_email, slug, location_path_id, latitude, longitude`; phone/email/url/social lists
  live in the `AgencySpec` maps (`emails`, `phones`, `urls`, `addresses`).
- **The officer↔agency link is easy** (verified): `AgencyPersonnel.agency_id`/`personnel_id`
  are source-local keys the pipeline mints canonical IDs for from the same envelope; no DB
  lookup. `license_type` is free text; `start_date`/`end_date` need `YYYY-MM-DD`; the pipeline
  topologically orders Agencies+Personnel before AgencyPersonnel.

## Goals / Non-Goals

**Goals**

- Import a FOIA-delivered **agency directory** (AZPOST) as a source, creating `Agencies` with
  address/contact — reusing the existing address→location resolver, no new pipeline code.
- Emit `AgencyPersonnel` from the **roster** so officers link to their employing agencies.
- Keep a **fallback** design (OSM/Nominatim → ORI/LEAIC, cached) for agencies the directory
  doesn't cover — built only if/when gaps remain.

**Non-Goals (this slice)**

- Building the enrichment resolver up front (it's fallback; defer until a real gap exists).
- National scale / self-hosted Nominatim; deep social-media scraping.
- Making ORI its own registry source (approach B) — later evolution.

## Decisions

### D1. Primary path — import the authoritative agency directory like the roster.

When AZPOST returns the directory (xlsx/csv), it becomes an `intake run` source (e.g.
`gov.azpost.agencies`) whose `run` maps columns → `Agencies` records:
`{ name, state, address, city, zip_code, contact_email, ... }` keyed by the same agency name
the roster uses. Deterministic, authoritative, and — because it carries addresses — the
existing pipeline finishes `location_path_id` + coordinates with **no new resolver**.

### D2. Reuse the existing pipeline; add no agency-resolution code for the primary path.

A directory row with `address/city/state/zip` flows through the current
`agency-address-resolution` → census resolver (cached) to get `location_path_id` + coords.
Contact/social land in `contact_email` + the `emails`/`phones`/`urls` maps. The only new code
is a source config (like Slice 1), not pipeline changes.

### D3. The roster provides the officer↔agency links.

The AZ POST roster `run` emits `AgencyPersonnel` (and references `Agencies` by name). Agency
identity is keyed by the **agency name string** shared between the roster and the directory,
so both resolve to the same canonical agency via `SourceNameToCanonicalId`.

### D4. The OSM/Nominatim + ORI resolver is a FALLBACK, deferred.

For agencies the directory omits (no address, out-of-state, defunct, or roster names with no
directory match), a name-based enrichment resolver (Nominatim first for coords/address/contact,
then ORI/LEAIC for authoritative id + FIPS place) fills the gap. It runs intake-side, resolves
each unique agency **once**, and persists a cached `ResolvedProperty` with provenance; replay
reads the cache. Build it only when a measured gap requires it — not up front.

### D5. Field mapping.

- **Agencies** (from directory) — key = agency name; `{ name, state:"AZ", address, city,
zip_code, contact_email, ... }` (+ phones/emails/urls maps).
- **AgencyPersonnel** (from roster) — key = `${POST ID}:${AGENCY}:${APPOINTED ON}`; `{ agency_id:
AGENCY, personnel_id: POST ID, start_date: <APPOINTED ON → YYYY-MM-DD>, end_date: <TERMINATED
ON → YYYY-MM-DD | null>, license_type: <CERT TYPE> }`.
- **Personnel** — unchanged from Slice 1.

### D6. Name matching between roster and directory.

Both key agencies by the AGENCY name string. If the directory's official names differ from the
roster's (e.g. "Tempe PD" vs "Tempe Police Department"), that's a name-matching problem →
handled by the cached-decision + visitor-correction pillar. Prefer requesting the directory
keyed to the same agency labels the roster uses (or include both).

## Risks / Trade-offs

- **FOIA timing/coverage** → the primary path is blocked until AZPOST responds, and may omit
  some agencies or fields. Mitigation: the roster `run` change (AgencyPersonnel + Agencies-by-
  name) can be built now; agencies create once _either_ the directory arrives _or_ the fallback
  resolver fills a gap.
- **Directory lacks addresses for some agencies** → those fall to the fallback resolver (D4).
- **Roster ↔ directory name mismatch** → D6 (matching + corrections); ask AZPOST to key the
  directory to roster agency labels.
- **Determinism** (fallback only) → external lookups cached-once, never inside a source `run`.

## Open Questions

- **Does the returned directory include street addresses for every agency?** Determines how
  much (if any) fallback resolver is needed. Resolve on FOIA return.
- **Roster vs directory agency labels** — same strings, or do we need a match step? (D6.)
- **ORI dataset for the fallback** — LEAIC (ICPSR 2012, gated) vs FBI Crime Data Explorer
  (current). Decide only if/when the fallback is built.
- **"Other records"** — does `CERTIFICATION`/`TERM DESC` warrant its own kind, or fold into
  AgencyPersonnel for now?
- **Sequencing** — build the roster `run` change (AgencyPersonnel) now and hold agency creation
  until the directory arrives, or wait for the directory before touching the roster?
