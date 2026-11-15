# Local slug recovery evidence

## Current redesign workspace

The existing redesign worktree uses `INTAKE_WORKSPACE=/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy`. Its database is the same local PostgreSQL instance previously repaired from `backups/reference-20260814/`. Its separate cache still contained the pre-repair values.

A read-only database audit matched reference rows by exact canonical ID and required every database slug to match the reference before planning any cache correction. Using the current canonical ResolvedProperty IO, the audit found 129,924 Personnel and 2,949 Agency cached slugs requiring correction. All 132,873 existing cache envelopes were backed up, corrected, and read back. Their canonical IDs and other properties were preserved. Each corrected envelope records the reference path/hash and correction-plan hash in annotations.

An independent second audit checked all 140,301 matching Personnel and 3,342 matching Agency cache records against the reference and current database: zero missing records and zero slug mismatches. This task made no database writes and did not reset the shared database.

Evidence directory: `/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy/backups/slug-restoration-20260921/`.

- `resolved-property-before.tar.gz`: original cache backup, SHA-256 `822726611d22fa34915bf534d6a554c2c7ea8b089f9046219ea3d1974a368269`.
- `plan.json`: exact IDs and before/after values with reference provenance, SHA-256 `5a6c2921ad4b40d4da447937464cbf77bd723f6afe98eb21919eb10692ea068d`.
- `audit-summary.json`: initial audit counts.
- `result.json`: 132,873 writes and 132,873 verified reads.
- `post-correction-audit.json`: independent full comparison showing zero remaining mismatches.

The earlier database and original `dev` cache repair evidence remains in `/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev/backups/slug-restoration-20260921/`. That repair is separate from this branch's implementation and the copied-workspace cache alignment recorded here.

## Branch cleanup

The explicitly requested branches and their worktrees were removed: `codex/license-type-contract`, `codex/require-intake-api-version`, and `codex/resolve-agency-location-paths`. This implementation was made directly in the existing `redesign-config-driven-intake` worktree, starting at `4b2c9f3`.

## Original main recovery record

The historical record below describes the original repair and main implementation at `a57f5bf`. Its table-contract limitation was resolved by the current redesign implementation and verified against all current migrations. The original evidence is retained here as part of merging main.

### Slug restoration evidence

#### Verified scope

The reference database export is `intake-workspace/dev/backups/reference-20260814/`.
The target is the local development PostgreSQL database at `127.0.0.1:54322`.
Producer-provided slugs have no authority over canonical system URLs.

| Entity       | Current rows | Exact-ID reference matches | Slug corrections |
| ------------ | -----------: | -------------------------: | ---------------: |
| Personnel    |      140,563 |                    140,301 |          129,924 |
| Agency       |        3,352 |                      3,342 |            2,949 |
| LocationPath |       35,249 |                     35,249 |                0 |

Every corrected personnel slug appears in the captured production personnel sitemap.
Every corrected agency slug appears as a leaf in the captured production agency routes.
The sitemap evidence comes from the existing site task's `.cache/route-reconciliation/production-paths.json`.
No missing identities are merged or recreated.

#### Retained evidence

Backup directory: `/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev/backups/slug-restoration-20260921/`.

- `resolved-property-before.tar.gz`: original canonical property cache before correction.
- `before.json`: original IDs and slugs/paths from the local database.
- `corrections.json`: each table, canonical ID, original slug, restored slug, and reference digest.
- `cache-plan.json`: each corrected cache entry and its prior value or absence.
- `reference.json`: the retained source rows and original CSV hashes.
- `database-rehearsal.json`: rolled-back transaction proving expected affected rows, zero remaining mismatches, unchanged IDs and non-slug fields.

The cache staging pass examined 143,643 same-ID entities. It staged 132,873 corrections:
129,924 existing personnel cache values and 2,949 missing agency cache entries.
The remaining 10,770 cache values already matched the reference.
Corrections use canonical ResolvedProperty IO and retain existing provenance plus the reference digest.

#### Source digests

- `officers.csv`: `cf1fffeee4bcb5ed2fc1293af7229d84f8808f6ea00a2893d4c8d0d5addbacca`
- `agency.csv`: `4be3ef3e58de7d239fb0a4082d10bebdf58a4dd6164e7b29eb5a142fe2cdf1cd`
- `location_path.csv`: `be051cade6808e98449651a6c3f3d0f006d1da3164c956b497dc1e86c13eb3b8`

#### Verification and deployment boundary

The database correction rehearsal updated exactly 129,924 personnel and 2,949 agencies,
then rolled back. It compared sorted ID hashes and non-slug row hashes before and after,
including agency-personnel relationships, location paths, reviews, civil cases, and federal agencies.
Normal database triggers remained enabled. Only slug was explicitly assigned; updated_at was excluded from non-slug fingerprints.

This checkout's import code still addresses `public.officers` and `public.agency_officers`,
while the current local database uses `public.personnel` and `public.agency_personnel`.
The scoped slug patch does not rename that separate database contract. Import/replay behavior
is verified with repository regression tests; restoration SQL exercises the real current tables.
A full live import against this checkout needs the table-contract work integrated first.
No production deployment or site rebuild is included in this correction.

#### Applied result

Applied the rehearsed correction to the local database after saving the original cache archive.
Canonical IO wrote and re-read all 132,873 corrected cache entries successfully.
The committed database transaction restored 129,924 personnel slugs and 2,949 agency slugs.
A separate post-commit connection verified all 140,301 matching personnel and 3,342 matching agencies
against the reference: zero remaining slug mismatches, unchanged full ID sets, and unchanged unaffected slugs.
The transaction also verified unchanged non-slug row fingerprints and agency-personnel relationships.

Additional retained files: `cache-result.json`, `database-result.json`, and `postcommit-verification.json`.

- Original cache archive SHA-256: `359e89e0c82aacfd88cccd3e3bbb16e941460967fc4a258f6070fbbe400c2156`.
- Exact correction plan SHA-256: `0b25666eb63ff2eeff4ad0128aa0568d3be3753e4048c556db66425916b5d74f`.
