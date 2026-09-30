-- Corrects the assignment model. `agency_officers.license_type` was misnamed by
-- migration 20260626000000 — the column actually holds the *role* (the TCOLE
-- `APPOINTMENT`: "Peace Officer", "Jailer", …), not a license type. Rename it
-- back to `title`. The rename preserves every row and its id, and keeps the
-- NOT NULL constraint (every assignment has a role).
--
-- Also add a nullable `license_id` for the "held under a license" link. It stays
-- null until the licensing phase emits License entities; the foreign-key
-- constraint to public.license is added alongside that table.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agency_officers'
      and column_name = 'license_type'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agency_officers'
      and column_name = 'title'
  ) then
    alter table public.agency_officers
      rename column license_type to title;
  end if;
end $$;

alter table public.agency_officers
  add column if not exists license_id text;
