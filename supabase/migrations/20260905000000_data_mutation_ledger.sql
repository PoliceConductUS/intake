-- The data-mutation chain ledger (ADR 0033). Records which data-mutation entries
-- from ./data-mutations/ have been applied, in order — the data analog of
-- supabase_migrations.schema_migrations. `previous_version` is the entry's parent
-- (the chain head when it was generated); an entry applies only after its parent
-- is in the ledger. `checksum` (sha256 of the entry file) makes an applied,
-- immutable entry tamper-evident. On a fresh database the ledger is empty, so the
-- whole chain replays.

create table if not exists public.data_mutation_applied (
  version text primary key,
  previous_version text references public.data_mutation_applied (version),
  checksum text not null,
  applied_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (previous_version)
);
