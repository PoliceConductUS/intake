-- The same agency page rule as 20261123100000_site_location_views.sql, written
-- so the planner starts from the agencies with a Current person. The first
-- form let the planner start from the location hierarchy and nest a scan of
-- every agency inside each place row (about 37 s for one scan on the local
-- database); this form takes about 1.4 s. The result is unchanged.
create or replace view public.site_agency_page_selection as
with current_agency as materialized (
    select distinct agency_id
    from public.site_agency_personnel_employment
    where employment_status = 'Current'
),

agency_place as materialized (
    select
        a.id as agency_id,
        place_lp.location_path_id as place_location_path_id,
        place_lp.parent_location_path_id as area_location_path_id
    from current_agency
    inner join public.agency as a on current_agency.agency_id = a.id
    inner join public.location_path as place_lp
        on a.location_path_id = place_lp.location_path_id
)

select
    agency_place.agency_id,
    agency_place.place_location_path_id,
    agency_place.area_location_path_id,
    state_lp.location_path_id as state_location_path_id
from agency_place
inner join public.location_path as area_lp
    on
        agency_place.area_location_path_id = area_lp.location_path_id
        and area_lp.level = 'administrative_area'
inner join public.location_path as state_lp
    on
        area_lp.parent_location_path_id = state_lp.location_path_id
        and state_lp.level = 'state';
