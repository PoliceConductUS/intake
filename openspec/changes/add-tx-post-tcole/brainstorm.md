## Design Summary

Add TX POST (TCOLE) as a config-driven intake source (namespace `gov.tx.tcole`)
so intake reconstructs the existing TX rows of the production DB from external
TCOLE files while preserving existing canonical IDs, and additively ingests the
richer license-action history. TX is ~86% of the DB's agencies, so this is the
highest-leverage step toward retiring `seed.sql`.

The source config emits Agency / Personnel / AgencyPersonnel; the existing
`intake run` → `runImportArtifactsCommand` pipeline handles geocoding, location
resolution, ID minting, and DB mutation unchanged. A one-time ledger-seed step
preserves seed IDs. A new LicenseAction kind carries the fuller 02-04 data.

## Alternatives Considered

### Approach A — Combine both TCOLE files, reuse existing pipeline (CHOSEN)
- **How**: 02-10 file (with addresses) is the base for Agency/Personnel/
  AgencyPersonnel; 02-04 file supplies a new LicenseAction kind (310k rows).
  Reuse the pipeline's existing Census geocoder + address→location_path
  resolution + ResolvedProperty cache. Seed the `SourceNameToCanonicalId` ledger
  from the abandoned TCOLE identity maps for ID stability.
- **Pros**: Fuller-than-seed dataset; near-zero new location code (infra exists);
  IDs preserved; clean file merge (officers overlap 129,122; only 4 unique to 02-04).
- **Cons**: Requires a new pipeline kind (LicenseAction) — migration + registry +
  transform plumbing.
- **Why it wins**: Maximizes completeness while reusing everything already built.

### Approach B — 02-10 file only, defer license actions
- **How**: Build the three existing kinds from 02-10; skip 02-04 entirely.
- **Pros**: Smallest scope; no pipeline surgery.
- **Cons**: Silently drops ~121k license-action rows the 02-04 file has.
- **Why not**: User explicitly wants the fuller dataset ("combine both files now").

### Approach C — Port the existing `data.policeconduct.org/TX/config.py` pipeline
- **How**: Re-implement the original Python seed-builder's transform in intake.
- **Pros**: Provably matches how seed was built.
- **Cons**: Reproduces a stale snapshot and its quirks; ignores the config-driven
  model; the 02-10 file it used is itself missing the 02-04 license actions.
- **Why not**: Goal is forward reconstruction from current sources, not replay.

## Agreed Approach

Config-driven source reusing the existing import pipeline; ID stability via ledger
seed. **Refined during design** to two decisions that superseded the initial
combine-both plan:
- **Single file.** The 02-04 export turned out to be a known-problematic interim
  TCOLE export, so it is excluded; TX is one import from the 02-10 file (which has
  all sheets: agencies+addresses, officers, services, license actions).
- **Corrected domain model** (the "fix the model" decision): a distinct
  LicensingAuthority (TCOLE at `/tx/`, jurisdiction = location_path subtree) that
  issues Licenses (with LicenseAction history) to Personnel; Assignment
  (AgencyPersonnel) fixed so its role lives in `title` (undoing the `license_type`
  mis-rename) with a `license` reference. Phased: A = existing-DB reconstruction +
  rename; B = the licensing model (3 new kinds).

## Key Decisions

- **Namespace**: `gov.tx.tcole`.
- **Source files**: 02-10 base (Agency/Personnel/AgencyPersonnel, has addresses),
  02-04 for LicenseAction (+ 4 stray officers). Both read-only as already-acquired inputs.
- **Location resolution**: US Census Geocoder → address→`location_path_id` →
  `ResolvedProperty` cache — the pipeline's EXISTING infrastructure (wired by
  default), not new code. Reuse per the DRY rule.
- **ID stability**: existing IDs must be preserved. Transcribe the abandoned
  `identity/sources/tcole/*.yaml` maps into the intake ledger via
  `persistSourceNameToCanonicalIds`; pre-seeded mappings are reused, new entities
  get fresh cuid2.
- **Reconstruction target**: forward reconstruction — preserve IDs, accept that
  the newer source has more rows than seed. Success = IDs preserved + no
  unexpected losses, not exact row-count parity.
- **AgencyPersonnel key**: synthetic tuple
  `PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE` (dates
  `YYYY-MM-DD`, empty when null) — must match the abandoned map's `id_field`.

## Open Questions

- LicenseAction table column set + which file(s) feed it (02-04 primary; whether
  to also union 02-10's 189k variant) — resolved during Phase B specs.
- Whether any of the 5 garbage-name personnel (`"CHRIS A 1"`) need cleaning or
  pass through as-is (they are additive, low-risk).
