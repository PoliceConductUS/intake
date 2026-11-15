# Verification

- Producer and pure selection regressions failed before implementation, exposing
  the missing parent reference and excluded office agencies.
- The full migration chain succeeded in disposable PostGIS. The direct parent
  column is nullable with no default; the retired join table is absent.
- The new migration was rehearsed in a rolled-back local transaction before
  application. It retained all 3,293 existing Agency IDs, slugs, and location paths.
- Migration `20260929040615_agency_parent_federal_agency.sql` was applied locally
  through Supabase migration tracking.
- The preserved federal source emitted 11 organizations, 11 offices, zero skipped.
  Mutation `000012-gov.us.federal-le.DatabaseMutations.yaml` contains seven agency
  creates and four agency updates. The updates only set `parent_federal_agency_id`.
- Mutation 000012 was applied to the local dev-copy database. A read-only audit
  confirmed 11 offices linked to 11 parents, zero orphaned references, seven new
  agencies, and unchanged IDs/slugs/location paths for all 3,293 existing agencies.
- Repeat generation returned an empty diff. All applied mutation checksums verified.
- Database-backed regressions verify existing and new offices without current
  assignments or civil cases, canonical parent resolution, stable identity on
  repeat import, and later descendants admitted through the stored parent.
- Full-suite testing exposed a generic nullable-FK resolution defect. FK resolvers
  now derive nullability from generated schemas and preserve omission separately
  from explicit null, including later roster updates to an office with a parent.
- The user requested regression coverage for every resolver. The generated-field
  suite covers all registered kinds and properties, plus direct optional-reference
  and composed-resolver tests. Red runs exposed seven nullable text registrations,
  optional-reference omission, and composition of missing siblings. Shared fixes
  preserve omission without introducing per-entity cases.
- Actual PUT and PATCH mutation regressions verify omitted parents produce no
  write while explicit null clears a stored parent. The PATCH regression exposed
  and fixed the existing null-skipping condition.
- The user approved initial agency lists throughout the first multi-source run.
  A database-backed regression imports an office first, then verifies the later
  historical roster still receives its saved initial roots. Reset passes explicit
  run context through nested commands. Update tests cover both initially empty and
  initially populated databases and verify eligibility is checked once per run.
- Independent review traced this context end to end, reviewed the omission fixes,
  and ran five focused suites (283 tests), with no remaining correctness findings.
- The final full suite passed: 129 files, 1,195 tests. This includes the 230-case
  resolver omission/null suite. The older suffix test now expects omission to
  remain omitted rather than become null.
- Type checking, build, SQL lint, OpenSpec validation (34 items), and
  `git diff --check` passed.

The subsequent user-requested local `data reset --no-acquire` completed
successfully, rebuilding all eight sources and manual records. All eight applied
mutation entries verified. The post-reset audit confirmed 3,300 agencies, all 11
federal office links, zero orphaned parent references, and unchanged IDs, slugs,
and location paths for the 3,293 original agencies. Legacy seed loading is retired
(`db.seed.sql_paths = []`).

## 2026-09-29 closeout verification

Fresh full suite: 129 files, 1,195 tests passed. Type checking, build, and
OpenSpec validation passed. Implementation committed as `f6320ce`.
