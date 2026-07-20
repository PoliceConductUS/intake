## Tasks

- [x] Specify the `state-licensing-summaries` capability (spec.md).
- [x] Create `data/licensing/` with a README, the Texas verified file, and
      pending stubs for the remaining states from `location_path`.
- [x] Implement `intake import licensing` (validation, planning, and
      deterministic delete-then-insert writes; `--dry-run`).
- [x] Unit-test validation and planning (verified file, pending stub,
      malformed file, dangling sourceKeys).
- [x] Validate: `npm run typecheck`, `npm run test:vitest`,
      `npm run openspec:validate`.
- [x] Live-verify against local Supabase: import Texas, confirm the row and
      sources, re-run to confirm deterministic re-import.
