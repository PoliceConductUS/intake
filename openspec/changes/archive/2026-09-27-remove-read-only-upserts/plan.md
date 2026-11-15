# Remove read-only upserts

Use the existing redesign-config-driven-intake worktree and preserve the report/timestamp fixes already present.

1. Add failing regressions for changed LocationPath display/spatial fields, LocationPathAlias target, and ReviewPersonnel rating/content. Cover unchanged no-op and same-run convergence. Use real CLI/replay with disposable PostgreSQL to verify generated changes apply, identity remains stable, and absent fields are preserved.
2. Remove the three overrides and the unused engine configuration/branch. Keep explicit read/assertion operations and existing identity/URL restrictions. Update affected read-only test expectations.
3. Update AGENTS.md and ADR 0011/0026 to prohibit silent suppression and distinguish stable identity from mutable fields.
4. Run focused tests, typecheck, formatting, OpenSpec validation, and independent review. Record evidence. Do not mutate the live database or bulk-generate current source corrections.
5. Reproduce and remove the same unconditional read in the streamed LocationPathGeometry importer. Preserve streaming and canonical IO; verify changed/unchanged geometry and replay checks, then repeat the scoped review and validation.
