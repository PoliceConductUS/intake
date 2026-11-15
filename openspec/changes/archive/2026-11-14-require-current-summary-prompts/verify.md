# Verification

OpenSpec verification passed with no critical issues, warnings or suggestions.

| Dimension    | Result                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Completeness | Five tasks implemented; private database comparison complete                                         |
| Correctness  | Both requirements and both scenarios covered by implementation and regression tests                  |
| Coherence    | Existing source ordering, canonical mutation application, identities and acquisition timing retained |

## Prompt and reset requirements

The prompt-edit regression first failed because the evidence reader required the old numeric version. It now accepts a result for the current prompt and rejects that saved result after the prompt text changes without any numeric version increment. The analyzer sends the separate prompt file's contents and identifies those exact contents by SHA-256. Current-result validation and stale-cache regeneration share that fingerprint. No old-version fallback remains.

The stale-retained-input regression first observed schema reset before the reader failure. It now fails before schema reset, retains the mutation file and restores the acquisition pointer. A separate malformed-pointer regression demonstrated that `latest: 123` previously bypassed preparation; shared pointer validation now rejects it before any schema or data command. Existing retained automatic inputs are prepared before reset and transformed again against the rebuilt database. Fresh acquisition keeps its existing timing after upstream producers have loaded.

Implementation: `sources/mn-post/acquire/order-prompt.ts`, `order-analysis-prompt.txt`, `document-evidence.ts`, `collect-documents.ts`, `src/cli/data/reset.ts`, and `src/cli/state/command-pointer.ts`. Coverage includes `test/sources/mn-post/acquire/prompt-fingerprint.test.ts`, the Minnesota acquisition/evidence tests, `test/cli/data/reset.test.ts`, and shared pointer tests.

## Validation evidence

Full `npm run validate` exited zero: 182 test files, 1,864 tests, zero skips; format, shell syntax, typecheck, build and OpenSpec passed (49 items). Focused runs passed 135 Minnesota tests and 47 pointer/reset-related tests. Node 24.21.0 was used; all 394 installed packages match the lockfile, with the preceding fresh installation still intact and no dependency changes in this fix. A fresh `npm audit` returned zero vulnerabilities. Independent review approved the implementation after the malformed-pointer finding was corrected.

The source fix is committed and pushed as `35111aa667da3fcd41562cfae13388f33ee3a855`; both GitHub CodeQL checks passed for that head. Final archive-head validation and exact final SHA/CI evidence are recorded in the PR and private task report after the archive commit.

## Operational input transition

The current prompt is byte-for-byte identical to its version-2 introduction. The user selected exact verification and metadata conversion rather than regenerating the current summaries. All 531 current acquired results passed the new fingerprint reader with preserved PDFs and page evidence. All 70 obsolete results had current analyses for identical PDF hashes and were replaced using those results. Originals remain private. State caches, raw PDFs and database rows were not directly edited by this transition.

## Actual database rebuild and comparison

A recoverable full local database archive was created and completely read back before reset. The initial reset rebuilt Census, manual locations, federal agencies, Oregon and Texas, then failed at the obsolete Minnesota result. After the input repair, the remaining sources completed through the same canonical transform/generate/apply commands without another schema reset. All eleven mutation entries applied, checksums verified, and repeating `data up` made no changes. Website projections refreshed, the 29-table schema contract passed, and the native report/civil-case link retained its original identity and foreign key.

The comparison includes all 88 before tables and 86 after tables (90 distinct table identities), every column, complete sequence state and the full schema. Across 31 public corpus/projection/reference tables, all 2,776,644 rows retain their identities and non-rebuild-timestamp values. No corpus rows were added or removed.

The remaining differences are accounted for: four obsolete future-date warnings disappeared because their November 2 dates are no longer future; 125 warning messages updated only their validation day; the mutation ledger was rebuilt from 17 entries to 11; managed-service bootstrap IDs and timestamps were regenerated; migration execution timestamps changed; one stored migration statement changed only formatting. The only schema changes are empty dated Realtime partitions; all 1,511 other SQL blocks and all three sequence states match. Large objects are absent in both snapshots. Complete per-record differences and source evidence remain outside the repositories.

## Diagnostic dispositions

The environment check referenced a deleted seed-linking script despite retired seed loading. Only obsolete seed detection/install calls were removed; shell syntax and a fresh doctor run passed. Superpowers availability was verified by reading the applicable installed instructions. Supabase's newer-major-release notice does not identify a failing check or data defect; the pinned CLI successfully exercised the required migrations against separate integration-test databases. No dependency upgrade or warning suppression was introduced.
