## Design Summary

The user requires intake stages to be mandatory and the incomplete Minnesota POST batch to be regenerated with document analysis. The earlier helper collected personnel only, registered those files through `--from-local`, transformed them, and generated mutations. Missing analysis was indistinguishable from an unavailable document.

## Alternatives Considered

1. Operational rerun only: repairs this batch but leaves the bypass open.
2. Source validation only: rejects missing analysis but local acquisition still bypasses the acquisition module and generation can discover unrelated or incomplete output by modification time.
3. Enforce source acquisition and successful phase handoffs, plus evidence completeness in the source transform: selected because it closes the observed bypass without changing database semantics.

## Agreed Approach

Direct user authorization covers the scoped fix and data regeneration. Local files seed acquisition where an acquisition module exists; they do not replace it. Transformation rejects unfinished document work. Generation consumes a recorded successful transformation, with input and output integrity checks, rather than the newest matching file. Existing manual sources and mutation-chain replay remain supported through their explicit existing paths.

## Key Decisions

No website code changes, database reset, fabricated evidence, identity changes, or creation of the 34 unresolved personnel records. A documented unavailable source document remains distinct from an unprocessed one. Cached completed analysis is reusable.

## Open Questions

None about intended behavior. Actual unavailable document counts will be established during recovery.
