# Verification

- Canonical Supabase migration up applied only `20261010000000_personnel_photo.sql`, after a fresh comparison proved it was the sole pending migration. Existing data was preserved; no reset was run.
- Canonical envelope generation ran against the migrated schema, followed by formatting. Existing AgencyArrestProfile generated behavior remains present.
- `npm run typecheck` and `npm run build`: passed. The shared manual-source append/read implementation now resides under `src/cli/state/manual-records.ts`; the source module re-exports it unchanged so production CLI output can include it.
- `npx vitest run test/cli/personnel-photo.test.ts test/sources/org.policeconduct.manual/manual.test.ts test/import/artifacts/io/database-mutation-envelopes.test.ts`: 23 tests passed.
- `npm run openspec:validate`: 42 items passed.
- `npm run cli -- photo import --help`: verified exact personnel ID, local image and optional verified source URL arguments.
- Root executed the Markham CLI import successfully using the authoritative dev-copy workspace. Source record and bytes are stored. Shared mutation generation/application remains coordinated with identity restoration; no pending unrelated chain entries were applied by this work.
- A full database reset/seed cycle has not been run because preserving existing local data was required. Additive migration and focused shared-pipeline tests cover the scoped feature; reset/seed behavior is unverified.
