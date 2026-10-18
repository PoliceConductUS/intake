## Why

MN POST discipline records reached the database without required document analysis because copying local files was accepted as acquisition and later stages accepted incomplete evidence. This change makes the intake handoffs enforce completion and regenerates the affected records.

## What Changes

- Local inputs run the source acquisition module when one exists, with resumable failure and no successful promotion before it completes.
- MN POST transformation rejects unprocessed referenced documents and validates completed analysis.
- Generation requires the recorded successful transform output and verifies its acquired-input and artifact integrity instead of choosing files by modification time.
- Recover documents, regenerate the data, and publish the corrected dataset.

## Capabilities

### New Capabilities

- `intake-stage-completion`: enforced acquisition and transform handoffs, including document completeness.

### Modified Capabilities

None.

## Impact

Intake acquisition, transformation, generation, MN POST evidence handling, and tests. No Supabase schema migration, seed change, generated database type refresh, or reset. Existing website fields already support these details; only a rebuild/deploy is needed after the data correction. Old outputs without completion evidence must be regenerated, not silently grandfathered.
