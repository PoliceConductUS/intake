# Request raw activity and personnel history data

## Why

The generated provider document exposes an internal arrest summary and lacks the raw activity and personnel history needed for reporting from calls through court outcomes.

## What Changes

- Omit ArrestProfile from provider-facing output while retaining the existing internal model.
- Append a maintained, source-backed request model for raw activity, justice outcomes, jail custody, force and deaths, beats/shifts/timekeeping, personnel histories, and their linking identifiers.
- Distinguish requested source datasets from currently supported schema-derived import records.
- Include a standard request for the complete catalog and releasable records, with response-scoped redaction markers, reasons, and omission logs.
- Regenerate docs/data-request-format.md in the existing worktree.

## Capabilities

### New Capabilities

- `data-request-document`: Reproducible provider document containing existing import fields and a raw source-data request model.

## Impact

Generator, request-model template, generated documentation, and focused generator validation only. No database migration, reset, seed changes, generated envelope changes, or production migration is required. New request tables are documentation models, not new canonical IO contracts or import support.
