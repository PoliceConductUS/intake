## 1. Source coverage

- [x] 1.1 Add failing acquisition/input and transform tests for subdivisions, consolidated cities, exclusions and full coverage.
- [x] 1.2 Implement same-vintage source discovery, required inputs, supplemental paths, original Census boundaries and visible exclusion report.

## 2. Resolution

- [x] 2.1 Add failing tests for class precedence, same-class ambiguity and stale caches.
- [x] 2.2 Add resolution-class migration, regenerate contracts and update resolver and ADR.

## 3. Verification

- [x] 3.1 Exercise real Census Alba data and verify existing place paths are unchanged.
- [x] 3.2 Run focused tests, real PostGIS migration/resolution checks, full tests, typecheck, build and OpenSpec validation.
- [x] 3.3 Record coverage, limitations and verification in this visible change directory; commit on redesign.

## 4. Unorganized territories

- [x] 4.1 Replace Z3 exclusion with place inclusion and update the policy.
- [x] 4.2 Demonstrate failing then passing regressions for Fort Snelling and another Z3 territory, county parentage, source identity and complete boundary preservation.
- [x] 4.3 Validate Census tests, place resolution, type checking and OpenSpec.
- [x] 4.4 User reran the source-based reset and confirmed it worked.
