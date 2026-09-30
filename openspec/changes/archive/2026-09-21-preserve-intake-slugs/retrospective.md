# Retrospective

## Evidence

Implementation `f7ed2e3`; 610 passing tests; real PostgreSQL red/green tests; independent review; current-workspace recovery counts in recovery.md.

## Outcome

The fix lives on the user-designated redesign branch and uses the current generated schema. Canonical IDs and URLs survive import/replay and cache-based reloads.

## What worked

Actual-migration PostgreSQL tests reproduced the URL changes and verified complete rollback. Checking the selected worktree's environment identified its separate stale cache.

## What failed

The first port checked only database/current-command ownership. Review exposed collision with absent cached records. Adding durable ownership then exposed an optimistic-claim race under concurrent facade resolution.

## Corrections

Read persisted cache ownership once per kind per command. Resolve durable ownership before the synchronous command claim check/set. Preserve the selected workspace's corrected cached values with auditable backups.

## Validation limits

Tests use disposable local PostgreSQL; no production deployment or production data change is claimed. One full-suite attempt exceeded an existing ten-second Docker startup hook; the final complete run used a 180-second hook budget and skipped no tests.

## Carry forward

Keep ongoing work in the existing redesign worktree and verify its actual schema and workspace configuration before integration. Include new-before-old and concurrent cases when testing durable identity allocation.
