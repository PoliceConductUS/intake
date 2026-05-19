alter table "public"."officers_stats" add column "trait_stats" jsonb default '{}'::jsonb;

alter table "public"."traits" add column "description" text;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.calculate_officer_trait_stats(in_officer_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    trait_stats_data jsonb;
BEGIN
    -- Get trait statistics for this officer
    WITH trait_ratings AS (
        -- Get all individual trait ratings for this officer across all reviews
        SELECT 
            t.id as trait_id,
            t.label as trait_label,
            public.get_rating_category(rb.rubric_value) as rating_category,
            rb.rubric_value as rating_value,
            COUNT(*) as rating_count
        FROM review_officers ro
        JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
        JOIN traits t ON t.id = ror.trait_id
        JOIN rubrics rb ON rb.id = ror.rubric_id
        WHERE ro.officer_id = in_officer_id
        GROUP BY t.id, t.label, public.get_rating_category(rb.rubric_value), rb.rubric_value
    ),
    -- Calculate the weighted average for each trait
    trait_averages AS (
        SELECT 
            trait_id,
            trait_label,
            ROUND(SUM(rating_value * rating_count) / NULLIF(SUM(rating_count), 0), 1) as weighted_average
        FROM trait_ratings
        GROUP BY trait_id, trait_label
    ),
    -- Create a JSON object for each trait with rating counts
    trait_ratings_json AS (
        SELECT 
            trait_label,
            trait_id,
            jsonb_object_agg(
                rating_category,
                jsonb_build_object('count', rating_count)
            ) as rating_counts
        FROM trait_ratings
        GROUP BY trait_label, trait_id
    ),
    -- Join the trait ratings with averages
    trait_combined AS (
        SELECT 
            tr.trait_label,
            tr.trait_id,
            tr.rating_counts,
            COALESCE(ta.weighted_average, 0) as weighted_average
        FROM trait_ratings_json tr
        LEFT JOIN trait_averages ta ON tr.trait_id = ta.trait_id
    ),
    -- Create the final JSON structure
    traits_final AS (
        SELECT 
            trait_label,
            jsonb_build_object(
                'meta', jsonb_build_object('weighted_average', weighted_average),
                'ratings', rating_counts
            ) as trait_data
        FROM trait_combined
    )
    -- Create the final JSON object
    SELECT 
        COALESCE(
            jsonb_object_agg(
                trait_label,
                trait_data
            ),
            '{}'::jsonb
        ) INTO trait_stats_data
    FROM traits_final;

    -- Add any missing rating categories to each trait
    SELECT jsonb_object_agg(
        key,
        value || jsonb_build_object(
            'ratings', 
            COALESCE(value->'ratings', '{}'::jsonb) || 
            CASE WHEN NOT ((value->'ratings') ? 'Outstanding') THEN jsonb_build_object('Outstanding', jsonb_build_object('count', 0)) ELSE '{}'::jsonb END ||
            CASE WHEN NOT ((value->'ratings') ? 'Good') THEN jsonb_build_object('Good', jsonb_build_object('count', 0)) ELSE '{}'::jsonb END ||
            CASE WHEN NOT ((value->'ratings') ? 'Adequate') THEN jsonb_build_object('Adequate', jsonb_build_object('count', 0)) ELSE '{}'::jsonb END ||
            CASE WHEN NOT ((value->'ratings') ? 'Needs Improvement') THEN jsonb_build_object('Needs Improvement', jsonb_build_object('count', 0)) ELSE '{}'::jsonb END ||
            CASE WHEN NOT ((value->'ratings') ? 'Unacceptable') THEN jsonb_build_object('Unacceptable', jsonb_build_object('count', 0)) ELSE '{}'::jsonb END
        )
    ) INTO trait_stats_data
    FROM jsonb_each(trait_stats_data);

    -- For traits with no data, ensure they have the meta field with weighted_average
    SELECT jsonb_object_agg(
        key,
        CASE 
            WHEN NOT (value ? 'meta') THEN 
                value || jsonb_build_object('meta', jsonb_build_object('weighted_average', 0))
            ELSE value
        END
    ) INTO trait_stats_data
    FROM jsonb_each(trait_stats_data);

    RETURN trait_stats_data;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_review_rating_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    review_officer record;
    current_officer_id text;
    agency_officer record;
    officer_review_count integer;
    officer_trait_stats jsonb;
BEGIN
    -- Get the review_officer record
    SELECT * INTO review_officer 
    FROM review_officers 
    WHERE id = NEW.review_officer_id;
    
    current_officer_id := review_officer.officer_id;

    -- Count the total reviews for this officer
    SELECT COUNT(DISTINCT ro.review_id) INTO officer_review_count
    FROM review_officers ro
    WHERE ro.officer_id = current_officer_id;

    -- Calculate trait statistics for this officer
    SELECT calculate_officer_trait_stats(current_officer_id) INTO officer_trait_stats;

    -- Update stats for the officer
    WITH officer_reviews AS (
        -- Get all review officer entries for this officer
        SELECT 
            ro.id as review_officer_id,
            ro.review_id,
            AVG(rb.rubric_value)::numeric as avg_rating
        FROM review_officers ro
        JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
        JOIN rubrics rb ON rb.id = ror.rubric_id
        WHERE ro.officer_id = current_officer_id
        GROUP BY ro.id, ro.review_id
    ),
    -- Categorize reviews by their average rating
    categorized_reviews AS (
        SELECT 
            public.get_rating_category(avg_rating) as category,
            COUNT(DISTINCT review_id) as count
        FROM officer_reviews
        GROUP BY public.get_rating_category(avg_rating)
    ),
    -- Calculate the overall average rating for this officer
    overall_rating AS (
        SELECT ROUND(AVG(avg_rating)::numeric, 1) as avg_rating 
        FROM officer_reviews
    )
    -- Update the officer_stats
    UPDATE officers_stats 
    SET 
        review_stats = jsonb_build_object(
            'Outstanding', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Outstanding'), 0)),
            'Good', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Good'), 0)),
            'Adequate', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Adequate'), 0)),
            'Needs Improvement', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Needs Improvement'), 0)),
            'Unacceptable', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Unacceptable'), 0))
        ),
        trait_stats = officer_trait_stats,
        rating_overall = COALESCE((SELECT avg_rating FROM overall_rating), 0),
        review_count = officer_review_count,
        updated_at = now()
    WHERE id = current_officer_id;
    
    -- Update stats for all relevant agency_officers
    FOR agency_officer IN
        SELECT ao.* 
        FROM agency_officers ao
        JOIN reviews r ON r.incident_date >= ao.start_date 
            AND (ao.end_date IS NULL OR r.incident_date <= ao.end_date)
        JOIN review_officers ro ON ro.review_id = r.id
        WHERE ao.officer_id = current_officer_id
    LOOP
        -- Calculate agency officer stats
        PERFORM calculate_agency_officer_stats(agency_officer.id);
        
        -- Update agency stats
        PERFORM update_agency_stats(agency_officer.agency_id);
    END LOOP;
    
    RETURN NEW;
END;
$function$
;


