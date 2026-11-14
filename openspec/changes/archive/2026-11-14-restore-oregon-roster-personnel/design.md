# Approach

Remove the Oregon certificate predicate. Empty certificate tables produce no license records while roster people and supplied employment remain. Existing parsing, required-data validation, explicit exclusions and canonical identity mappings remain effective. No per-person correction or inclusion command is the roster fix; no source ID or corrected person name is hard-coded.

## Source-dependent temporary exclusions

An optional nonempty `when` object stores the exact typed source field values that caused a temporary exclusion. Compare every condition against the unexcluded candidate spec with own-field presence and deep equality. Only matching rules are active. Changed records proceed through normal validation and stable identity resolution. Unconditioned exclusions remain unconditional; no lifetime is inferred from a reason.

Use the same active set for exclusion evidence, foreign-key cascade filtering and logging. Source conditions are workspace metadata, so project only the existing fields into the strict public SourceExclusions payload. Extend the existing `data exclude` operation with `--when <json>` and explicit `--replace`; replacement requires an existing exact key and preserves other entries. No replacement name is supplied. Fresh source acquisition supplies corrected values; retained acquisitions remain unchanged and available for normal reset replay.

## Streamed records and concurrent updates

Evaluate streamed candidates using the same source conditions. Iterate canonical emitted records to determine dependent removals to a fixpoint without retaining geometry payloads. Publish only retained references, preserving original identity validation and declared-output checks. Missing exclusion evidence ownership remains a visible error.

Hold one exclusive adjacent staging file across an exclusion document’s read, duplicate/replacement checks and update. A competing write fails visibly. Write the complete document privately, preserve the existing target mode (or normal create mode for a new file), then atomically publish it.
