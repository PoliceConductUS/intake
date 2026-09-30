## 1. Enforce place-only resolution

- [x] 1.1 Port supplied, cached, in-memory, and newly resolved agency place validation to the current worktree architecture.
- [x] 1.2 Port canonical cache read/write validation and enforce it in PropertyCorrection, used by the current manual cache CLI.
- [x] 1.3 Move the database constraint migration and its tests into the worktree.
- [x] 1.4 Remove the link-seed npm and shell scripts and the obsolete test requiring the ignored seed.sql file.
- [x] 1.5 Restore main and validate the worktree changes.
- [x] 1.6 Exclude generated columns from writable contracts and data requests; regenerate both from a disposable migrated database.
- [x] 1.7 User ran `npm run cli -- data reset --no-acquire` and confirmed success after Z3 territory inclusion.

## Validation

- Generated-column contracts, provider-request generation, and database constraints: 6 tests passed against disposable migrated PostgreSQL; type checking and all 36 OpenSpec validations passed. Generated contracts and the request document were refreshed from that disposable schema.

- Worktree: 410 focused resolver, import, cache, and envelope tests passed; type checking passed.
- The two database foreign-key migration tests passed in a disposable PostgreSQL container from this worktree. They verify the generated place constant cannot be overridden, rejection of county/state inserts and updates, rejection of referenced-place reclassification, and failure on existing invalid references. The configured database was not changed or reset.
- Previous cache cleanup deleted 97 county references from main's configured workspace, without retained backups. This does not establish the state of a different worktree workspace.
- Main is clean; all code changes now reside in redesign-config-driven-intake.
