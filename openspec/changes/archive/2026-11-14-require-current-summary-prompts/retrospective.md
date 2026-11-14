# Retrospective

## Outcome

The current Minnesota prompt is separately editable and identified by its exact contents. Obsolete results cannot pass import validation, and stale retained inputs fail preparation before the database is cleared. The actual rebuild preserves all corpus identities and values apart from rebuild timestamps.

## Cause and correction

Historical acquisition replay and stricter summary validation were tested separately. Their integration first failed only after a destructive reset. A real stale-document regression now exercises that boundary. Fresh review also identified malformed pointer types being normalized to absence; shared reader validation and a regression close that bypass.

## Evidence

The full intake suite passed 1,864 tests with zero skips. Independent code review approved the fixes. The private database archive was read back successfully; canonical replay applied eleven entries. Full comparison preserved all 2,776,644 rows in 31 public corpus/projection/reference tables. Four no-longer-future warnings were removed, and all other differences are clock-driven validation text or database service/history metadata. Schema differences are confined to empty dated Realtime partitions.

## Implementation decisions

Preparation validates existing retained automatic inputs and reruns transforms after reset; it does not substitute outputs derived from the old database. Fresh acquisition keeps its dependency timing. The user chose exact prompt verification and metadata conversion for unchanged version-2 results. Current analyses for identical PDFs replace obsolete results; no permanent compatibility reader or fresh model calls were added. Existing worktrees and PRs were reused.
