## Design Summary

Read the Irving FOIA workbook from the fixed source-workspace path `$INTAKE_WORKSPACE/gov.irvingtx.arrests/source/arrests.xlsx`. Keep the generic `INTAKE_WORKSPACE` setting as the workspace root, but remove the Irving-specific `IRVING_ARRESTS_FILE` setting. The normalized JSONL remains an acquire output in the command artifact directory.

## Alternatives Considered

### Option A: Fixed source-workspace path (selected)

- **Approach**: Resolve `arrests.xlsx` beneath the Irving source's `source/` directory.
- **Advantages**: Predictable, workspace-local, consistent with other source workspace inputs, and independent of machine-specific file paths.
- **Disadvantages**: The file must use the established name and location.
- **Why selected**: It directly satisfies the requirement for a known workspace location and removes a source-specific environment variable.

### Option B: Continue using `--from-local`

- **Approach**: Pass an arbitrary local path on each acquisition.
- **Advantages**: Flexible for one-off inputs.
- **Disadvantages**: The path is not a stable source contract and every operator must know where the file is.
- **Why not selected**: The user asked for a known workspace location.

### Option C: Keep `IRVING_ARRESTS_FILE`

- **Approach**: Keep selecting the workbook through an environment variable.
- **Advantages**: No source-code change.
- **Disadvantages**: The input location is hidden outside the workspace convention and differs from the requested behavior.
- **Why not selected**: It conflicts with the requested input contract.

## Agreed Approach

Use Option A. Resolve the file from the generic workspace root already supplied to intake, and fail clearly when the required workbook is absent. Do not add fallback paths or accept an alternate file name.

## Key Decisions

- The exact workbook path is `$INTAKE_WORKSPACE/gov.irvingtx.arrests/source/arrests.xlsx`.
- Only the Irving-specific path setting is removed; the generic workspace root remains.
- The acquired normalized JSONL stays in the existing command output and pointer flow.

## Open Questions

None.
