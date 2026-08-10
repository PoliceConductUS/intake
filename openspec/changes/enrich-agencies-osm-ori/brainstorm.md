## Design Summary

Extend the AZ POST source to emit **Agencies + AgencyPersonnel** (not just Personnel), and
add a **name-based agency enrichment resolver** so agencies — which the roster gives only by
name — can be created with a real `location_path_id` + coordinates and enriched with
address, phone, email, and social. Resolution runs **OpenStreetMap/Nominatim first, then
ORI/NCIC (LEAIC)**, cached as a `ResolvedProperty` (deterministic replay), with a
visitor-correction loop for mismatches.

Full detail, verified facts, decisions (D1–D6), risks, and open questions are in `design.md`.

## Alternatives Considered

### Approach A: Roster creates + enriches agencies — CHOSEN

- The AZ POST `run` emits `Agencies` by name; an intake-side resolver fills
  location/coords/contact from Nominatim → LEAIC. One source, immediate graph.
- **Why selected:** gets the officer↔agency graph and rich data flowing from the roster we
  already have; the authoritative ORI registry can be layered in later as backfill.

### Approach B: Dedicated ORI-registry source owns agencies; roster only links

- Cleaner authoritative origin, but the roster's agency names must be matched to registry
  agencies (a name-matching problem).
- **Why not now:** more upfront machinery; naturally becomes the evolution of A once the ORI
  registry is ingested as its own source.

## Agreed Approach

Approach A, delivered as an intake-side, cached enrichment resolver (ADR 0014) plus the
AZ POST `run` field mapping in `design.md` §D6. The source stays deterministic (emits
`{name, state}` only); the resolver owns all external lookups and `ResolvedProperty` state.

## Key Decisions

- Nominatim first (coords/address/contact/social tags), then LEAIC/ORI (ORI + FIPS place →
  jurisdiction, identity validation). Merge, cache once per unique agency, replay from cache.
- `location_path_id` from the resolved place (467 AZ places exist); coordinates from
  Nominatim (place centroids are incomplete — e.g. Phoenix — so not sufficient alone).
- `AgencyPersonnel` keyed `${postId}:${agency}:${appointedOn}`; `license_type` = CERT TYPE;
  dates sliced to `YYYY-MM-DD`. One manifest; pipeline orders the kinds.

## Open Questions

See `design.md` §Open Questions — the load-bearing ones: primary ORI dataset (LEAIC 2012 vs
FBI Crime Data Explorer), FIPS→`location_path` join, social-media coverage, and whether
enrichment supplies a full address (reuse the existing resolver) or `location_path_id`+coords
directly.
