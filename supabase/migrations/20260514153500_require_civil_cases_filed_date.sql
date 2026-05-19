do $$
begin
  if exists (select 1 from public.civil_cases where filed_date is null) then
    raise exception 'civil_cases.filed_date must be populated for every civil case before enforcing NOT NULL';
  end if;
end $$;

alter table public.civil_cases
  alter column filed_date set not null;
