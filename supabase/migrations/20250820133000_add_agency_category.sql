create or replace function public.set_agency_category()
returns trigger
language plpgsql
as $$
begin
  if new.category is null then
    new.category := lower(new.state);
  end if;
  return new;
end;
$$;

alter table public.agency
  add column if not exists category text;

update public.agency
set category = lower(state)
where category is null;

-- Seeded IDs must be explicit and stable across database resets. Do not use
-- public.generate_cuid(), gen_random_uuid(), default-generated IDs, or any other
-- runtime ID generator in migrations or seed data.
with federal_rows(id, name, city, state, address, zip_code) as (
  values
    ('cgsmkptihlupk5bjwyvdgtcq', 'Federal Bureau of Investigation (FBI)', 'Washington', 'DC', '935 Pennsylvania Avenue NW', '20535'),
    ('cv04crq73alq62kp5v0s3fx3', 'Drug Enforcement Administration (DEA)', 'Washington', 'DC', '8701 Morrissette Drive', '22152'),
    ('cjtbmujxlur44dvljhfprrx1', 'Bureau of Alcohol, Tobacco, Firearms and Explosives (ATF)', 'Washington', 'DC', '99 New York Avenue NE', '20226'),
    ('cs2sz1y65zqybhahepchwol6', 'U.S. Marshals Service', 'Washington', 'DC', '510 5th Street NW', '20530'),
    ('czyyk2hqe9ke2kq3cg9nodb4', 'U.S. Immigration and Customs Enforcement (ICE)', 'Washington', 'DC', '500 12th Street SW', '20536'),
    ('cufdb3i3jzsr5kkfuto7huqk', 'U.S. Customs and Border Protection (CBP)', 'Washington', 'DC', '1300 Pennsylvania Avenue NW', '20229'),
    ('cato8mt9eyb6zrazpvbis0hz', 'U.S. Secret Service (USSS)', 'Washington', 'DC', '245 Murray Lane SW', '20223'),
    ('chvdwkxp1cjwertwzt6ll9b0', 'Transportation Security Administration (TSA)', 'Springfield', 'VA', '6595 Springfield Center Drive', '22150'),
    ('c887sm2ibjg8c2yp4e4f4es5', 'U.S. Coast Guard (USCG)', 'Washington', 'DC', '2703 Martin Luther King Jr Ave SE', '20593')
)
insert into public.agency (
  id,
  name,
  city,
  state,
  address,
  zip_code,
  category,
  created_at,
  updated_at,
  slug
)
select
  id,
  name,
  city,
  state,
  address,
  zip_code,
  'federal',
  timezone('utc'::text, now()),
  timezone('utc'::text, now()),
  public.slugify(name) || '-' || public.hash_id(id)
from federal_rows
on conflict (slug) do update
set name = excluded.name,
    city = excluded.city,
    state = excluded.state,
    address = excluded.address,
    zip_code = excluded.zip_code,
    category = excluded.category,
    updated_at = excluded.updated_at;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'agency_set_category'
  ) then
    create trigger agency_set_category
      before insert or update on public.agency
      for each row
      execute function public.set_agency_category();
  end if;
end;
$$;

alter table public.agency
  alter column category set not null;
