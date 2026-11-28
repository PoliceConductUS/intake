-- Public staff and civil-case counts the website shows. The website reads
-- these views and computes no count itself (supply-site-display-data).

-- Employment status of each agency_personnel row, from its dates and the
-- UTC date of the query. A date is the stored column, or the
-- data_source_values effective value when the stored column is null. A date
-- value is valid only as a real YYYY-MM-DD calendar date.
-- Current: no end date, and the start date is absent or a valid date on or
-- before today.
-- Former: a valid end date before today, a start date that is absent or a
-- valid date on or before today, and an end date not before the start date.
-- Unknown: every other row.
create view public.site_agency_personnel_employment as
with assignment_dates as (
    select
        ap.id as agency_personnel_id,
        ap.agency_id,
        ap.personnel_id,
        coalesce(
            to_char(ap.start_date, 'YYYY-MM-DD'),
            ap.data_source_values -> 'start_date' ->> 'effective_value'
        ) as start_value,
        coalesce(
            to_char(ap.end_date, 'YYYY-MM-DD'),
            ap.data_source_values -> 'end_date' ->> 'effective_value'
        ) as end_value,
        to_char(
            (current_timestamp at time zone 'UTC')::date, 'YYYY-MM-DD'
        ) as today
    from public.agency_personnel as ap
),

checked_dates as (
    select
        agency_personnel_id,
        agency_id,
        personnel_id,
        start_value,
        end_value,
        today,
        coalesce(
            start_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            and pg_input_is_valid(start_value, 'date'),
            false
        ) as start_valid,
        coalesce(
            end_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            and pg_input_is_valid(end_value, 'date'),
            false
        ) as end_valid
    from assignment_dates
),

classified_dates as (
    select
        agency_personnel_id,
        agency_id,
        personnel_id,
        start_value,
        end_value,
        today,
        start_valid,
        end_valid,
        (
            start_value is not null
            and (not start_valid or start_value > today)
        ) as start_uncertain
    from checked_dates
)

select
    agency_personnel_id,
    agency_id,
    personnel_id,
    case
        when end_value is null and not start_uncertain then 'Current'
        when
            end_valid
            and end_value < today
            and not start_uncertain
            and not (start_valid and end_value < start_value)
            then 'Former'
        else 'Unknown'
    end as employment_status
from classified_dates;

-- Per agency: agency_personnel rows by employment status, and distinct
-- personnel with a Current row.
create view public.site_agency_count as
select
    a.id as agency_id,
    count(employment.agency_personnel_id)::integer as assignment_count,
    (
        count(employment.agency_personnel_id)
        filter (where employment.employment_status = 'Current')
    )::integer as current_assignment_count,
    (
        count(employment.agency_personnel_id)
        filter (where employment.employment_status = 'Former')
    )::integer as former_assignment_count,
    (
        count(employment.agency_personnel_id)
        filter (where employment.employment_status = 'Unknown')
    )::integer as unknown_assignment_count,
    (
        count(distinct employment.personnel_id)
        filter (where employment.employment_status = 'Current')
    )::integer as current_personnel_count
from public.agency as a
left join public.site_agency_personnel_employment as employment
    on a.id = employment.agency_id
group by a.id;

-- Per federal agency: distinct personnel with a Current row at any agency
-- whose parent_federal_agency_id is that federal agency.
create view public.site_federal_agency_count as
select
    fa.id as federal_agency_id,
    (
        count(distinct employment.personnel_id)
        filter (where employment.employment_status = 'Current')
    )::integer as current_personnel_count
from public.federal_agency as fa
left join public.agency as a
    on fa.id = a.parent_federal_agency_id
left join public.site_agency_personnel_employment as employment
    on a.id = employment.agency_id
group by fa.id;

-- Per state: each person counts once, under the state of the agency on their
-- latest-started Current row (start_date descending, nulls last, then id
-- descending), when that agency has an agency build page. The state is the
-- location_path parent of the agency place's administrative_area parent.
-- The per-agency counts are a materialized CTE: the planner cannot estimate
-- the employment_status filter and otherwise re-sorts every assignment for
-- each location row.
create view public.site_personnel_state_count as
with latest_current_assignment as (
    select distinct on (ap.personnel_id)
        ap.personnel_id,
        ap.agency_id
    from public.agency_personnel as ap
    inner join public.site_agency_personnel_employment as employment
        on
            ap.id = employment.agency_personnel_id
            and employment.employment_status = 'Current'
    order by ap.personnel_id asc, ap.start_date desc nulls last, ap.id desc
),

agency_latest_count as materialized (
    select
        agency_id,
        count(*) as personnel_count
    from latest_current_assignment
    group by agency_id
)

select
    state_lp.location_path_id as state_location_path_id,
    state_lp.path as state_path,
    sum(latest.personnel_count)::integer as listed_personnel_count
from agency_latest_count as latest
inner join public.agency as a
    on latest.agency_id = a.id
inner join public.build_page_payload as bpp
    on
        a.id = bpp.entity_id
        and bpp.page_type = 'agency'
inner join public.location_path as place_lp
    on a.location_path_id = place_lp.location_path_id
inner join public.location_path as area_lp
    on
        place_lp.parent_location_path_id = area_lp.location_path_id
        and area_lp.level = 'administrative_area'
inner join public.location_path as state_lp
    on
        area_lp.parent_location_path_id = state_lp.location_path_id
        and state_lp.level = 'state'
group by state_lp.location_path_id, state_lp.path;

-- Per person: distinct civil cases linked to any of the person's
-- agency_personnel rows, and how many of those have no date_terminated.
create view public.site_personnel_count as
select
    p.id as personnel_id,
    count(distinct cc.id)::integer as civil_case_count,
    (
        count(distinct cc.id) filter (where cc.date_terminated is null)
    )::integer as open_civil_case_count
from public.personnel as p
left join public.agency_personnel as ap
    on p.id = ap.personnel_id
left join public.civil_case_personnel as ccp
    on ap.id = ccp.agency_personnel_id
left join public.civil_cases as cc
    on ccp.civil_case_id = cc.id
group by p.id;
