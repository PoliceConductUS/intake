## Design

### Data home

Reuse `public.location_reports` + `public.location_report_sources` (the
decertification report card pattern). One row per state:

- `id`: explicit, checked in (`locrep_<slug>_licensing_summary`)
- `location_path_id`: resolved from `location_path` by
  `state_or_territory_slug` + `level = 'state'`; fail loudly if absent
- `report_type`: `licensing_summary`
- `report_key`: `licensing-summary` (uniqueness via existing
  `unique (location_path_id, report_key)`)
- `payload` (jsonb):

```json
{
  "organization": { "name": "...", "abbreviation": "...", "url": "..." },
  "facts": [
    { "key": "...", "label": "...", "value": "...", "sourceKeys": ["..."] }
  ],
  "note": "..."
}
```

### Raw data contract (`data/licensing/<state>/licensing.json`)

Source `type` values are constrained to the existing
`location_report_sources` check constraint: `law`, `methodology`, `pdf`,
`web`.

`status: "pending"` stubs carry only the state identity and empty
organization/facts/sources; they are valid files but are never imported —
the importer lists them explicitly as skipped. `status: "verified"` requires
organization, at least one fact, at least one source, and every
`fact.sourceKeys` entry to resolve to a source `key`. All row IDs are
explicit in the file (stable-ID doctrine); the importer never generates IDs.

### Import semantics

Re-import is deterministic replacement, not upsert: inside one transaction
per state, delete the existing `(location_path_id, 'licensing-summary')`
report and its sources, then insert the file's rows. A malformed file,
unknown state slug, or failed write aborts that state's transaction and the
command exits non-zero after reporting every failure. This is an operator
import command, not seed data, so the conflict-free-seed rule does not apply;
determinism and explicit IDs preserve auditability.

### Out of scope

Source-producer Command/Artifacts envelopes and the canonical-ID ledger:
this data is hand-curated, low-volume, and keyed by checked-in IDs, so the
full source-module machinery adds no integrity the explicit IDs do not
already provide.
