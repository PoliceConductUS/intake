# Verification — 2026-10-25

Base: `f2d8b0e` (current main, including intake PRs #80 and #81).
Isolated branch: `ins96/shared-personnel-validation`.

- Red: 24 new boundary assertions failed before shared validation; the new Texas
  candidate-preservation test failed before removing source-only filtering.
- Focused suite: 97 passing across shared name boundaries, transform/exclusion
  integration, persisted inline/reference replay rejection, Texas transform, and
  existing timestamp IO tests.
- Regenerated-schema tests: 2 passing against disposable Postgres, including the
  generated Personnel contract. Generation used read-only local introspection;
  migration fingerprint is unchanged.
- Final full suite: `npm test -- --maxWorkers=2`: 1450 passed, 2 failed, 145 files.
  Both failures are in `test/cli/data/reset.integration.test.ts`:
  - runs actual schema reset, regenerates source and manual data, and preserves
    IDs and slugs on repetition;
  - a real missing-location failure returns nonzero without replaying old data.
    Both stop at `Schema reset failed (exit 1)`. Both reproduced on an untouched
    archive of base `f2d8b0e` using the same locked dependencies and disposable
    containers. They are not reported as passing.
- A Minnesota workbook test timed out under default full-suite concurrency; it
  passed in isolation on base and in the final two-worker full suite.
- `npm run lint` (including typecheck), `npm run build`, and
  `npm run openspec:validate` pass; OpenSpec reports 43 passed, zero failed.
- Changed-file Prettier and `git diff --check` pass. Repository-wide
  `npm run format:check` flags the unchanged
  `openspec/specs/mn-post-discipline-coverage/spec.md`; its formatting was left
  untouched to keep this PR scoped.

## Coverage and limits

Shared tests exercise Texas, Oregon and an arbitrary future namespace without
source opt-in. Artifact/create/update/correction schemas reject numeric and
punctuation-only identity components, unsupported suffixes, and retain legitimate
surname words and Unicode names. Update tests permit repair of historical bad
values while existing timestamp checks still reject invalid historical types.
Replay tests corrupt persisted inline and referenced canonical fixtures and
verify rejection before any SQL and unchanged evidence files. Transform tests
exercise real exclusion persistence, log source/key/reason/counts, cascade
assignments, preserve the original manifest and retain a same-named other person.

No shared database reset, production mutation, new source acquisition, site
build, publication, or exclusion-state application occurred. Disposable test
containers were created and destroyed. Fixture status is inherited from the
parent's reviewed disposition; retained source snapshots verify source keys.

The fixture packet must be applied through the exclusion CLI in the isolated
parent rebuild workspace before using this change. Unsupported suffixes now stop
instead of being silently removed. Reviewed corrections and rebuild/publication
verification remain on INS-69. This is not evidence that the live corpus is fixed.

## User-requested restoration — 2026-10-26

- Restored the database-derived Personnel string fields from before c2cc615;
  removed its currentValueOnly update exception and shared name schema module.
- Preserved source candidate retention, audited exclusions, existing generation
  correction order, explicit unset, saved corrections, and detailed IO errors.
- Red: three cross-source transform regressions failed with the premature checks.
- Green: 129 focused tests pass across eight files, including those regressions,
  literal null text, explicit unset, corrections, exclusions, and structural replay validation.
- OpenSpec: 50 passed, zero failed. git diff --check passes.
- Type checking still fails on the existing readSourceName ledger API mismatch
  and related test doubles; no remaining errors in the changed transform test.
- Original Model resolvers perform casing; they do not enforce the removed
  suffix allowlist. This restoration does not claim otherwise.
- Full cached `data transform gov.tx.tcole` completed successfully (exit 0),
  processing 129,973 personnel candidates. Output command:
  `2026-10-26T05-57-00-791Z-i1gn8jqs94tefgsncssnbap9`.
  No generation, database replay, or reset was run.
