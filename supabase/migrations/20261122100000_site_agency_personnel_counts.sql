-- Per-agency staff counts of distinct people, and indexes for per-agency and
-- per-person agency_personnel lookups.

create index if not exists agency_personnel_agency_id_idx
on public.agency_personnel (agency_id);

create index if not exists agency_personnel_personnel_id_idx
on public.agency_personnel (personnel_id);

-- Per agency: agency_personnel rows by employment status, and distinct
-- personnel by their status at that agency. A person's status at an agency is
-- the first of Current, Unknown, Former that any of the person's rows there
-- has, so each person counts in exactly one of current_personnel_count,
-- unknown_personnel_count and former_personnel_count, and the three add up to
-- personnel_count.
create or replace view public.site_agency_count as
with personnel_rows as (
    select
        agency_id,
        personnel_id,
        count(*) as assignment_count,
        count(*) filter (
            where employment_status = 'Current'
        ) as current_assignment_count,
        count(*) filter (
            where employment_status = 'Former'
        ) as former_assignment_count,
        count(*) filter (
            where employment_status = 'Unknown'
        ) as unknown_assignment_count
    from public.site_agency_personnel_employment
    group by agency_id, personnel_id
)

select
    a.id as agency_id,
    coalesce(sum(pr.assignment_count), 0)::integer as assignment_count,
    coalesce(
        sum(pr.current_assignment_count), 0
    )::integer as current_assignment_count,
    coalesce(
        sum(pr.former_assignment_count), 0
    )::integer as former_assignment_count,
    coalesce(
        sum(pr.unknown_assignment_count), 0
    )::integer as unknown_assignment_count,
    (
        count(pr.personnel_id)
        filter (where pr.current_assignment_count > 0)
    )::integer as current_personnel_count,
    count(pr.personnel_id)::integer as personnel_count,
    (
        count(pr.personnel_id)
        filter (
            where
            pr.current_assignment_count = 0
            and pr.unknown_assignment_count = 0
        )
    )::integer as former_personnel_count,
    (
        count(pr.personnel_id)
        filter (
            where
            pr.current_assignment_count = 0
            and pr.unknown_assignment_count > 0
        )
    )::integer as unknown_personnel_count
from public.agency as a
left join personnel_rows as pr
    on a.id = pr.agency_id
group by a.id;
