# Verification Report

**Change:** restore-oregon-roster-personnel
**Verified at:** 2026-11-14 06:33 UTC
**Implementation head:** `31a202e3a62e4890bb0317d0359ea3e0dc19c149`

## 1. Structural validation

`mise exec -- npx openspec validate --all --json` exited 0: all 51 items valid.

## 2. Task completion and requirement coverage

All 5 implementation tasks are complete. All three requirements have implementation and regression coverage.

| Requirement                                                   | Implementation                                                                                                                                                             | Coverage                                                                                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oregon roster personnel do not require certificates           | `sources/gov.or.dpsst/transform.ts` removes the certificate condition                                                                                                      | `test/oregon-transform.test.ts`: empty, medical and instructor credentials retain people and supported employment; empty input invents no licenses            |
| Temporary exclusions depend on exact source values            | Shared source-field matching, one active set, canonical streamed traversal and dependent-record filtering                                                                  | Transform tests cover changed values, null versus absent, typed and nested values, inline and streamed dependents, source evidence and required-name failures |
| Configure conditions through the existing exclusion operation | Existing exclude CLI supports conditions and explicit replacement; source document updates use an exclusive private staging file, one target handle and atomic publication | Shared IO and CLI tests cover duplicate/missing replacement, unrelated entries, contention, complete reads, permissions and target replacement during a read  |

The real intake pipeline restored 2,888 prior personnel identities. Read-only comparison found zero changed slugs, zero unlinked restored people and zero missing database routes among 160,239 prior public personnel paths. The changed name came from acquired source input. Source and replacement values in the five wording-only correction edits remained unchanged.

## 3. Delta spec sync state

| Capability        | State                                                             |
| ----------------- | ----------------------------------------------------------------- |
| oregon-dpsst      | Synced: approved optional-certificate roster requirement          |
| source-exclusions | Synced: source conditions and explicit configuration requirements |

Archive synced both capabilities to their main specifications.

## 4. Design and specs coherence

The implementation follows the approved roster and source-condition decisions. Existing unconditional exclusions remain effective. Source conditions stay in workspace metadata; public exclusion evidence retains its existing shape. Streamed records keep canonical IO and bounded payload handling. Existing ID, slug, required-field and declared-output checks remain effective. No unresolved review finding or design drift remains.

## 5. Implementation and validation evidence

Implementation commits `b0a6ee931f26f8296c89b9243c8786f6e3ed6893..31a202e3a62e4890bb0317d0359ea3e0dc19c149` are committed and pushed. The working tree was clean before this report was created.

- Runtime: Node 24.21.0 and npm 11.19.0 through mise. Fresh dependency installation and 394 installed versions were checked against the lockfile; this change adds no dependency.
- Full `npm run validate` and the commit hook exited 0: formatting, type checking, 184 test files / 1,917 tests, TypeScript build and 51 OpenSpec checks. Zero tests skipped.
- CI at this implementation head passed: [validation](https://github.com/PoliceConductUS/intake/actions/runs/43566271232/job/132360699570), [CodeQL analysis](https://github.com/PoliceConductUS/intake/actions/runs/43566265373/job/132360685481) and [CodeQL findings gate](https://github.com/PoliceConductUS/intake/runs/132360933200). The reported path race was corrected by reading content and permissions through the same file handle.
- The generated-file integration test compares both complete 114-file sets against real migrated PostGIS. Its explicit 30-second body budget replaces the unit-test default; all assertions, source generators and database coverage remain.
- The Supabase availability notice concerns a newer CLI release. The installed 2.122.0 is the repository pin; real migration/catalog tests and the normal local migration application passed. No rule or warning was suppressed.
- The retained out-of-state employment placeholder lacks a named usable agency. Its original rows remain available, and the existing Oregon specification requires reporting that omission rather than fabricating an agency or relationship. It does not remove a restored public personnel route.

The archive commit must receive its own final-head checks before merge. Full website build, sitemap and copy checks remain required before production publication.

## 6. Front-door routing leak detector

No files exist under `docs/superpowers/specs/`. This change’s design artifacts are under its OpenSpec directory.

## 7. Deferred manual checks

The plan contains no deferred manual-check rows. No required implementation test was skipped or replaced by an exception. Production release steps are tracked separately and remain required.

## Overall decision

PASS: implementation verification is complete and the change is ready to sync and archive. Merge and publication remain separate steps with their final checks.
