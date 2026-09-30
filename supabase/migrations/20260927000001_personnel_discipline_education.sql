-- Preserve action and relationship identities.
-- Resolve only unambiguous history.
alter table public.discipline
add column personnel_id text,
add column licensing_authority_id text,
add column document_url text check (char_length(btrim(document_url)) > 0);

do $$
declare
  invalid_ids text;
begin
  select string_agg(id, ', ' order by id) into invalid_ids
  from (
    select d.id
    from public.discipline d
    left join public.discipline_agency_personnel dap on dap.discipline_id = d.id
    left join public.agency_personnel ap on ap.id = dap.agency_personnel_id
    left join public.license l on l.id = ap.license_id
    left join public.authority_license al on al.id = l.authority_license_id
    group by d.id
    having count(distinct ap.personnel_id) <> 1
      or count(distinct al.licensing_authority_id) <> 1
      or count(*) filter (where ap.personnel_id is null or al.licensing_authority_id is null
        or ap.personnel_id is distinct from l.personnel_id) > 0
  ) invalid;
  if invalid_ids is not null then
    raise exception 'Cannot resolve discipline person/issuer identity: %', invalid_ids;
  end if;
end $$;

update public.discipline d
set
    personnel_id = resolved_identity.personnel_id,
    licensing_authority_id = resolved_identity.licensing_authority_id
from (
    select
        dap.discipline_id,
        min(ap.personnel_id) as personnel_id,
        min(al.licensing_authority_id) as licensing_authority_id
    from public.discipline_agency_personnel as dap
    inner join public.agency_personnel as ap on dap.agency_personnel_id = ap.id
    inner join public.license as l on ap.license_id = l.id
    inner join public.authority_license as al on l.authority_license_id = al.id
    group by dap.discipline_id
) as resolved_identity
where d.id = resolved_identity.discipline_id;

alter table public.discipline
alter column personnel_id set not null,
alter column licensing_authority_id set not null,
add foreign key (personnel_id) references public.personnel (
    id
) on delete restrict,
add foreign key (
    licensing_authority_id
) references public.licensing_authority (id) on delete restrict;

create table public.personnel_education (
    id text primary key,
    personnel_id text not null references public.personnel (
        id
    ) on delete restrict,
    -- Keep the approved source field name; quoting conflicts with RF06.
    name text not null check (char_length(btrim(name)) > 0), -- noqa: RF04
    completion_date date,
    credits numeric,
    sponsor_name text,
    sponsor_instructor text,
    created_at timestamp with time zone not null default timezone(
        'utc'::text, now()
    ),
    updated_at timestamp with time zone not null default timezone(
        'utc'::text, now()
    )
);
