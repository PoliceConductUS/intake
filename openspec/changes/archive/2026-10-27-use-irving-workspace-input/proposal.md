## Why

Irving acquisition currently depends on `IRVING_ARRESTS_FILE`, which makes the source file's location machine-specific and separate from the source workspace. A fixed workspace path makes the input discoverable and repeatable for local acquisitions and rebuilds.

## What Changes

**Irving workbook input**

- From: `gov.irvingtx.arrests` reads a workbook selected by `IRVING_ARRESTS_FILE`.
- To: It reads `$INTAKE_WORKSPACE/gov.irvingtx.arrests/source/arrests.xlsx`.
- Reason: Keep source inputs at a known workspace location.
- Impact: Callers must place the workbook at the documented path; no Irving-specific environment variable is accepted.

## Capabilities

### New Capabilities

- `workspace-source-inputs`: Define the canonical workspace location for the Irving FOIA workbook.

### Modified Capabilities

None.

## Impact

Only the Irving acquire adapter and its tests change. No database schema, seed, downstream artifact, or generated type changes are required. The existing normalized command artifact format remains unchanged.
