## Implementation

- [x] Add cache CLI and canonical override storage with validation and overwrite tests.
- [x] Load manual geography before agency imports during reset and verify sequencing.
- [x] Record the 29 approved missing communities with preserved identities through manual IO.
- [x] Verify cache behavior, manual records, reset, type checking, build, and OpenSpec; document commands and results.

- [x] Replace override/overrideHistory and legacy value storage with entries-only IO; preserve one unfingerprinted override, archive replaced entries, and record the cache-set Command ID.
- [x] Convert existing supported cache files, verify values/provenance and tests, and document results.

- [x] Remove checked-in cache seeding, its files and documentation; verify transforms do not refill a cleared cache and CLI correction behavior remains intact.

- [x] Add name-first and address-second Google Maps search links to coordinate failure diagnostics; verify encoding and existing cache instructions.
