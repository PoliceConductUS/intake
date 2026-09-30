# Decision

Remove all three remaining read-only configurations and the generic engine's read-only upsert branch. Existing rows always use field comparison; the mutation planner already omits check-only updates. Explicit GET/read assertions are separate operations and remain valid.

Keep canonical IDs, LocationPath.path, and alias identity unchanged. Source-supplied alias target corrections and ReviewPersonnel nonidentity edits use normal validated updates; existing conflict and replay checks remain in place. Omitted fields retain current values.

LocationPath centroid and bbox are GeoJSON values in canonical envelopes, but generic database reads return PostGIS binary strings. Normalize these fields to the canonical GeoJSON shape at the database read boundary for single and batched reads, including mixed-kind batches and replay. Preserve coordinate precision so an unchanged source does not generate perpetual corrections. Compare typed values; serialize geometry only for writes through the existing adapters.

Review also identified an unconditional read in the streamed LocationPathGeometry importer. Apply the same comparison rule there while retaining one-record-at-a-time processing. Compare parsed GeoJSON values at full precision, generate a canonical update for a changed boundary, and enforce optimistic replay checks. Source-only geometry metadata must not become database columns.

The existing row's boundary is read as a typed GeoJSON object. A changed boundary produces one geometry set operation, serializing the existing value for `from` and retaining the source value for `to`. The existing canonical geometry payload accepts both GeoJSON objects and serialized JSON strings; comparison parses only strings. Replay uses the same comparison rule and retains the existing source representation for SQL writes. The stream does not register or retain geometry facades across records.

ReviewPersonnel rating_overall is a PostgreSQL numeric column. The generated model represents numeric fields as JavaScript numbers, while ordinary pg reads return strings. Register the numeric parser to match the generated model and existing JSON row reads, so rating diffs and optimistic replay checks use the same type. Current numeric columns are ratings and their aggregates.

ADR 0026's configurable read-vs-update exception is superseded by this decision. AGENTS.md and ADR 0011 state that stable identity or idempotence never justify dropping changed source fields. A prohibited edit or failed comparison must fail visibly, not become a read.

## Historical evidence

Commit `8d5478e` introduced LocationPath facades as Create/Read; `e5a40bb` transferred location read-only behavior into the generic registry. Commit `90788ceb` later added Review and ReviewPersonnel read-only behavior, claiming verified content never changes and explicitly describing the bypass as sidestepping the timestamptz/string `from` validation failure. The report regression exposed that same failure after removing its override. These are implementation assumptions, not a basis for suppressing edits.
