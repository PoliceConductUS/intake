alter table public.civil_cases
  add column if not exists slug text,
  add column if not exists outcome text,
  add column if not exists primary_source_url text;

alter table public.civil_cases
  rename column summary to claims_summary;

update public.civil_cases civil_case
set slug = concat(
  coalesce(
    nullif(
      lower(
        regexp_replace(
          regexp_replace(
            coalesce(civil_case.cause_number, civil_case.title, 'civil-case'),
            '[^a-zA-Z0-9]+',
            '-',
            'g'
          ),
          '(^-|-$)',
          '',
          'g'
        )
      ),
      ''
    ),
    'civil-case'
  ),
  '-',
  substr(md5(civil_case.id), 1, 6)
)
where civil_case.slug is null;

update public.civil_cases civil_case
set category = category_data.category
from (
  select
    cco.civil_case_id,
    case
      when bool_or(lower(agency.category) = 'federal') then 'federal'
      else min(lower(agency.category))
    end as category
  from public.civil_case_officers cco
  join public.agency_officers agency_officer
    on agency_officer.id = cco.agency_officer_id
  join public.agency agency
    on agency.id = agency_officer.agency_id
  group by cco.civil_case_id
) as category_data
where civil_case.id = category_data.civil_case_id
  and civil_case.category is null;

update public.civil_cases civil_case
set primary_source_url = primary_link.url
from (
  select distinct on (civil_case_id)
    civil_case_id,
    url
  from public.civil_case_links
  order by
    civil_case_id,
    case when coalesce(label, '') = 'CourtListener' then 0 else 1 end,
    created_at,
    id
) as primary_link
where civil_case.id = primary_link.civil_case_id
  and civil_case.primary_source_url is null;

alter table public.civil_case_links
  add column if not exists title text;

update public.civil_case_links
set title = coalesce(
  nullif(title, ''),
  nullif(label, ''),
  regexp_replace(url, '^https?://(www\.)?([^/]+)/?.*$', '\2')
)
where title is null;

delete from public.civil_case_links link
using public.civil_cases civil_case
where link.civil_case_id = civil_case.id
  and civil_case.primary_source_url = link.url;

alter table public.civil_case_links
  alter column title set not null;

alter table public.civil_case_links
  drop column if exists label;

alter table public.civil_cases
  alter column slug set not null,
  alter column category set not null;

create unique index if not exists civil_cases_slug_key
  on public.civil_cases(slug);
