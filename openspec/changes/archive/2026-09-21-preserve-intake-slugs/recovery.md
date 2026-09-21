# Slug restoration evidence

## Verified scope

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

## Retained evidence

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

## Source digests

- `officers.csv`: `cf1fffeee4bcb5ed2fc1293af7229d84f8808f6ea00a2893d4c8d0d5addbacca`
- `agency.csv`: `4be3ef3e58de7d239fb0a4082d10bebdf58a4dd6164e7b29eb5a142fe2cdf1cd`
- `location_path.csv`: `be051cade6808e98449651a6c3f3d0f006d1da3164c956b497dc1e86c13eb3b8`

## Verification and deployment boundary

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

## Applied result

Applied the rehearsed correction to the local database after saving the original cache archive.
Canonical IO wrote and re-read all 132,873 corrected cache entries successfully.
The committed database transaction restored 129,924 personnel slugs and 2,949 agency slugs.
A separate post-commit connection verified all 140,301 matching personnel and 3,342 matching agencies
against the reference: zero remaining slug mismatches, unchanged full ID sets, and unchanged unaffected slugs.
The transaction also verified unchanged non-slug row fingerprints and agency-personnel relationships.

Additional retained files: `cache-result.json`, `database-result.json`, and `postcommit-verification.json`.

- Original cache archive SHA-256: `359e89e0c82aacfd88cccd3e3bbb16e941460967fc4a258f6070fbbe400c2156`.
- Exact correction plan SHA-256: `0b25666eb63ff2eeff4ad0128aa0568d3be3753e4048c556db66425916b5d74f`.
