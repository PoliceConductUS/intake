## Context

Manual acquisition checks HANDLED_RECORD_KINDS. Validation and transformation already derive entity fields, identity and plural artifact kinds from shared metadata.

## Decision

Extend only the supported-kind list. Cover the full acquire-to-transform path with an article and an existing agency-personnel reference. No custom parsing or identity resolution is needed.

## Validation

Run the focused manual source suite, typecheck and OpenSpec validation. Production database and workspace state are outside this delegated change.
