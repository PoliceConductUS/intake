do $$
begin
  if not exists (
    select 1
    from pg_extension
    where extname = 'pgcrypto'
  ) then
    create extension pgcrypto;
  end if;
end $$;

create or replace function public.hash_id(value text)
returns text
language sql
immutable
as $$
  select substr(encode(digest(value, 'sha1'), 'hex'), 1, 6);
$$;

create or replace function public.slugify(value text)
returns text
language sql
immutable
as $$
  select case
    when value is null or btrim(value) = '' then 'unknown'
    else regexp_replace(
      regexp_replace(lower(value), '[^a-z0-9]+', '-', 'g'),
      '(^-|-$)',
      '',
      'g'
    )
  end;
$$;

alter table public.agency
  add column if not exists slug text;

alter table public.officers
  add column if not exists slug text;

alter table public.reviews
  add column if not exists slug text;

update public.agency
set slug = public.slugify(name) || '-' || public.hash_id(id)
where slug is null;

update public.officers
set slug = public.slugify(trim(concat_ws(' ', first_name, last_name, suffix)))
  || '-' || public.hash_id(id)
where slug is null;

update public.reviews
set slug = concat_ws(
  '-',
  coalesce(to_char(incident_date, 'YYYY-MM-DD'), 'unknown-date'),
  coalesce(substring(address from '(\\d{5})'), '75061'),
  public.slugify(title),
  public.hash_id(id)
)
where slug is null;

alter table public.agency
  alter column slug set not null;

alter table public.officers
  alter column slug set not null;

alter table public.reviews
  alter column slug set not null;

create unique index if not exists agency_slug_key
  on public.agency(slug);

create unique index if not exists officers_slug_key
  on public.officers(slug);

create unique index if not exists reviews_slug_key
  on public.reviews(slug);
