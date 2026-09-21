# Verification

See [verification of reset, manual locations, and cache CLI](../manual-location-cache-corrections/verify.md).

The reset integration uses the actual installed Supabase command against a disposable Postgres database. Its extension schema and role search path match the local Supabase environment. Local connections pass their explicit SSL mode through both the connection URL and `PGSSLMODE`, because the installed Supabase reset command otherwise requires TLS even when the URL requests a non-TLS local connection.

The command's schema reset targets `DATABASE_URL`; it does not independently choose a different linked or local database. The prior active mutation chain is moved only after successful schema reset and is retained within the reset command output. Inputs and canonical identity/cache state are not moved or deleted.

## Executable entry-point regression

The first real CLI run exposed a circular wait: reset dynamically imported `cli/index.ts` while that module's top-level `main()` was awaiting reset. The earlier tests imported the CLI without executing its entry point and therefore missed this failure.

Command dispatch now lives in `cli/run-intake.ts`, separate from the executable entry point. `test/cli/data/reset-entry.test.ts` launches the real entry point in a subprocess, stubs only the external Supabase schema reset, and uses an empty temporary workspace. It reproduced the unsettled top-level await before the fix. After the fix, dispatch reaches the Census transform and exits with the expected missing-input error. No development database or acquired files are touched by this test.
