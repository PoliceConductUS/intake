## Why

Intake currently scans immediate children of its sources directory, selects sources by phase filenames and rejects slashes in source identifiers. Source outputs, acquisition pointers and canonical ID ledgers already depend on those identifiers.

## What Changes

- Discover source folders recursively by the presence of `intake.source.ts`.
- Derive a single slash-delimited namespace from the marked directory. Use that namespace for selection, persisted records, state and command outputs.
- Move active sources and migrate the local workspace's existing source records and references before resuming its no-acquire rebuild.

## Capabilities

### New Capabilities

- `source-namespace-paths` defines source discovery, identity and its persisted layout.

### Modified Capabilities

- `officer-reporting-spreadsheet` identifies the PSV Project tracker and preserves separate annual workbook references.

## Impact

Affects source listing, CLI selection, requests, acquisition, transforms, mutation generation and replay, the landing page search Action, website references, and workspace migration. Existing canonical database IDs and slugs remain authoritative. Check database constraints and all consumers of source namespace fields. Production data migration and deployment require separate authorization.
