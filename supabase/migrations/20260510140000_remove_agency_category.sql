drop trigger if exists agency_set_category on public.agency;
drop function if exists public.set_agency_category();

alter table public.agency
  drop column if exists category;
