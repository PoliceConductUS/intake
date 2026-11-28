-- The one agency_personnel row the website names as a person's agency in the
-- personnel page title, hero, list structured data, form prefills and
-- schema.org worksFor. The website reads this view and selects no assignment
-- itself (supply-site-display-data).

-- One row per person with at least one agency_personnel row. The employment
-- status of each row comes from site_agency_personnel_employment. A row's
-- start and end dates are the stored column, or the data_source_values
-- effective value when the stored column is null and that value is a real
-- YYYY-MM-DD calendar date; any other start or end date counts as absent.
-- headline_basis and the selected row:
-- Current: the person has a Current row. The selected row is the Current row
-- with the latest start date.
-- Recorded: the person has no Current row and has an Unknown row. The selected
-- row is the row with the latest start date.
-- Most recent: every row of the person is Former. The selected row is the row
-- with the latest end date, then the latest start date.
-- An absent start date sorts before every start date. Remaining ties go to the
-- row with the greatest id.
create view public.site_personnel_headline_assignment as
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
)

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
    agency_personnel_id desc;
