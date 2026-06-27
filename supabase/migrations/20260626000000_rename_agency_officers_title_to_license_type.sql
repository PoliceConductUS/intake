do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agency_officers'
      and column_name = 'title'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agency_officers'
      and column_name = 'license_type'
  ) then
    alter table public.agency_officers
      rename column title to license_type;
  end if;
end $$;

alter table public.agency_officers
  alter column license_type set not null;
