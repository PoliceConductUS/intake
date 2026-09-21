# Verification

See [verification of reset, manual locations, and cache CLI](../manual-location-cache-corrections/verify.md).

The reset integration uses the actual installed Supabase command against a disposable Postgres database. Its extension schema and role search path match the local Supabase environment. Local connections pass their explicit SSL mode through both the connection URL and `PGSSLMODE`, because the installed Supabase reset command otherwise requires TLS even when the URL requests a non-TLS local connection.

The command's schema reset targets `DATABASE_URL`; it does not independently choose a different linked or local database. The prior active mutation chain is moved only after successful schema reset and is retained within the reset command output. Inputs and canonical identity/cache state are not moved or deleted.
