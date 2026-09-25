## Tasks

- [x] Separate address-point resolution from place containment; reproduce Pollok for Agency and Review with uncached coordinates and an existing place override, verify containment failure attribution without an override, and run resolver tests (245 passed), typecheck, build, and OpenSpec validation.

- [x] Make Census request failures readable and prevent misleading cache-correction advice; verify batch formatting and propagation through entity resolution (33 focused tests, typecheck, build, and OpenSpec validation passed).

- [x] Reproduce unsupported name, alias, nearest-place, postal-rule, and existing-row/cache behavior with failing tests.
- [x] Remove unsupported fallbacks and retain failure diagnostics.
- [x] Prevent reuse of old inferred location assignments while retaining resolved coordinates.
- [x] Verify the Sam Rayburn point against the local Census geometry using the corrected resolver.
- [x] Run focused and broader tests, type/build and OpenSpec checks; record remaining data failures and commit on redesign.
- [x] Reproduce and fix missing Census request diagnostics for batch and single-address network errors, HTTP failures, timeouts, and response-body failures.
- [x] Reuse CurrentRowReader coalescing through a shared batch-loader for Census addresses, retaining memoization and serializing batches and single-address attempts.
- [x] Verify concurrent callers, late arrivals, normalized-address reuse, failure propagation, and existing database read behavior.
- [x] Add shared cache-correction commands to property resolution failures and identify both coordinates for unmatched addresses; verify source precedence and dependency attribution.
- [x] Remove the three code-defined Texas city rewrites and five Minnesota ZIP exceptions; invalidate derived locations from the previous policy and verify explicit manual cache support remains.

- [x] Remove the unauthorized coordinate policy marker; restore normalized-address-only reuse, verify address changes geocode again, and audit TCOLE marked entries for removal impact.

- [x] Revert the extra rejected-coordinate diagnostics from 4906018 while retaining address-only coordinate reuse and the existing cache correction commands.

- [x] Remove the remaining location policy marker and obsolete postal ZIP cache input; audit other cache fingerprint paths and verify unchanged-input reuse plus changed-point containment.
