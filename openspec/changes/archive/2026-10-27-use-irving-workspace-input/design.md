## Context

`gov.irvingtx.arrests/acquire.ts` currently reads `env.IRVING_ARRESTS_FILE`. Intake already has a generic `INTAKE_WORKSPACE` root and source-workspace directories, while acquire output is separately stored under immutable command directories.

## Goals / Non-Goals

**Goals:** Make the Irving workbook location stable and workspace-local; remove the Irving-specific environment variable; preserve the existing normalization and command-artifact flow.

**Non-Goals:** Change the workbook schema, normalized record shape, source acquisition CLI, or transform behavior. Do not add fallback paths or directory searching.

## Decisions

Resolve the input as `path.join(env.INTAKE_WORKSPACE, "gov.irvingtx.arrests", "source", "arrests.xlsx")`. Keep `INTAKE_WORKSPACE` as the generic workspace root. Use the existing `readXlsx` validation and fail loudly when the expected file is missing or invalid. Cover the exact path with an acquire test using a temporary workspace fixture.

The alternatives are documented in `brainstorm.md`: a fixed source-workspace path is selected over an arbitrary per-run CLI path or the current source-specific environment variable.

## Risks / Trade-offs

- [Risk] Operators may have the workbook elsewhere → The error identifies the one required path; no silent fallback is added.
- [Risk] Workspace root may be unset → Existing intake workspace validation remains responsible for the generic root contract.

## Migration Plan

Place the source workbook at `$INTAKE_WORKSPACE/gov.irvingtx.arrests/source/arrests.xlsx`. Existing immutable acquired normalized outputs remain valid for transform-only rebuilds. Rollback consists of restoring the prior acquire implementation if needed; no persisted database state changes.

## Open Questions

None.
