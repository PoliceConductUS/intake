alter table public.officers
  add column if not exists deceased_on date null,
  add column if not exists deceased_source text null,
  add column if not exists deceased_message text null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.officers'::regclass
      and conname = 'officers_deceased_on_not_future_check'
  ) then
    alter table public.officers
      drop constraint officers_deceased_on_not_future_check;
  end if;
end $$;

alter table public.officers
  add constraint officers_deceased_on_not_future_check
  check (deceased_on is null or deceased_on <= current_date);

update public.officers
set
  deceased_on = date '2026-02-08',
  deceased_source = 'https://www.ktre.com/2026/02/08/san-augustine-police-officer-dies-duty/',
  deceased_message = 'Reported deceased on February 8, 2026.'
where slug = 'cody-levassar-3403af';

update public.officers
set
  deceased_on = date '2026-02-18',
  deceased_source = 'https://abc13.com/post/off-duty-hcso-deputy-killed-crash-aldine-westfield-north-harris-county-sheriff-says/18615911/',
  deceased_message = 'Reported deceased on February 18, 2026.'
where slug = 'ricky-zaragosa-fb1f53';
