-- License 3NF. A license TYPE scoped by its issuing authority becomes its own
-- entity (authority_license); `license` is the officer's holding of one such type,
-- converged by the unique (personnel_id, authority_license_id) business key. Every
-- row keeps its cuid id, so existing rows are found by the unique columns on
-- re-import — no id migration. `canonical_license_type` must match
-- src/shared/license.ts (collapse whitespace, drop a trailing " License").

create or replace function public.canonical_license_type(raw text)
  returns text language sql immutable as $$
    select regexp_replace(
      regexp_replace(btrim(raw), '\s+', ' ', 'g'),
      '\s+license$', '', 'i'
    )
  $$;

create table if not exists public.authority_license (
  id text primary key,
  licensing_authority_id text not null
    references public.licensing_authority (id) on delete restrict,
  name text not null,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  constraint authority_license_name_not_blank check (char_length(btrim(name)) > 0),
  unique (licensing_authority_id, name)
);

-- One authority_license per distinct (authority, canonical type) in existing data.
insert into public.authority_license (id, licensing_authority_id, name)
select 'authlic-' || md5(t.authority || '|' || t.name), t.authority, t.name
from (
  select distinct
    issued_by_authority_id as authority,
    public.canonical_license_type(license_type) as name
  from public.license
) t
on conflict (licensing_authority_id, name) do nothing;

alter table public.license add column if not exists authority_license_id text;

update public.license l
set authority_license_id = al.id
from public.authority_license al
where al.licensing_authority_id = l.issued_by_authority_id
  and al.name = public.canonical_license_type(l.license_type);

alter table public.license
  alter column authority_license_id set not null,
  add constraint license_authority_license_id_fkey
    foreign key (authority_license_id)
    references public.authority_license (id) on delete restrict;

alter table public.license
  drop constraint if exists license_officer_id_license_type_key;
alter table public.license
  drop constraint if exists license_personnel_id_license_type_key;
alter table public.license
  add constraint license_personnel_id_authority_license_id_key
    unique (personnel_id, authority_license_id);

-- The type name and issuing authority now live on authority_license.
alter table public.license drop column license_type;
alter table public.license drop column issued_by_authority_id;

create index if not exists authority_license_authority_idx
  on public.authority_license (licensing_authority_id);
create index if not exists license_authority_license_idx
  on public.license (authority_license_id);

drop function public.canonical_license_type(text);
