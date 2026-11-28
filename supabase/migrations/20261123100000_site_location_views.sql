-- Plain rule views the site page views read (supply-site-display-data,
-- "Page-shaped views", layer 1). Each holds one rule; the materialized page
-- views in 20261123200000_site_page_views.sql read them.

-- Each location_path row paired with itself and each of its ancestors,
-- following parent_location_path_id. depth is 0 for the row itself.
create view public.site_location_ancestor as
with recursive ancestor as (
    select
        lp.location_path_id,
        lp.location_path_id as ancestor_location_path_id,
        lp.level as ancestor_level,
        lp.parent_location_path_id as next_location_path_id,
        0 as depth
    from public.location_path as lp
    union all
    select
        ancestor.location_path_id,
        parent.location_path_id as ancestor_location_path_id,
        parent.level as ancestor_level,
        parent.parent_location_path_id as next_location_path_id,
        ancestor.depth + 1 as depth
    from ancestor
    inner join public.location_path as parent
        on ancestor.next_location_path_id = parent.location_path_id
)

select
    location_path_id,
    ancestor_location_path_id,
    ancestor_level,
    depth
from ancestor;

-- The state of each location_path row: the state row reached through
-- parent_location_path_id, with its stored path, state_code, display_name and
-- segment. A row with no state ancestor has no row here.
create view public.site_location_state as
select
    ancestor.location_path_id,
    state_lp.location_path_id as state_location_path_id,
    state_lp.path as state_path,
    state_lp.state_code,
    state_lp.display_name as state_name,
    state_lp.segment as state_segment
from public.site_location_ancestor as ancestor
inner join public.location_path as state_lp
    on ancestor.ancestor_location_path_id = state_lp.location_path_id
where ancestor.ancestor_level = 'state';

-- The agency page rule (design.md D7): an agency with at least one Current
-- agency_personnel row (site_agency_personnel_employment) whose place has an
-- administrative_area parent under a state parent. One row per agency with
-- a page, naming its place, area and state rows.
create view public.site_agency_page_selection as
select
    a.id as agency_id,
    place_lp.location_path_id as place_location_path_id,
    area_lp.location_path_id as area_location_path_id,
    state_lp.location_path_id as state_location_path_id
from public.agency as a
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
where exists (
    select 1
    from public.site_agency_personnel_employment as employment
    where
        employment.agency_id = a.id
        and employment.employment_status = 'Current'
);

-- Public counts of each state, area and place row that contains an agency
-- page (design.md D8). Within means the location itself or a descendant,
-- through site_location_ancestor.
-- agency_count: agencies with a page located within.
-- current_personnel_count: distinct people with a Current row at those
-- agencies.
-- report_count: distinct reviews whose location_path_id is within.
-- civil_case_count: distinct civil cases linked through civil_case_personnel
-- to agency_personnel rows of any agency located within (the agency-linked
-- civil case scope; civil_cases.location_path_id is not used).
create view public.site_location_count as
with page_agency_location as (
    select
        selection.agency_id,
        ancestor.ancestor_location_path_id as location_path_id
    from public.site_agency_page_selection as selection
    inner join public.site_location_ancestor as ancestor
        on selection.place_location_path_id = ancestor.location_path_id
),

agency_counts as (
    select
        location_path_id,
        count(*)::integer as agency_count
    from page_agency_location
    group by location_path_id
),

personnel_counts as (
    select
        pal.location_path_id,
        count(distinct employment.personnel_id)::integer
            as current_personnel_count
    from page_agency_location as pal
    inner join public.site_agency_personnel_employment as employment
        on
            pal.agency_id = employment.agency_id
            and employment.employment_status = 'Current'
    group by pal.location_path_id
),

report_counts as (
    select
        ancestor.ancestor_location_path_id as location_path_id,
        count(distinct r.id)::integer as report_count
    from public.reviews as r
    inner join public.site_location_ancestor as ancestor
        on r.location_path_id = ancestor.location_path_id
    group by ancestor.ancestor_location_path_id
),

civil_case_counts as (
    select
        ancestor.ancestor_location_path_id as location_path_id,
        count(distinct ccp.civil_case_id)::integer as civil_case_count
    from public.civil_case_personnel as ccp
    inner join public.agency_personnel as ap
        on ccp.agency_personnel_id = ap.id
    inner join public.agency as a on ap.agency_id = a.id
    inner join public.site_location_ancestor as ancestor
        on a.location_path_id = ancestor.location_path_id
    group by ancestor.ancestor_location_path_id
)

select
    agency_counts.location_path_id,
    agency_counts.agency_count,
    coalesce(personnel_counts.current_personnel_count, 0)
        as current_personnel_count,
    coalesce(report_counts.report_count, 0) as report_count,
    coalesce(civil_case_counts.civil_case_count, 0) as civil_case_count
from agency_counts
left join personnel_counts
    on agency_counts.location_path_id = personnel_counts.location_path_id
left join report_counts
    on agency_counts.location_path_id = report_counts.location_path_id
left join civil_case_counts
    on agency_counts.location_path_id = civil_case_counts.location_path_id;

-- Listed personnel per state (design.md D8), now over the agency page rule
-- instead of build_page_payload (tasks.md 9.4). Each listed person counts
-- once, under the state of the agency on their latest-started Current row
-- (start_date descending, nulls last, then id descending), when that agency
-- has a page.
create or replace view public.site_personnel_state_count as
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
inner join public.site_agency_page_selection as selection
    on latest.agency_id = selection.agency_id
inner join public.location_path as state_lp
    on selection.state_location_path_id = state_lp.location_path_id
group by state_lp.location_path_id, state_lp.path;
