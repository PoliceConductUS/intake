-- Materialized page and list views the website build reads (supply-site-
-- display-data, "Page-shaped views", layer 2). One row of a page view holds
-- everything the page container renders; a list on a page is read from a
-- list view by a parent-path column. Views promise no order (design.md D10).
-- The views are created empty; public.refresh_site_projections() fills them
-- in dependency order, so "today" in the employment rule is the refresh time
-- for the whole build, and then runs public.assert_site_projections().

-- Agency pages (design.md D7 rule, site_agency_page_selection). Counts:
-- staff from site_agency_count; report_count: distinct reviews linked through
-- review_personnel to the agency's agency_personnel rows (today's rule;
-- reviews.agency_id is not built yet, tasks.md 2.5); civil_case_count:
-- distinct civil cases linked to the agency's own agency_personnel rows;
-- discipline_count: distinct discipline rows linked through
-- discipline_agency_personnel to them. lastmod: the latest updated_at or
-- created_at of the agency, its agency_personnel rows, their personnel, and
-- the reviews and civil cases linked to them (today's sitemap rule).
create materialized view public.site_agency_page as
with agency_lastmod as (
    select
        a.id as agency_id,
        greatest(
            a.updated_at,
            a.created_at,
            max(ap.updated_at),
            max(p.updated_at),
            max(r.updated_at),
            max(c.updated_at)
        ) as lastmod
    from public.site_agency_page_selection as selection
    inner join public.agency as a on selection.agency_id = a.id
    left join public.agency_personnel as ap on a.id = ap.agency_id
    left join public.personnel as p on ap.personnel_id = p.id
    left join public.review_personnel as rp on ap.id = rp.agency_personnel_id
    left join public.reviews as r on rp.review_id = r.id
    left join public.civil_case_personnel as ccp
        on ap.id = ccp.agency_personnel_id
    left join public.civil_cases as c on ccp.civil_case_id = c.id
    group by a.id
),

report_counts as (
    select
        ap.agency_id,
        count(distinct rp.review_id)::integer as report_count
    from public.agency_personnel as ap
    inner join public.review_personnel as rp
        on ap.id = rp.agency_personnel_id
    group by ap.agency_id
),

civil_case_counts as (
    select
        ap.agency_id,
        count(distinct ccp.civil_case_id)::integer as civil_case_count
    from public.agency_personnel as ap
    inner join public.civil_case_personnel as ccp
        on ap.id = ccp.agency_personnel_id
    group by ap.agency_id
),

discipline_counts as (
    select
        ap.agency_id,
        count(distinct dap.discipline_id)::integer as discipline_count
    from public.agency_personnel as ap
    inner join public.discipline_agency_personnel as dap
        on ap.id = dap.agency_personnel_id
    group by ap.agency_id
)

select
    a.id as agency_id,
    a.slug,
    a.name,
    a.status,
    a.status_date,
    a.address,
    a.city,
    a.state,
    a.zip_code,
    a.contact_name,
    a.contact_email,
    a.latitude,
    a.longitude,
    a.created_at,
    a.updated_at,
    place_lp.path as place_path,
    place_lp.display_name as place_name,
    place_lp.segment as place_segment,
    area_lp.path as area_path,
    area_lp.display_name as area_name,
    area_lp.segment as area_segment,
    state_lp.path as state_path,
    state_lp.display_name as state_name,
    state_lp.segment as state_segment,
    state_lp.state_code,
    fa.id as federal_agency_id,
    fa.name as federal_agency_name,
    counts.personnel_count,
    counts.current_personnel_count,
    counts.former_personnel_count,
    counts.unknown_personnel_count,
    counts.assignment_count,
    agency_lastmod.lastmod,
    place_lp.path || a.slug || '/' as path,
    '/federal/' || fa.slug || '/' as federal_agency_path,
    coalesce(report_counts.report_count, 0) as report_count,
    coalesce(civil_case_counts.civil_case_count, 0) as civil_case_count,
    coalesce(discipline_counts.discipline_count, 0) as discipline_count
from public.site_agency_page_selection as selection
inner join public.agency as a on selection.agency_id = a.id
inner join public.location_path as place_lp
    on selection.place_location_path_id = place_lp.location_path_id
inner join public.location_path as area_lp
    on selection.area_location_path_id = area_lp.location_path_id
inner join public.location_path as state_lp
    on selection.state_location_path_id = state_lp.location_path_id
inner join public.site_agency_count as counts on a.id = counts.agency_id
inner join agency_lastmod on a.id = agency_lastmod.agency_id
left join public.federal_agency as fa on a.parent_federal_agency_id = fa.id
left join report_counts on a.id = report_counts.agency_id
left join civil_case_counts on a.id = civil_case_counts.agency_id
left join discipline_counts on a.id = discipline_counts.agency_id
with no data;

create unique index site_agency_page_path_idx on public.site_agency_page (path);
create unique index site_agency_page_agency_id_idx
on public.site_agency_page (agency_id);
create index site_agency_page_place_path_idx
on public.site_agency_page (place_path);
create index site_agency_page_area_path_idx
on public.site_agency_page (area_path);
create index site_agency_page_state_path_idx
on public.site_agency_page (state_path);
create index site_agency_page_federal_agency_path_idx
on public.site_agency_page (federal_agency_path);

-- Phone numbers of agencies with a page.
create materialized view public.site_agency_phone as
select
    phone.id as agency_phone_number_id,
    phone.agency_id,
    agency_page.path as agency_path,
    phone.phone_number,
    phone.description
from public.agency_phone_numbers as phone
inner join public.site_agency_page as agency_page
    on phone.agency_id = agency_page.agency_id
with no data;

create unique index site_agency_phone_id_idx
on public.site_agency_phone (agency_phone_number_id);
create index site_agency_phone_agency_path_idx
on public.site_agency_phone (agency_path);

-- State, area and place pages: each location that contains an agency page
-- (design.md D7). Counts come from site_location_count. child_count: child
-- location pages (state, area) or agency pages (place). The one-child
-- shortcut: only_child_* names the single agency page when agency_count is
-- 1, else the single child place page of an area with one child place, else
-- is null. Map point and bounds come from the stored centroid and bbox; a
-- location without them has none. area_* is the row itself for an area and
-- its parent for a place. lastmod: the latest agency page lastmod within; a
-- state also takes the latest change to personnel with an assignment at an
-- agency in the state (their assignment, agency, reports and civil cases),
-- to civil cases whose incident location is in the state and to reports in
-- the state (today's sitemap rule).
create materialized view public.site_location_page as
with location_agency as (
    select
        ancestor.ancestor_location_path_id as location_path_id,
        count(*) as agency_page_count,
        max(agency_page.lastmod) as lastmod,
        (array_agg(agency_page.path))[1] as first_agency_path,
        (array_agg(agency_page.name))[1] as first_agency_name,
        (array_agg(agency_page.place_name))[1] as first_agency_place_name
    from public.site_agency_page as agency_page
    inner join public.site_agency_page_selection as selection
        on agency_page.agency_id = selection.agency_id
    inner join public.site_location_ancestor as ancestor
        on selection.place_location_path_id = ancestor.location_path_id
    group by ancestor.ancestor_location_path_id
),

child_location as (
    select
        lp.parent_location_path_id as location_path_id,
        count(*) as child_count,
        (array_agg(lp.path))[1] as first_child_path,
        (array_agg(lp.display_name))[1] as first_child_name
    from location_agency
    inner join public.location_path as lp
        on location_agency.location_path_id = lp.location_path_id
    where lp.parent_location_path_id is not null
    group by lp.parent_location_path_id
),

person_summary as (
    select
        ap.personnel_id,
        max(r.updated_at) as report_updated_at,
        max(c.updated_at) as civil_case_updated_at
    from public.agency_personnel as ap
    left join public.review_personnel as rp on ap.id = rp.agency_personnel_id
    left join public.reviews as r on rp.review_id = r.id
    left join public.civil_case_personnel as ccp
        on ap.id = ccp.agency_personnel_id
    left join public.civil_cases as c on ccp.civil_case_id = c.id
    group by ap.personnel_id
),

state_personnel_lastmod as (
    select
        agency_state.state_location_path_id,
        max(
            greatest(
                p.updated_at,
                p.created_at,
                ap.updated_at,
                ap.created_at,
                a.updated_at,
                person_summary.report_updated_at,
                person_summary.civil_case_updated_at
            )
        ) as lastmod
    from public.agency_personnel as ap
    inner join public.personnel as p on ap.personnel_id = p.id
    inner join public.agency as a on ap.agency_id = a.id
    inner join public.site_location_state as agency_state
        on a.location_path_id = agency_state.location_path_id
    inner join person_summary on ap.personnel_id = person_summary.personnel_id
    group by agency_state.state_location_path_id
),

state_record_lastmod as (
    select
        record_state.state_location_path_id,
        max(greatest(record.updated_at, record.created_at)) as lastmod
    from (
        select
            location_path_id,
            updated_at,
            created_at
        from public.reviews
        union all
        select
            location_path_id,
            updated_at,
            created_at
        from public.civil_cases
    ) as record
    inner join public.site_location_state as record_state
        on record.location_path_id = record_state.location_path_id
    group by record_state.state_location_path_id
)

select
    lp.path,
    lp.location_path_id,
    lp.level,
    lp.display_name,
    lp.segment,
    parent_lp.path as parent_path,
    lp.parent_location_path_id,
    location_state.state_path,
    location_state.state_name,
    location_state.state_segment,
    location_state.state_code,
    area_lp.path as area_path,
    area_lp.display_name as area_name,
    area_lp.segment as area_segment,
    counts.agency_count,
    counts.current_personnel_count,
    counts.report_count,
    counts.civil_case_count,
    case
        when lp.level = 'place' then location_agency.agency_page_count
        else coalesce(child_location.child_count, 0)
    end::integer as child_count,
    case
        when location_agency.agency_page_count = 1
            then location_agency.first_agency_path
        when lp.level = 'administrative_area' and child_location.child_count = 1
            then child_location.first_child_path
    end as only_child_path,
    case
        when location_agency.agency_page_count = 1
            then location_agency.first_agency_name
        when lp.level = 'administrative_area' and child_location.child_count = 1
            then child_location.first_child_name
    end as only_child_name,
    case
        when location_agency.agency_page_count = 1 then 'agency'
        when
            lp.level = 'administrative_area' and child_location.child_count = 1
            then 'place'
    end as only_child_level,
    case
        when location_agency.agency_page_count = 1
            then location_agency.first_agency_place_name
    end as only_child_place_name,
    st_y(lp.centroid::geometry) as map_latitude,
    st_x(lp.centroid::geometry) as map_longitude,
    st_ymin(lp.bbox) as map_min_latitude,
    st_xmin(lp.bbox) as map_min_longitude,
    st_ymax(lp.bbox) as map_max_latitude,
    st_xmax(lp.bbox) as map_max_longitude,
    case
        when lp.level = 'state'
            then
                greatest(
                    location_agency.lastmod,
                    state_personnel_lastmod.lastmod,
                    state_record_lastmod.lastmod
                )
        else location_agency.lastmod
    end as lastmod
from location_agency
inner join public.location_path as lp
    on location_agency.location_path_id = lp.location_path_id
inner join public.site_location_count as counts
    on lp.location_path_id = counts.location_path_id
left join public.location_path as parent_lp
    on lp.parent_location_path_id = parent_lp.location_path_id
left join public.site_location_state as location_state
    on lp.location_path_id = location_state.location_path_id
left join public.location_path as area_lp
    on
        area_lp.level = 'administrative_area'
        and area_lp.location_path_id = case
            when lp.level = 'administrative_area' then lp.location_path_id
            when lp.level = 'place' then lp.parent_location_path_id
        end
left join child_location
    on lp.location_path_id = child_location.location_path_id
left join state_personnel_lastmod
    on lp.location_path_id = state_personnel_lastmod.state_location_path_id
left join state_record_lastmod
    on lp.location_path_id = state_record_lastmod.state_location_path_id
with no data;

create unique index site_location_page_path_idx
on public.site_location_page (path);
create unique index site_location_page_location_path_id_idx
on public.site_location_page (location_path_id);
create index site_location_page_parent_path_idx
on public.site_location_page (parent_path);
create index site_location_page_state_path_idx
on public.site_location_page (state_path);

-- The home and /personnel/ state maps: one row per state with an agency page
-- (owner, 2026-11-22).
create materialized view public.site_state_map as
select
    location_page.state_code,
    location_page.path,
    location_page.display_name,
    location_page.agency_count,
    coalesce(state_count.listed_personnel_count, 0) as listed_personnel_count
from public.site_location_page as location_page
left join public.site_personnel_state_count as state_count
    on location_page.location_path_id = state_count.state_location_path_id
where location_page.level = 'state'
with no data;

create unique index site_state_map_path_idx on public.site_state_map (path);
create unique index site_state_map_state_code_idx
on public.site_state_map (state_code);

-- Personnel pages: every person with at least one agency_personnel row
-- (design.md D7). One row holds everything the personnel page container
-- renders: names, the headline assignment (the D12 rule, below), the
-- schema.org worksFor agency (only when the headline is Current), counts, the
-- page title and description (the website's former wording, moved), the
-- state of the headline agency and lastmod.
-- Headline rule (design.md D12): Current when the person has a Current row
-- (the latest-started Current row); else Recorded when the person has an
-- Unknown row (the latest-started row); else Most recent (the row with the
-- latest end date, then the latest start date). Dates are the stored column,
-- or the data_source_values effective value when the column is null and the
-- value is a real YYYY-MM-DD date. An absent start date sorts first; ties go
-- to the greatest id.
-- Counts: agency_count (distinct agencies of the person's rows),
-- report_count (distinct reviews linked to them), civil_case_count and
-- open_civil_case_count (site_personnel_count), discipline_count (discipline
-- rows of the person from any source).
-- lastmod: the latest updated_at or created_at of the person, their
-- agency_personnel rows and agencies, and the reviews and civil cases linked
-- to them (today's sitemap rule).
create materialized view public.site_personnel_page as
with assignment as (
    select
        ap.id as agency_personnel_id,
        ap.personnel_id,
        ap.agency_id,
        ap.title,
        ap.badge_number,
        employment.employment_status,
        coalesce(
            ap.start_date,
            case
                when
                    ap.data_source_values -> 'start_date' ->> 'effective_value'
                    ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                    and pg_input_is_valid(
                        ap.data_source_values
                        -> 'start_date' ->> 'effective_value',
                        'date'
                    )
                    then
                        (
                            ap.data_source_values
                            -> 'start_date' ->> 'effective_value'
                        )::date
            end
        ) as start_date,
        coalesce(
            ap.end_date,
            case
                when
                    ap.data_source_values -> 'end_date' ->> 'effective_value'
                    ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                    and pg_input_is_valid(
                        ap.data_source_values
                        -> 'end_date' ->> 'effective_value',
                        'date'
                    )
                    then
                        (
                            ap.data_source_values
                            -> 'end_date' ->> 'effective_value'
                        )::date
            end
        ) as end_date
    from public.agency_personnel as ap
    inner join public.site_agency_personnel_employment as employment
        on ap.id = employment.agency_personnel_id
),

person_assignment as (
    select
        agency_personnel_id,
        personnel_id,
        agency_id,
        title,
        badge_number,
        employment_status,
        start_date,
        end_date,
        case
            when
                bool_or(employment_status = 'Current')
                    over (partition by personnel_id)
                then 'Current'
            when
                bool_or(employment_status = 'Unknown')
                    over (partition by personnel_id)
                then 'Recorded'
            else 'Most recent'
        end as headline_basis
    from assignment
),

headline as (
    select distinct on (personnel_id)
        personnel_id,
        agency_personnel_id,
        agency_id,
        title,
        badge_number,
        employment_status,
        end_date,
        headline_basis
    from person_assignment
    order by
        personnel_id asc,
        (headline_basis <> 'Current' or employment_status = 'Current') desc,
        (
            case when headline_basis = 'Most recent' then end_date end
        ) desc nulls last,
        start_date desc nulls last,
        agency_personnel_id desc
),

person_summary as (
    select
        ap.personnel_id,
        count(distinct ap.agency_id)::integer as agency_count,
        count(distinct rp.review_id)::integer as report_count,
        greatest(
            max(ap.updated_at),
            max(a.updated_at),
            max(r.updated_at),
            max(c.updated_at)
        ) as related_lastmod
    from public.agency_personnel as ap
    inner join public.agency as a on ap.agency_id = a.id
    left join public.review_personnel as rp on ap.id = rp.agency_personnel_id
    left join public.reviews as r on rp.review_id = r.id
    left join public.civil_case_personnel as ccp
        on ap.id = ccp.agency_personnel_id
    left join public.civil_cases as c on ccp.civil_case_id = c.id
    group by ap.personnel_id
),

discipline_counts as (
    select
        personnel_id,
        count(*)::integer as discipline_count
    from public.discipline
    group by personnel_id
),

page as (
    select
        p.id as personnel_id,
        p.slug,
        p.prefix,
        p.first_name,
        p.middle_name,
        p.last_name,
        p.suffix,
        p.deceased_on,
        p.deceased_message,
        headline.agency_personnel_id as headline_agency_personnel_id,
        headline.agency_id as headline_agency_id,
        headline_agency.name as headline_agency_name,
        headline_agency_page.path as headline_agency_path,
        headline.title as headline_title,
        headline.badge_number as headline_badge_number,
        headline.employment_status as headline_employment_status,
        headline.end_date as headline_end_date,
        headline.headline_basis,
        agency_state.state_path,
        agency_state.state_code,
        person_summary.agency_count,
        person_summary.report_count,
        counts.civil_case_count,
        counts.open_civil_case_count,
        concat_ws(
            ' ', p.prefix, p.first_name, p.middle_name, p.last_name, p.suffix
        ) as full_name,
        coalesce(discipline_counts.discipline_count, 0) as discipline_count,
        greatest(
            p.updated_at, p.created_at, person_summary.related_lastmod
        ) as lastmod
    from headline
    inner join public.personnel as p on headline.personnel_id = p.id
    inner join public.agency as headline_agency
        on headline.agency_id = headline_agency.id
    inner join person_summary on p.id = person_summary.personnel_id
    inner join public.site_personnel_count as counts
        on p.id = counts.personnel_id
    left join public.site_agency_page as headline_agency_page
        on headline.agency_id = headline_agency_page.agency_id
    left join public.site_location_state as agency_state
        on headline_agency.location_path_id = agency_state.location_path_id
    left join discipline_counts on p.id = discipline_counts.personnel_id
)

select
    personnel_id,
    slug,
    prefix,
    first_name,
    middle_name,
    last_name,
    suffix,
    full_name,
    deceased_on,
    deceased_message,
    headline_agency_personnel_id,
    headline_agency_id,
    headline_agency_name,
    headline_agency_path,
    headline_title,
    headline_badge_number,
    headline_employment_status,
    headline_end_date,
    headline_basis,
    state_path,
    state_code,
    agency_count,
    report_count,
    civil_case_count,
    open_civil_case_count,
    discipline_count,
    lastmod,
    '/personnel/' || slug || '/' as path,
    case
        when headline_basis = 'Current'
            then headline_agency_name
    end as works_for_agency_name,
    case
        when headline_basis = 'Current'
            then headline_agency_path
    end as works_for_agency_path,
    case when deceased_on is not null then 'Deceased: ' else '' end
    || 'Personnel '
    || full_name
    || ' | '
    || case headline_basis
        when 'Current' then headline_agency_name
        when 'Most recent' then 'Most recent: ' || headline_agency_name
        else 'Recorded: ' || headline_agency_name
    end
    || ' | PoliceConduct.org' as page_title,
    case
        when deceased_on is not null
            then
                full_name
                || ' personnel profile with agency assignments, public'
                || ' reports, and civil litigation records'
                || '; reported deceased on '
                || to_char(deceased_on, 'Mon FMDD, YYYY')
                || '.'
        else
            full_name
            || ' personnel profile with '
            || case headline_basis
                when 'Current' then 'current agency'
                when 'Most recent' then 'most recent agency'
                else 'recorded agency'
            end
            || ' '
            || headline_agency_name
            || case
                when
                    headline_basis <> 'Current'
                    and headline_employment_status = 'Former'
                    and headline_end_date is not null
                    then
                        ' (assignment ended '
                        || to_char(headline_end_date, 'Mon FMDD, YYYY')
                        || ')'
                else ''
            end
            || ', agency assignments, public reports, coverage, and civil'
            || ' litigation records.'
    end as page_description
from page
with no data;

create unique index site_personnel_page_path_idx
on public.site_personnel_page (path);
create unique index site_personnel_page_personnel_id_idx
on public.site_personnel_page (personnel_id);
create index site_personnel_page_headline_agency_path_idx
on public.site_personnel_page (headline_agency_path);

-- Every agency_personnel row, for the agency roster and the personnel
-- assignment table. agency_path is null when the agency has no page. The
-- person's report_count, civil_case_count and discipline_count are those of
-- site_personnel_page.
create materialized view public.site_assignment as
select
    ap.id as agency_personnel_id,
    ap.personnel_id,
    personnel_page.path as personnel_path,
    personnel_page.slug as personnel_slug,
    personnel_page.prefix,
    personnel_page.first_name,
    personnel_page.middle_name,
    personnel_page.last_name,
    personnel_page.suffix,
    personnel_page.full_name,
    ap.agency_id,
    a.name as agency_name,
    agency_page.path as agency_path,
    ap.title,
    ap.badge_number,
    ap.start_date,
    ap.end_date,
    employment.employment_status,
    personnel_page.report_count as person_report_count,
    personnel_page.civil_case_count as person_civil_case_count,
    personnel_page.discipline_count as person_discipline_count
from public.agency_personnel as ap
inner join public.agency as a on ap.agency_id = a.id
inner join public.site_agency_personnel_employment as employment
    on ap.id = employment.agency_personnel_id
inner join public.site_personnel_page as personnel_page
    on ap.personnel_id = personnel_page.personnel_id
left join public.site_agency_page as agency_page
    on ap.agency_id = agency_page.agency_id
with no data;

create unique index site_assignment_agency_personnel_id_idx
on public.site_assignment (agency_personnel_id);
create index site_assignment_personnel_path_idx
on public.site_assignment (personnel_path);
create index site_assignment_agency_path_idx
on public.site_assignment (agency_path);

-- People listed on /personnel/ (design.md D7): the person's latest-started
-- Current row (start_date descending, nulls last, then id descending) is at
-- an agency with a page. state_* is that agency's state; the agency named
-- for the person is the headline agency of site_personnel_page.
create materialized view public.site_personnel_listing as
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
)

select
    personnel_page.path,
    personnel_page.personnel_id,
    personnel_page.slug,
    personnel_page.first_name,
    personnel_page.last_name,
    personnel_page.suffix,
    personnel_page.full_name,
    personnel_page.headline_agency_name,
    personnel_page.headline_agency_path,
    agency_page.state_path,
    agency_page.state_code
from latest_current_assignment as latest
inner join public.site_agency_page as agency_page
    on latest.agency_id = agency_page.agency_id
inner join public.site_personnel_page as personnel_page
    on latest.personnel_id = personnel_page.personnel_id
with no data;

create unique index site_personnel_listing_path_idx
on public.site_personnel_listing (path);
create index site_personnel_listing_state_path_idx
on public.site_personnel_listing (state_path);

-- Report pages: every review with an incident date. path is
-- /{location path}reports/{year}/{month}/{day}/{slug}/ from the stored
-- location path, the UTC date of incident_date and the slug. The report's
-- agency is not in this view until reviews.agency_id exists (tasks.md 2.5);
-- the agencies of the linked personnel are in site_report_personnel.
-- lastmod: the latest of updated_at and created_at.
create materialized view public.site_report_page as
select
    r.id as review_id,
    r.slug,
    r.title,
    r.address,
    r.latitude,
    r.longitude,
    lp.path as place_path,
    lp.display_name as place_name,
    lp.segment as place_segment,
    lp.level as place_level,
    area_lp.path as area_path,
    area_lp.display_name as area_name,
    area_lp.segment as area_segment,
    location_state.state_path,
    location_state.state_name,
    location_state.state_segment,
    location_state.state_code,
    r.created_at,
    r.updated_at,
    lp.path
    || 'reports/'
    || to_char(r.incident_date at time zone 'UTC', 'YYYY/MM/DD')
    || '/'
    || r.slug
    || '/' as path,
    (r.incident_date at time zone 'UTC')::date as incident_date,
    to_char(r.incident_date at time zone 'UTC', 'YYYY') as year,
    to_char(r.incident_date at time zone 'UTC', 'MM') as month,
    to_char(r.incident_date at time zone 'UTC', 'DD') as day,
    greatest(r.updated_at, r.created_at) as lastmod
from public.reviews as r
inner join public.location_path as lp
    on r.location_path_id = lp.location_path_id
left join public.location_path as area_lp
    on
        lp.parent_location_path_id = area_lp.location_path_id
        and area_lp.level = 'administrative_area'
left join public.site_location_state as location_state
    on lp.location_path_id = location_state.location_path_id
where r.incident_date is not null
with no data;

create unique index site_report_page_path_idx on public.site_report_page (
    path
);
create unique index site_report_page_review_id_idx
on public.site_report_page (review_id);
create index site_report_page_place_path_idx
on public.site_report_page (place_path);

-- Each review_personnel row of a report page, with the person and the
-- assignment's agency (agency_path null when the agency has no page).
create materialized view public.site_report_personnel as
select
    rp.id as review_personnel_id,
    report_page.path as report_path,
    report_page.review_id,
    report_page.title as report_title,
    report_page.incident_date,
    personnel_page.path as personnel_path,
    personnel_page.personnel_id,
    personnel_page.slug as personnel_slug,
    personnel_page.first_name,
    personnel_page.last_name,
    personnel_page.suffix,
    personnel_page.full_name,
    ap.title as assignment_title,
    ap.agency_id,
    a.name as agency_name,
    agency_page.path as agency_path
from public.review_personnel as rp
inner join public.site_report_page as report_page
    on rp.review_id = report_page.review_id
inner join public.agency_personnel as ap on rp.agency_personnel_id = ap.id
inner join public.agency as a on ap.agency_id = a.id
inner join public.site_personnel_page as personnel_page
    on ap.personnel_id = personnel_page.personnel_id
left join public.site_agency_page as agency_page
    on ap.agency_id = agency_page.agency_id
with no data;

create unique index site_report_personnel_id_idx
on public.site_report_personnel (review_personnel_id);
create index site_report_personnel_report_path_idx
on public.site_report_personnel (report_path);
create index site_report_personnel_personnel_path_idx
on public.site_report_personnel (personnel_path);
create index site_report_personnel_agency_path_idx
on public.site_report_personnel (agency_path);

-- Report archive pages and the reports in each. Every location in a report's
-- location chain (the location itself and each ancestor) is an archive
-- scope; each scope has a page per year, month and day of its reports:
-- {scope path}reports/{year}/, .../{month}/, .../{day}/. The scope's
-- reports/ page itself is a topic page (site_topic_page).
create materialized view public.site_report_archive_report as
with report_scope as (
    select
        report_page.review_id,
        report_page.path as report_path,
        report_page.title,
        report_page.incident_date,
        report_page.year,
        report_page.month,
        report_page.day,
        report_page.lastmod,
        scope_lp.path as scope_path,
        scope_lp.level as scope_level,
        scope_lp.display_name as scope_name
    from public.site_report_page as report_page
    inner join public.reviews as r on report_page.review_id = r.id
    inner join public.site_location_ancestor as ancestor
        on r.location_path_id = ancestor.location_path_id
    inner join public.location_path as scope_lp
        on ancestor.ancestor_location_path_id = scope_lp.location_path_id
)

select
    scope_path || 'reports/' || year || '/' as archive_path,
    'year' as archive_level,
    year,
    null::text as month,
    null::text as day,
    scope_path,
    scope_level,
    scope_name,
    review_id,
    report_path,
    title,
    incident_date,
    lastmod
from report_scope
union all
select
    scope_path || 'reports/' || year || '/' || month || '/' as archive_path,
    'month' as archive_level,
    year,
    month,
    null::text as day,
    scope_path,
    scope_level,
    scope_name,
    review_id,
    report_path,
    title,
    incident_date,
    lastmod
from report_scope
union all
select
    scope_path
    || 'reports/'
    || year
    || '/'
    || month
    || '/'
    || day
    || '/' as archive_path,
    'day' as archive_level,
    year,
    month,
    day,
    scope_path,
    scope_level,
    scope_name,
    review_id,
    report_path,
    title,
    incident_date,
    lastmod
from report_scope
with no data;

create unique index site_report_archive_report_key_idx
on public.site_report_archive_report (archive_path, review_id);
create index site_report_archive_report_scope_path_idx
on public.site_report_archive_report (scope_path);

create materialized view public.site_report_archive_page as
select
    archive_path as path,
    archive_level,
    year,
    month,
    day,
    scope_path,
    scope_level,
    scope_name,
    count(*)::integer as report_count,
    max(lastmod) as lastmod
from public.site_report_archive_report
group by
    archive_path,
    archive_level,
    year,
    month,
    day,
    scope_path,
    scope_level,
    scope_name
with no data;

create unique index site_report_archive_page_path_idx
on public.site_report_archive_page (path);
create index site_report_archive_page_scope_path_idx
on public.site_report_archive_page (scope_path);

-- Civil case pages: every civil_cases row. The incident location is labelled
-- as such; it is not used for any scope. lastmod: the latest of updated_at
-- and created_at.
create materialized view public.site_civil_case_page as
select
    c.id as civil_case_id,
    c.slug,
    c.title,
    c.cause_number,
    c.court,
    c.filed_date,
    c.date_terminated,
    c.outcome,
    c.claims_summary,
    c.primary_source_url,
    lp.path as incident_location_path,
    lp.display_name as incident_location_name,
    lp.level as incident_location_level,
    location_state.state_path,
    location_state.state_name,
    location_state.state_code,
    c.created_at,
    c.updated_at,
    '/civil-cases/' || c.slug || '/' as path,
    greatest(c.updated_at, c.created_at) as lastmod
from public.civil_cases as c
inner join public.location_path as lp
    on c.location_path_id = lp.location_path_id
left join public.site_location_state as location_state
    on c.location_path_id = location_state.location_path_id
with no data;

create unique index site_civil_case_page_path_idx
on public.site_civil_case_page (path);
create unique index site_civil_case_page_civil_case_id_idx
on public.site_civil_case_page (civil_case_id);

-- Each civil_case_personnel row, with the person and the assignment's agency
-- (agency_path null when the agency has no page).
create materialized view public.site_civil_case_personnel as
select
    ccp.id as civil_case_personnel_id,
    case_page.path as civil_case_path,
    case_page.civil_case_id,
    case_page.title as civil_case_title,
    case_page.filed_date,
    case_page.date_terminated,
    personnel_page.path as personnel_path,
    personnel_page.personnel_id,
    personnel_page.slug as personnel_slug,
    personnel_page.first_name,
    personnel_page.last_name,
    personnel_page.suffix,
    personnel_page.full_name,
    ap.title as assignment_title,
    ap.agency_id,
    a.name as agency_name,
    agency_page.path as agency_path
from public.civil_case_personnel as ccp
inner join public.site_civil_case_page as case_page
    on ccp.civil_case_id = case_page.civil_case_id
inner join public.agency_personnel as ap on ccp.agency_personnel_id = ap.id
inner join public.agency as a on ap.agency_id = a.id
inner join public.site_personnel_page as personnel_page
    on ap.personnel_id = personnel_page.personnel_id
left join public.site_agency_page as agency_page
    on ap.agency_id = agency_page.agency_id
with no data;

create unique index site_civil_case_personnel_id_idx
on public.site_civil_case_personnel (civil_case_personnel_id);
create index site_civil_case_personnel_civil_case_path_idx
on public.site_civil_case_personnel (civil_case_path);
create index site_civil_case_personnel_personnel_path_idx
on public.site_civil_case_personnel (personnel_path);
create index site_civil_case_personnel_agency_path_idx
on public.site_civil_case_personnel (agency_path);

-- Federal agency branches: agencies with a parent_federal_agency_id and a
-- Current person (today's rule; design.md D7). agency_path is null when the
-- agency has no page. report_count and civil_case_count: distinct reviews
-- and civil cases linked to the branch's own agency_personnel rows.
create materialized view public.site_federal_branch as
with branch_records as (
    select
        ap.agency_id,
        count(distinct rp.review_id)::integer as report_count,
        count(distinct ccp.civil_case_id)::integer as civil_case_count
    from public.agency_personnel as ap
    inner join public.agency as a on ap.agency_id = a.id
    left join public.review_personnel as rp on ap.id = rp.agency_personnel_id
    left join public.civil_case_personnel as ccp
        on ap.id = ccp.agency_personnel_id
    where a.parent_federal_agency_id is not null
    group by ap.agency_id
)

select
    a.id as agency_id,
    fa.id as federal_agency_id,
    agency_page.path as agency_path,
    a.name,
    a.address,
    a.state,
    place_lp.display_name as place_name,
    area_lp.display_name as area_name,
    counts.current_personnel_count,
    '/federal/' || fa.slug || '/' as federal_agency_path,
    coalesce(branch_records.report_count, 0) as report_count,
    coalesce(branch_records.civil_case_count, 0) as civil_case_count
from public.agency as a
inner join public.federal_agency as fa on a.parent_federal_agency_id = fa.id
inner join public.site_agency_count as counts on a.id = counts.agency_id
inner join public.location_path as place_lp
    on a.location_path_id = place_lp.location_path_id
left join public.location_path as area_lp
    on
        place_lp.parent_location_path_id = area_lp.location_path_id
        and area_lp.level = 'administrative_area'
left join public.site_agency_page as agency_page
    on a.id = agency_page.agency_id
left join branch_records on a.id = branch_records.agency_id
where counts.current_personnel_count > 0
with no data;

create unique index site_federal_branch_agency_id_idx
on public.site_federal_branch (agency_id);
create index site_federal_branch_federal_agency_path_idx
on public.site_federal_branch (federal_agency_path);
create index site_federal_branch_agency_path_idx
on public.site_federal_branch (agency_path);

-- Federal agency pages: every federal_agency row. current_personnel_count
-- from site_federal_agency_count; branch_count, report_count and
-- civil_case_count over its site_federal_branch rows, each case and report
-- counted once. lastmod: the latest updated_at or created_at of the federal
-- agency and its branch agencies.
create materialized view public.site_federal_agency_page as
with branch_records as (
    select
        branch.federal_agency_id,
        count(distinct branch.agency_id)::integer as branch_count,
        count(distinct rp.review_id)::integer as report_count,
        count(distinct ccp.civil_case_id)::integer as civil_case_count,
        max(greatest(a.updated_at, a.created_at)) as lastmod
    from public.site_federal_branch as branch
    inner join public.agency as a on branch.agency_id = a.id
    left join public.agency_personnel as ap on branch.agency_id = ap.agency_id
    left join public.review_personnel as rp on ap.id = rp.agency_personnel_id
    left join public.civil_case_personnel as ccp
        on ap.id = ccp.agency_personnel_id
    group by branch.federal_agency_id
)

select
    fa.id as federal_agency_id,
    fa.slug,
    fa.name,
    counts.current_personnel_count,
    '/federal/' || fa.slug || '/' as path,
    coalesce(branch_records.branch_count, 0) as branch_count,
    coalesce(branch_records.report_count, 0) as report_count,
    coalesce(branch_records.civil_case_count, 0) as civil_case_count,
    greatest(fa.updated_at, fa.created_at, branch_records.lastmod) as lastmod
from public.federal_agency as fa
inner join public.site_federal_agency_count as counts
    on fa.id = counts.federal_agency_id
left join branch_records on fa.id = branch_records.federal_agency_id
with no data;

create unique index site_federal_agency_page_path_idx
on public.site_federal_agency_page (path);
create unique index site_federal_agency_page_id_idx
on public.site_federal_agency_page (federal_agency_id);

-- Civil cases per scope page, applying the civil case scope rules once
-- (website AGENTS.md): agency (the agency's own agency_personnel rows),
-- place, area and state (agency_personnel rows of agencies located within),
-- federal agency (its branches' rows) and personnel (all the person's rows).
-- civil_cases.location_path_id is not used.
create materialized view public.site_civil_case_scope as
with case_assignment as (
    select
        ccp.civil_case_id,
        ap.personnel_id,
        ap.agency_id,
        a.location_path_id
    from public.civil_case_personnel as ccp
    inner join public.agency_personnel as ap on ccp.agency_personnel_id = ap.id
    inner join public.agency as a on ap.agency_id = a.id
),

scope as (
    select
        agency_page.path as scope_path,
        'agency' as scope_level,
        case_assignment.civil_case_id
    from case_assignment
    inner join public.site_agency_page as agency_page
        on case_assignment.agency_id = agency_page.agency_id
    union
    select
        location_page.path as scope_path,
        location_page.level as scope_level,
        case_assignment.civil_case_id
    from case_assignment
    inner join public.site_location_ancestor as ancestor
        on case_assignment.location_path_id = ancestor.location_path_id
    inner join public.site_location_page as location_page
        on ancestor.ancestor_location_path_id = location_page.location_path_id
    union
    select
        branch.federal_agency_path as scope_path,
        'federal_agency' as scope_level,
        case_assignment.civil_case_id
    from case_assignment
    inner join public.site_federal_branch as branch
        on case_assignment.agency_id = branch.agency_id
    union
    select
        personnel_page.path as scope_path,
        'personnel' as scope_level,
        case_assignment.civil_case_id
    from case_assignment
    inner join public.site_personnel_page as personnel_page
        on case_assignment.personnel_id = personnel_page.personnel_id
)

select
    scope.scope_path,
    scope.scope_level,
    case_page.civil_case_id,
    case_page.path as civil_case_path,
    case_page.title,
    case_page.cause_number,
    case_page.court,
    case_page.filed_date,
    case_page.date_terminated
from scope
inner join public.site_civil_case_page as case_page
    on scope.civil_case_id = case_page.civil_case_id
with no data;

create unique index site_civil_case_scope_key_idx
on public.site_civil_case_scope (scope_path, civil_case_id);

-- Licensing authority pages: every licensing_authority row located at a
-- state. path is the state path plus licensing-authority/. Counts: licenses,
-- license actions and discipline rows of the authority, and active
-- annotations attached to it. lastmod: the latest of updated_at and
-- created_at.
create materialized view public.site_licensing_authority_page as
with license_counts as (
    select
        al.licensing_authority_id,
        count(distinct l.id)::integer as license_count,
        count(action.id)::integer as license_action_count
    from public.authority_license as al
    inner join public.license as l on al.id = l.authority_license_id
    left join public.license_action as action on l.id = action.license_id
    group by al.licensing_authority_id
),

discipline_counts as (
    select
        licensing_authority_id,
        count(*)::integer as discipline_count
    from public.discipline
    group by licensing_authority_id
),

annotation_counts as (
    select
        licensing_authority_id,
        count(*)::integer as annotation_count
    from public.data_annotation
    where status = 'active' and licensing_authority_id is not null
    group by licensing_authority_id
)

select
    la.id as licensing_authority_id,
    la.name,
    la.abbreviation,
    la.website,
    state_lp.path as state_path,
    state_lp.display_name as state_name,
    state_lp.segment as state_segment,
    state_lp.state_code,
    state_lp.path || 'licensing-authority/' as path,
    coalesce(license_counts.license_count, 0) as license_count,
    coalesce(license_counts.license_action_count, 0) as license_action_count,
    coalesce(discipline_counts.discipline_count, 0) as discipline_count,
    coalesce(annotation_counts.annotation_count, 0) as annotation_count,
    greatest(la.updated_at, la.created_at) as lastmod
from public.licensing_authority as la
inner join public.location_path as state_lp
    on la.location_path_id = state_lp.location_path_id
left join license_counts on la.id = license_counts.licensing_authority_id
left join discipline_counts on la.id = discipline_counts.licensing_authority_id
left join annotation_counts on la.id = annotation_counts.licensing_authority_id
where state_lp.level = 'state'
with no data;

create unique index site_licensing_authority_page_path_idx
on public.site_licensing_authority_page (path);
create unique index site_licensing_authority_page_id_idx
on public.site_licensing_authority_page (licensing_authority_id);
create index site_licensing_authority_page_state_path_idx
on public.site_licensing_authority_page (state_path);

-- License counts per (authority, license type, status) and license action
-- counts per (authority, action), with the latest action date. Actions group
-- by the source action text until license_action_type exists (tasks.md 3,
-- 9.10).
create materialized view public.site_licensing_authority_count as
select
    authority_page.path as authority_path,
    'license' as row_kind,
    al.name as type_name,
    l.status,
    count(*)::integer as record_count,
    null::date as latest_date
from public.license as l
inner join public.authority_license as al on l.authority_license_id = al.id
inner join public.site_licensing_authority_page as authority_page
    on al.licensing_authority_id = authority_page.licensing_authority_id
group by authority_page.path, al.name, l.status
union all
select
    authority_page.path as authority_path,
    'license_action' as row_kind,
    action.action as type_name,
    null::text as status,
    count(*)::integer as record_count,
    max(action.action_date) as latest_date
from public.license_action as action
inner join public.license as l on action.license_id = l.id
inner join public.authority_license as al on l.authority_license_id = al.id
inner join public.site_licensing_authority_page as authority_page
    on al.licensing_authority_id = authority_page.licensing_authority_id
group by authority_page.path, action.action
with no data;

create unique index site_licensing_authority_count_key_idx
on public.site_licensing_authority_count (
    authority_path, row_kind, type_name, status
) nulls not distinct;

-- Topic pages (design.md D7): one row per scope page and topic whose count is
-- above zero. Agency: personnel (personnel_count), reports (report_count),
-- civil-cases (civil_case_count). State, area and place: reports and
-- civil-cases (site_location_count). Personnel: reports and civil-cases.
-- lastmod: the scope page's lastmod; a location's reports page takes the
-- latest lastmod of the reports within (today's sitemap rule).
create materialized view public.site_topic_page as
with report_lastmod as (
    select
        scope_path,
        max(lastmod) as lastmod
    from public.site_report_archive_page
    where archive_level = 'year'
    group by scope_path
),

topic as (
    select
        agency_page.path as scope_path,
        'agency' as scope_kind,
        topic_count.topic,
        topic_count.record_count,
        agency_page.state_path,
        agency_page.state_code,
        agency_page.lastmod
    from public.site_agency_page as agency_page
    cross join
        lateral (
            values
            ('personnel', agency_page.personnel_count),
            ('reports', agency_page.report_count),
            ('civil-cases', agency_page.civil_case_count)
        ) as topic_count (topic, record_count)
    union all
    select
        location_page.path as scope_path,
        location_page.level as scope_kind,
        topic_count.topic,
        topic_count.record_count,
        location_page.state_path,
        location_page.state_code,
        case
            when topic_count.topic = 'reports' then report_lastmod.lastmod
            else location_page.lastmod
        end as lastmod
    from public.site_location_page as location_page
    cross join
        lateral (
            values
            ('reports', location_page.report_count),
            ('civil-cases', location_page.civil_case_count)
        ) as topic_count (topic, record_count)
    left join report_lastmod
        on location_page.path = report_lastmod.scope_path
    union all
    select
        personnel_page.path as scope_path,
        'personnel' as scope_kind,
        topic_count.topic,
        topic_count.record_count,
        personnel_page.state_path,
        personnel_page.state_code,
        personnel_page.lastmod
    from public.site_personnel_page as personnel_page
    cross join lateral (
        values
        ('reports', personnel_page.report_count),
        ('civil-cases', personnel_page.civil_case_count)
    ) as topic_count (topic, record_count)
)

select
    scope_path,
    scope_kind,
    topic,
    record_count,
    state_path,
    state_code,
    lastmod,
    scope_path || topic || '/' as path
from topic
where record_count > 0
with no data;

create unique index site_topic_page_path_idx on public.site_topic_page (path);
create index site_topic_page_scope_path_idx
on public.site_topic_page (scope_path);

-- Every page of the page views above, once. The unique index on path makes
-- the refresh fail, naming the path, when two pages claim one path.
-- entity_kind and entity_id name the record the page is about (the intake
-- record kind and its primary key), so the website can embed them in the page
-- and derive redirects from an earlier release's pages (owner, 2026-11-22).
-- A topic or report archive page is about its scope's record; the record's
-- own page is the row whose page_type is not topic or report_archive.
create materialized view public.site_page as
select
    path,
    'location' as page_type,
    'LocationPath' as entity_kind,
    location_path_id as entity_id,
    state_path,
    state_code,
    lastmod
from public.site_location_page
union all
select
    path,
    'agency' as page_type,
    'Agency' as entity_kind,
    agency_id as entity_id,
    state_path,
    state_code,
    lastmod
from public.site_agency_page
union all
select
    path,
    'personnel' as page_type,
    'Personnel' as entity_kind,
    personnel_id as entity_id,
    state_path,
    state_code,
    lastmod
from public.site_personnel_page
union all
select
    path,
    'report' as page_type,
    'Review' as entity_kind,
    review_id as entity_id,
    state_path,
    state_code,
    lastmod
from public.site_report_page
union all
select
    archive.path,
    'report_archive' as page_type,
    'LocationPath' as entity_kind,
    scope_lp.location_path_id as entity_id,
    scope_state.state_path,
    scope_state.state_code,
    archive.lastmod
from public.site_report_archive_page as archive
inner join public.location_path as scope_lp
    on archive.scope_path = scope_lp.path
left join public.site_location_state as scope_state
    on scope_lp.location_path_id = scope_state.location_path_id
union all
select
    path,
    'civil_case' as page_type,
    'CivilCase' as entity_kind,
    civil_case_id as entity_id,
    state_path,
    state_code,
    lastmod
from public.site_civil_case_page
union all
select
    path,
    'federal_agency' as page_type,
    'FederalAgency' as entity_kind,
    federal_agency_id as entity_id,
    null as state_path,
    null as state_code,
    lastmod
from public.site_federal_agency_page
union all
select
    path,
    'licensing_authority' as page_type,
    'LicensingAuthority' as entity_kind,
    licensing_authority_id as entity_id,
    state_path,
    state_code,
    lastmod
from public.site_licensing_authority_page
union all
select
    topic.path,
    'topic' as page_type,
    case
        when agency_page.agency_id is not null then 'Agency'
        when personnel_page.personnel_id is not null then 'Personnel'
        else 'LocationPath'
    end as entity_kind,
    coalesce(
        agency_page.agency_id,
        personnel_page.personnel_id,
        location_page.location_path_id
    ) as entity_id,
    topic.state_path,
    topic.state_code,
    topic.lastmod
from public.site_topic_page as topic
left join public.site_agency_page as agency_page
    on topic.scope_kind = 'agency' and topic.scope_path = agency_page.path
left join public.site_personnel_page as personnel_page
    on
        topic.scope_kind = 'personnel'
        and topic.scope_path = personnel_page.path
left join public.site_location_page as location_page
    on
        topic.scope_kind in ('state', 'administrative_area', 'place')
        and topic.scope_path = location_page.path
with no data;

create unique index site_page_path_idx on public.site_page (path);
create index site_page_state_path_idx on public.site_page (state_path);
create index site_page_entity_idx on public.site_page (entity_kind, entity_id);

-- Every active annotation with the page it shows on (the page of its
-- attachment column; null when that record has no page), its type label, its
-- message and its links. A stored link whose url (before any #fragment) is
-- not a site_page path is returned with a null url, so the label shows
-- without a link. The site renders these columns and decides nothing.
create materialized view public.site_annotation as
select
    annotation.id as data_annotation_id,
    authority_page.path as licensing_authority_path,
    annotation.type,
    annotation_type.label as type_label,
    annotation.message,
    annotation.display_value,
    annotation.display_replacement_value,
    annotation.source_namespace,
    annotation.source_record_id,
    coalesce(
        personnel_page.path,
        agency_page.path,
        report_page.path,
        case_page.path,
        location_page.path,
        federal_page.path,
        authority_page.path
    ) as page_path,
    case
        when annotation.personnel_id is not null then 'personnel'
        when annotation.agency_id is not null then 'agency'
        when annotation.review_id is not null then 'report'
        when annotation.civil_case_id is not null then 'civil_case'
        when annotation.location_path_id is not null then 'location'
        when annotation.federal_agency_id is not null then 'federal_agency'
        when
            annotation.licensing_authority_id is not null
            then 'licensing_authority'
    end as page_type,
    (
        select
            jsonb_agg(
                jsonb_build_object(
                    'url',
                    case
                        when page.path is not null then link.value -> 'url'
                        else 'null'::jsonb
                    end,
                    'label',
                    link.value -> 'label'
                )
                order by link.position
            )
        from
            jsonb_array_elements(annotation.links)
            with ordinality as link (value, position)
        left join public.site_page as page
            on split_part(link.value ->> 'url', '#', 1) = page.path
    ) as links
from public.data_annotation as annotation
left join public.data_annotation_type as annotation_type
    on annotation.type = annotation_type.type
left join public.site_personnel_page as personnel_page
    on annotation.personnel_id = personnel_page.personnel_id
left join public.site_agency_page as agency_page
    on annotation.agency_id = agency_page.agency_id
left join public.site_report_page as report_page
    on annotation.review_id = report_page.review_id
left join public.site_civil_case_page as case_page
    on annotation.civil_case_id = case_page.civil_case_id
left join public.site_location_page as location_page
    on annotation.location_path_id = location_page.location_path_id
left join public.site_federal_agency_page as federal_page
    on annotation.federal_agency_id = federal_page.federal_agency_id
left join public.site_licensing_authority_page as authority_page
    on annotation.licensing_authority_id = authority_page.licensing_authority_id
where annotation.status = 'active'
with no data;

create unique index site_annotation_id_idx
on public.site_annotation (data_annotation_id);
create index site_annotation_page_path_idx
on public.site_annotation (page_path);
create index site_annotation_licensing_authority_path_idx
on public.site_annotation (licensing_authority_path);
create index site_annotation_source_namespace_idx
on public.site_annotation (source_namespace);
create index site_annotation_type_idx on public.site_annotation (type);

-- Raise on the conditions the website projection script checked, and on
-- stored facts the page views need but that are still missing (design.md D9,
-- "Page-shaped views"). Each message names up to five offending rows.
create function public.assert_site_projections()
returns void
language plpgsql
as $$
declare
    offenders text;
begin
    select string_agg(path, ', ' order by path)
    into offenders
    from (
        select lp.path
        from public.location_path as lp
        left join public.location_path as parent_lp
            on lp.parent_location_path_id = parent_lp.location_path_id
        where
            lp.segment is null
            or lp.path
            <> coalesce(parent_lp.path, '/') || lp.segment || '/'
        order by lp.path
        limit 5
    ) as offender;
    if offenders is not null then
        raise exception
            'location_path rows whose path is not the parent path plus segment: %',
            offenders;
    end if;

    select string_agg(path, ', ' order by path)
    into offenders
    from (
        select path
        from public.location_path
        where level = 'state' and state_code is null
        order by path
        limit 5
    ) as offender;
    if offenders is not null then
        raise exception 'state location_path rows without state_code: %',
            offenders;
    end if;

    select string_agg(path, ', ' order by path)
    into offenders
    from (
        select location_page.path
        from public.site_location_page as location_page
        left join public.location_path as parent_lp
            on
                location_page.parent_location_path_id
                = parent_lp.location_path_id
        where
            (
                location_page.level = 'state'
                and parent_lp.location_path_id is not null
            )
            or (
                location_page.level = 'administrative_area'
                and parent_lp.level is distinct from 'state'
            )
            or (
                location_page.level = 'place'
                and parent_lp.level is distinct from 'administrative_area'
            )
        order by location_page.path
        limit 5
    ) as offender;
    if offenders is not null then
        raise exception 'location pages whose level and parent do not match: %',
            offenders;
    end if;

    select string_agg(id, ', ' order by id)
    into offenders
    from (
        select id
        from public.reviews
        where incident_date is null
        order by id
        limit 5
    ) as offender;
    if offenders is not null then
        raise exception 'reviews without an incident date: %', offenders;
    end if;

    select string_agg(id, ', ' order by id)
    into offenders
    from (
        select id
        from public.data_annotation
        where
            status = 'active'
            and (
                links is null
                or num_nonnulls(
                    personnel_id,
                    agency_id,
                    review_id,
                    civil_case_id,
                    location_path_id,
                    federal_agency_id,
                    licensing_authority_id
                ) = 0
            )
        order by id
        limit 5
    ) as offender;
    if offenders is not null then
        raise exception
            'active annotations without links or a page attachment: %',
            offenders;
    end if;

    select string_agg(type, ', ' order by type)
    into offenders
    from (
        select distinct annotation.type
        from public.data_annotation as annotation
        left join public.data_annotation_type as annotation_type
            on annotation.type = annotation_type.type
        where annotation_type.type is null
        order by annotation.type
        limit 5
    ) as offender;
    if offenders is not null then
        raise exception
            'annotation types without a data_annotation_type label: %',
            offenders;
    end if;
end;
$$;

-- Refresh every materialized page view in dependency order, then check.
-- data up does not call this; the website build does (design.md D9).
create function public.refresh_site_projections()
returns void
language plpgsql
as $$
declare
    duplicate_detail text;
begin
    refresh materialized view public.site_agency_page;
    refresh materialized view public.site_agency_phone;
    refresh materialized view public.site_location_page;
    refresh materialized view public.site_state_map;
    refresh materialized view public.site_personnel_page;
    refresh materialized view public.site_assignment;
    refresh materialized view public.site_personnel_listing;
    refresh materialized view public.site_report_page;
    refresh materialized view public.site_report_personnel;
    refresh materialized view public.site_report_archive_report;
    refresh materialized view public.site_report_archive_page;
    refresh materialized view public.site_civil_case_page;
    refresh materialized view public.site_civil_case_personnel;
    refresh materialized view public.site_federal_branch;
    refresh materialized view public.site_federal_agency_page;
    refresh materialized view public.site_civil_case_scope;
    refresh materialized view public.site_licensing_authority_page;
    refresh materialized view public.site_licensing_authority_count;
    refresh materialized view public.site_topic_page;
    begin
        refresh materialized view public.site_page;
    exception
        when unique_violation then
            get stacked diagnostics duplicate_detail = pg_exception_detail;
            raise exception 'Two pages claim one path: %', duplicate_detail;
    end;
    refresh materialized view public.site_annotation;
    perform public.assert_site_projections();
end;
$$;
