## Context

`acquireFromLocal` currently copies files and publishes `latest` without invoking acquisition. The MN POST transform omits narratives whenever document analysis is absent. `generateOneSource` selects artifacts and mutations by mtime, which does not prove a successful preceding command.

## Goals / Non-Goals

Goals: enforce required stages at shared command boundaries, reject unfinished MN POST document work, resume cached work, and regenerate missing evidence through intake.

Non-goals: website code, schema changes, identity resolution changes, reprocessing unrelated sources, or a security boundary against someone deliberately editing code or database files.

## Decisions

Use the existing source acquisition module for both network-started and locally seeded acquisitions. Do not special-case source names. Sources with no acquisition module continue to accept local inputs because no acquisition stage exists for them. Copy into command output before acquisition and retain it as resumable input on failure.

Record successful transform completion in intake-owned state through a narrow shared adapter. The adapter owns a strict validated JSON record at the source state directory’s `transform-completion.json`, invalidates it at the start of a new attempt, and records SHA-256 digests of the acquired snapshot and transformed Artifacts graph only after success. Input paths must match the acquired snapshot exactly; explicit standalone sources bind no acquired snapshot. Bind it to the exact acquired input snapshot and successful Artifacts output, including content integrity. The canonical Artifacts IO owns graph integrity: validate/hash the root and referenced collections and singular records, processing streamed references one at a time. Separately validated and audited ArtifactMutation envelopes remain inputs to the existing correction stage and do not alter transformed-output integrity. Generation and the internal artifact import entry point must reject missing, changed, stale, or failed-transform outputs. Preserve explicit standalone/manual-source semantics; do not require network acquisition for manually authored records. Choose the mutation output from the current import result, not a directory-wide newest-file search.

MN POST validates every referenced document before emitting importable records: either complete typed analysis supported by its saved evidence, or an explicit matching unavailable-document result from acquisition. An arbitrary missing JSON or missing analysis is an error. Optional narrative fields can be null only in completed analysis. The skip report cannot be used to silently excuse an existing but unfinished PDF.

Data recovery uses a new source snapshot, existing caches, the full acquisition path, and canonical IO/identity mappings. Preserve old snapshots and chain entries. Review the generated forward delta before applying. The existing historical chain requires the Oregon checkout's chain implementation; do not fold its unrelated changes into this branch.

## Risks / Trade-offs

Existing unproven artifacts require regeneration. Integrity checks add local IO but prevent publishing stale outputs. Unavailable remote documents may remain without narratives and must be enumerated honestly. No checks protect against deliberate arbitrary filesystem or database tampering.

## Migration Plan

Validate and review the implementation, complete document acquisition/analysis, regenerate through the enforced pipeline, inspect and apply the forward delta, verify counts and evidence, merge and remove the worktree, then build/deploy the unchanged website from main. No destructive rollback or reset.
