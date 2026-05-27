-- Civil case detail pages require claims_summary. Do not let required
-- narrative fields fail silently in templates.
do $$
begin
  if exists (
    select 1
    from public.civil_cases
    where claims_summary is null
       or btrim(claims_summary) = ''
  ) then
    raise exception 'civil_cases.claims_summary must be populated before enforcing NOT NULL';
  end if;
end $$;

alter table public.civil_cases
  alter column claims_summary set not null;

alter table public.civil_cases
  add constraint civil_cases_claims_summary_not_blank
  check (btrim(claims_summary) <> '');
