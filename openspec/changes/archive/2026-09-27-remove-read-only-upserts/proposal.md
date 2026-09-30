## Why

Three entity configurations and the streamed location-boundary importer turn every existing row into a read, silently discarding source edits. The generic engine still exposes this bypass, and ADR 0026 documents it as allowed configuration despite ADR 0011 requiring diffs.

## What Changes

- Compare existing LocationPath, LocationPathAlias, and ReviewPersonnel values and generate normal updates.
- Remove the read-only upsert option from the engine and registry.
- Compare streamed location boundaries and generate updates when they change.
- Explicitly prohibit suppressing source changes to achieve idempotence or bypass failures.

## Capabilities

### New Capabilities

- `source-update-comparison`: existing imported rows are compared before an update is omitted.

### Modified Capabilities

- None.

## Impact

Changes facade planning, streamed geometry planning, spatial read/replay adapters, tests, AGENTS.md, and ADR 0011/0026. No schema, seed, generated types, reset, or live data changes. Explicit read/assertion mutation envelopes and existing identity/ownership constraints remain supported.
