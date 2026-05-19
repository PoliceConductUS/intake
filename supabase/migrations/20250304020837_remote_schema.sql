set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.calculate_agency_officer_stats(agency_officer_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    ao record;
    stats jsonb;
    overall_rating numeric;
    ratings_data jsonb;
BEGIN
    -- Get the agency officer record
    SELECT * INTO ao FROM agency_officers WHERE id = agency_officer_id;
    
    -- First collect all relevant ratings data
    WITH ratings_collection AS (
        SELECT 
            ror.*,
            r.incident_date,
            rb.label as rubric_label
        FROM review_officers ro
        JOIN reviews r ON r.id = ro.review_id
        JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
        JOIN rubrics rb ON rb.id = ror.rubric_id
        WHERE ro.officer_id = ao.officer_id
        AND (r.incident_date >= ao.start_date)
        AND (ao.end_date IS NULL OR r.incident_date <= ao.end_date)
    )
    SELECT jsonb_agg(to_jsonb(ratings_collection)) INTO ratings_data
    FROM ratings_collection;
    
    -- Calculate stats from the collected data
    IF ratings_data IS NOT NULL THEN
        stats := calculate_rating_stats(ratings_data);
        
        -- Calculate overall rating as weighted average
        SELECT ROUND(AVG(rv.value)::numeric, 1)
        INTO overall_rating
        FROM (
            SELECT 
                (jsonb_array_elements(ratings_data)->>'rubric_label')::text as rubric_label
            FROM (SELECT ratings_data) as rd
        ) as extracted_labels
        JOIN rating_values rv ON rv.label = extracted_labels.rubric_label;
    END IF;

    -- Update the agency_officer record
    UPDATE agency_officers 
    SET 
        review_stats = COALESCE(stats, '{}'::jsonb),
        rating_overall = COALESCE(overall_rating, 0),
        updated_at = now()
    WHERE id = agency_officer_id;
END;
$function$
;


