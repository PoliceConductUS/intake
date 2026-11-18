## Implementation

- [x] Read only `INTAKE_WORKSPACE` in `src/cli/command-directory.ts`, `src/cli/import/artifacts/existing-import.ts`, `src/cli/import/artifacts/config.ts`, `src/cli/transform/index.ts` and `sources/gov/irvingtx/arrests/acquire.ts`.
- [x] Change every test that sets `INTAKE_WORKSPACE_TEST` to set `INTAKE_WORKSPACE`, and remove the test "uses INTAKE_WORKSPACE for import-artifacts replay artifacts when INTAKE_WORKSPACE_TEST is unset".
- [x] Add a test that a set `INTAKE_WORKSPACE_TEST` is ignored.
- [ ] Remove the `INTAKE_WORKSPACE_TEST` line from `.env.example` and the mentions in the README files under `src/` and `sources/`.
- [ ] Run `npm run validate`, including OpenSpec validation. No Supabase migration or loaded data changes, so no Supabase validation or integrity assertions apply.
