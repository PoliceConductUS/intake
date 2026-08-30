-- Licensing model. TCOLE (and every state POST agency) is a licensing
-- authority: it issues a License of a type directly to an officer, and records
-- the License's action history. An assignment (agency_officers) is separately
-- held *under* a license — see agency_officers.license_id, added nullable by
-- 20260627000000 and given its foreign key here.

create table if not exists public.licensing_authority (
  id text primary key,
  name text not null,
  abbreviation text,
  website text,
  location_path_id text not null
    references public.location_path (location_path_id) on delete restrict,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.license (
  id text primary key,
  officer_id text not null
    references public.officers (id) on delete cascade,
  license_type text not null,
  status text,
  first_awarded date,
  issued_by_authority_id text not null
    references public.licensing_authority (id) on delete restrict,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (officer_id, license_type)
);

create table if not exists public.license_action (
  id text primary key,
  license_id text not null
    references public.license (id) on delete cascade,
  action text not null,
  action_date date,
  status text,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

-- The assignment's "held under a license" link. Nullable (added by the prior
-- migration); set null if the referenced license is ever removed.
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'public'
      and constraint_name = 'agency_officers_license_id_fkey'
  ) then
    alter table public.agency_officers
      add constraint agency_officers_license_id_fkey
      foreign key (license_id)
      references public.license (id) on delete set null;
  end if;
end $$;

create index if not exists license_officer_idx
  on public.license (officer_id);
create index if not exists license_authority_idx
  on public.license (issued_by_authority_id);
create index if not exists license_action_license_idx
  on public.license_action (license_id, action_date);
create index if not exists licensing_authority_location_idx
  on public.licensing_authority (location_path_id);
