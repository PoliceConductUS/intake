## Implementation

- [x] `intakeWorkspace` in `src/cli/command-directory.ts`: fail when the path is not an existing folder, naming the path as given and as resolved; test with a missing path, a file, and a relative path that resolves to nothing.
- [x] Make tests that relied on the workspace being created create it first.
- [x] Give `.env.example` an absolute path, and update the README files under `src/` that describe `intakeWorkspace`.

## Validate

- [x] Run `npm run validate`, including OpenSpec validation. No Supabase migration or loaded data changes, so no Supabase validation or integrity assertions apply.
