-- Existing Census PLACE/state/county rows remain primary. Supplemental place
-- rows identify their containment precedence; identifiers do not change.
alter table public.location_path
add column resolution_class text not null default 'primary'
check (
    resolution_class in ('primary', 'county_subdivision', 'consolidated_city')
),
add constraint location_path_supplemental_place_only
check (resolution_class = 'primary' or level = 'place');
