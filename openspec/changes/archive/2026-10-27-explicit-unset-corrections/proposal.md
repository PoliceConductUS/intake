## Why

The cache CLI interprets the string `null` as a null replacement. Clearing a field must instead be an explicit operation, distinguishable from supplying text or leaving source information absent.

## What Changes

- Add `cache unset <namespace> <kind> <source-id> <property> --from <value>`.
- Store unset entries as `operation: unset`, without a value; set entries retain their non-null value representation.
- Reject null-valued set entries. Treat literal string inputs as strings whenever the target field accepts strings.
- Apply unset through shared conditional correction handling, preserving explicit-null precedence during generation.
- Migrate the previously approved null corrections explicitly, preserving their provenance.

## Impact

Correction records and CLI behavior change. No database schema or raw acquisition changes.
