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
