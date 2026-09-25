## Design Summary

Add **Agencies + AgencyPersonnel** to the AZ POST import. The roster gives agencies only by
name, and the pipeline cannot create an agency from name alone (it needs
`location_path_id` + coordinates, or a full address).

**Primary path: request the data from the authoritative source.** A public-records request to
AZPOST for its agency directory (name, ORI, type, street/mailing address, city/state/zip,
county, phone, email, website) — drafted at
`intake.gov.az.post/2026-08-10-AZPOST Form PR - Agency Directory Request.pdf`. When it
returns, the directory is imported like the roster (an `intake run` source); because it
carries **addresses**, the **existing** address→location resolver derives `location_path_id`

- coordinates with **no new pipeline code**. The roster supplies the officer↔agency links.

**Fallback (deferred):** an OSM/Nominatim → ORI/LEAIC name-based enrichment resolver, cached
as a `ResolvedProperty`, for agencies the directory doesn't cover. Built only if a real gap
remains.

Full detail, verified facts, decisions (D1–D6), risks, and open questions are in `design.md`.

## Alternatives Considered

### Approach A: FOIA-delivered agency directory (primary) + resolver fallback — CHOSEN

- Request authoritative agency data from AZPOST; import like the roster; reuse the existing
  address→location resolver. Name-based enrichment only fills gaps.
- **Why selected:** authoritative and deterministic, needs no new pipeline code for covered
  agencies, and avoids name→POI matching uncertainty for the common case.

### Approach B: Name-based enrichment resolver (Nominatim → ORI) as the primary path

- Reconstruct address/coords/contact from third parties for every agency.
- **Why not now:** matching uncertainty (substations, renamed depts) and external
  dependency/cost for data we can simply request from the source. Kept only as fallback.

### Approach C: Dedicated ORI-registry source owns agencies; roster links

- Cleaner authoritative origin, but needs a name-matching layer up front.
- **Why not now:** more machinery; a later evolution once ORI is ingested as its own source.

## Agreed Approach

Approach A. Request the AZPOST agency directory (PR form drafted); import it as an
`intake run` source that maps directory columns → `Agencies` (with address/contact), reusing
the existing pipeline for `location_path_id` + coordinates. The roster `run` emits
`AgencyPersonnel` links keyed by the shared agency name. The Nominatim/ORI resolver stays in
the design as a deferred fallback for uncovered agencies.

## Key Decisions

- Primary agency data = authoritative FOIA directory, imported like the roster; **no new
  agency-resolution pipeline code** when addresses are present.
- Roster provides `AgencyPersonnel`; agency identity keyed by the shared agency name string.
- `AgencyPersonnel` keyed `${postId}:${agency}:${appointedOn}`; `license_type` = CERT TYPE;
  dates sliced to `YYYY-MM-DD`.
- Nominatim → ORI/LEAIC resolver = deferred fallback (cached, correction loop) for gaps only.

## Open Questions

See `design.md` §Open Questions — chiefly: does the returned directory include addresses for
every agency (how much fallback is needed), roster-vs-directory agency labels, and sequencing
(build the roster `AgencyPersonnel` change now vs. wait for the directory).
