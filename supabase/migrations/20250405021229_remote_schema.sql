drop trigger if exists "update_agency_stats_overall_stats" on "public"."agency_stats";

drop trigger if exists "update_officers_stats_overall_stats" on "public"."officers_stats";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_rating_category(rating_value numeric)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Return the appropriate category based on the numeric value
    IF rating_value IS NULL OR rating_value < 1 THEN 
        RETURN 'No Rating';
    ELSIF rating_value >= 5 THEN 
        RETURN 'Outstanding';
    ELSIF rating_value >= 4 THEN 
        RETURN 'Good';
    ELSIF rating_value >= 3 THEN 
        RETURN 'Adequate';
    ELSIF rating_value >= 2 THEN 
        RETURN 'Needs Improvement';
    ELSE 
        RETURN 'Unacceptable';
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_rating_category(rating_value text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    rating_num numeric;
BEGIN
    -- Try to convert the input text to numeric
    BEGIN
        rating_num := rating_value::numeric;
    EXCEPTION WHEN OTHERS THEN
        -- If conversion fails, return 'No Rating'
        RETURN 'No Rating';
    END;

    -- Return the appropriate category based on the numeric value
    IF rating_num IS NULL OR rating_num < 1 THEN 
        RETURN 'No Rating';
    ELSIF rating_num >= 5 THEN 
        RETURN 'Outstanding';
    ELSIF rating_num >= 4 THEN 
        RETURN 'Good';
    ELSIF rating_num >= 3 THEN 
        RETURN 'Adequate';
    ELSIF rating_num >= 2 THEN 
        RETURN 'Needs Improvement';
    ELSE 
        RETURN 'Unacceptable';
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalculate_all_officer_stats()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    officer_rec RECORD;
BEGIN
    FOR officer_rec IN SELECT id FROM officers LOOP
        -- Trigger a recalculation by finding a rating for this officer and updating it
        WITH officer_rating AS (
            SELECT ror.id
            FROM review_officers ro
            JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
            WHERE ro.officer_id = officer_rec.id
            LIMIT 1
        )
        UPDATE review_officers_ratings
        SET updated_at = now()
        FROM officer_rating
        WHERE review_officers_ratings.id = officer_rating.id;
        
        -- If no ratings exist, ensure we at least have a stats record with empty values
        IF NOT EXISTS (
            SELECT 1 FROM officers_stats WHERE id = officer_rec.id
        ) THEN
            INSERT INTO officers_stats (id, review_stats, rating_overall, review_count)
            VALUES (
                officer_rec.id,
                '{
                  "Outstanding": {"count": 0},
                  "Good": {"count": 0},
                  "Adequate": {"count": 0},
                  "Needs Improvement": {"count": 0},
                  "Unacceptable": {"count": 0}
                }'::jsonb,
                0,
                0
            )
            ON CONFLICT (id) DO NOTHING;
        END IF;
    END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_agency_officer_stats(agency_officer_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    ao record;
    overall_rating numeric;
    review_count integer;
BEGIN
    -- Get the agency officer record
    SELECT * INTO ao FROM agency_officers WHERE id = agency_officer_id;
    
    -- First collect all relevant reviews
    WITH agency_officer_reviews AS (
        -- Get all reviews for this officer within the agency timeframe
        SELECT 
            r.id as review_id,
            AVG(rb.rubric_value)::numeric as avg_rating
        FROM review_officers ro
        JOIN reviews r ON r.id = ro.review_id
        JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
        JOIN rubrics rb ON rb.id = ror.rubric_id
        WHERE ro.officer_id = ao.officer_id
        AND (r.incident_date >= ao.start_date)
        AND (ao.end_date IS NULL OR r.incident_date <= ao.end_date)
        GROUP BY r.id
    ),
    -- Count reviews for this agency officer
    agency_review_count AS (
        SELECT COUNT(*) as count FROM agency_officer_reviews
    ),
    -- Categorize reviews by their average rating
    categorized_reviews AS (
        SELECT 
            public.get_rating_category(avg_rating) as category,
            COUNT(*) as count
        FROM agency_officer_reviews
        GROUP BY public.get_rating_category(avg_rating)
    ),
    -- Calculate overall rating
    calculated_overall AS (
        SELECT ROUND(AVG(avg_rating)::numeric, 1) as avg_rating 
        FROM agency_officer_reviews
    )
    -- Update agency_officers_stats
    INSERT INTO agency_officers_stats (id, review_stats, rating_overall, review_count, updated_at)
    VALUES (
        agency_officer_id,
        jsonb_build_object(
            'Outstanding', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Outstanding'), 0)),
            'Good', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Good'), 0)),
            'Adequate', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Adequate'), 0)),
            'Needs Improvement', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Needs Improvement'), 0)),
            'Unacceptable', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Unacceptable'), 0))
        ),
        COALESCE((SELECT avg_rating FROM calculated_overall), 0),
        COALESCE((SELECT count FROM agency_review_count), 0),
        now()
    )
    ON CONFLICT (id) 
    DO UPDATE SET 
        review_stats = jsonb_build_object(
            'Outstanding', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Outstanding'), 0)),
            'Good', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Good'), 0)),
            'Adequate', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Adequate'), 0)),
            'Needs Improvement', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Needs Improvement'), 0)),
            'Unacceptable', jsonb_build_object('count', COALESCE((SELECT count FROM categorized_reviews WHERE category = 'Unacceptable'), 0))
        ),
        rating_overall = COALESCE((SELECT avg_rating FROM calculated_overall), 0),
        review_count = COALESCE((SELECT count FROM agency_review_count), 0),
        updated_at = now();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_rating_stats(review_officers_ratings_array jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  stats jsonb;
BEGIN
  WITH rating_counts AS (
    SELECT 
      public.get_rating_category((elements->>'rubric_value')::numeric) as category,
      COUNT(*) as count
    FROM jsonb_array_elements(review_officers_ratings_array) AS elements
    GROUP BY public.get_rating_category((elements->>'rubric_value')::numeric)
  ),
  -- Build the JSON object with all categories
  stats_json AS (
    SELECT jsonb_build_object(
      'Outstanding', jsonb_build_object('count', COALESCE((SELECT count FROM rating_counts WHERE category = 'Outstanding'), 0)),
      'Good', jsonb_build_object('count', COALESCE((SELECT count FROM rating_counts WHERE category = 'Good'), 0)),
      'Adequate', jsonb_build_object('count', COALESCE((SELECT count FROM rating_counts WHERE category = 'Adequate'), 0)),
      'Needs Improvement', jsonb_build_object('count', COALESCE((SELECT count FROM rating_counts WHERE category = 'Needs Improvement'), 0)),
      'Unacceptable', jsonb_build_object('count', COALESCE((SELECT count FROM rating_counts WHERE category = 'Unacceptable'), 0))
    ) as calculated_stats
  )
  SELECT calculated_stats INTO stats FROM stats_json;

  RETURN COALESCE(stats, '{}'::jsonb);
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

CREATE OR REPLACE FUNCTION public.update_agency_stats(target_agency_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    overall_rating numeric;
    total_review_count integer;
    total_employees_count integer;
    reviewed_employees_count integer;
    agency_stats_json jsonb;
BEGIN
    -- Count total employees in the agency
    SELECT COUNT(*) INTO total_employees_count
    FROM agency_officers ao
    WHERE ao.agency_id = target_agency_id;
    
    -- Count unique officers who have been reviewed
    SELECT COUNT(DISTINCT ro.officer_id) INTO reviewed_employees_count
    FROM agency_officers ao
    JOIN review_officers ro ON ro.officer_id = ao.officer_id
    JOIN reviews r ON r.id = ro.review_id
    WHERE ao.agency_id = target_agency_id;
    
    -- Count unique reviews associated with this agency's officers
    SELECT COUNT(DISTINCT r.id) INTO total_review_count
    FROM agency_officers ao
    JOIN review_officers ro ON ro.officer_id = ao.officer_id
    JOIN reviews r ON r.id = ro.review_id
    WHERE ao.agency_id = target_agency_id;
    
    -- Get the average rating across all officers in the agency
    SELECT ROUND(AVG(CASE WHEN aos.rating_overall > 0 THEN aos.rating_overall ELSE NULL END)::numeric, 1)
    INTO overall_rating
    FROM agency_officers_stats aos
    JOIN agency_officers ao ON ao.id = aos.id
    WHERE ao.agency_id = target_agency_id;
    
    -- Get officer stats summary
    WITH agency_officers_with_ratings AS (
        SELECT 
            ao.id,
            aos.rating_overall
        FROM agency_officers ao
        JOIN agency_officers_stats aos ON aos.id = ao.id
        WHERE ao.agency_id = target_agency_id
    ),
    -- Generate the categorized ratings stats for agency
    agency_categorized_ratings AS (
        SELECT 
            public.get_rating_category(rating_overall) as category,
            COUNT(*) as count
        FROM agency_officers_with_ratings
        GROUP BY public.get_rating_category(rating_overall)
    ),
    -- Build the JSON object with all categories
    stats_builder AS (
        SELECT jsonb_build_object(
            'outstanding', jsonb_build_object('count', COALESCE((SELECT count FROM agency_categorized_ratings WHERE category = 'Outstanding'), 0)),
            'good', jsonb_build_object('count', COALESCE((SELECT count FROM agency_categorized_ratings WHERE category = 'Good'), 0)),
            'adequate', jsonb_build_object('count', COALESCE((SELECT count FROM agency_categorized_ratings WHERE category = 'Adequate'), 0)),
            'needs_improvement', jsonb_build_object('count', COALESCE((SELECT count FROM agency_categorized_ratings WHERE category = 'Needs Improvement'), 0)),
            'unacceptable', jsonb_build_object('count', COALESCE((SELECT count FROM agency_categorized_ratings WHERE category = 'Unacceptable'), 0))
        ) as calculated_stats
    )
    SELECT calculated_stats INTO agency_stats_json FROM stats_builder;
    
    -- Update the agency_stats record
    INSERT INTO agency_stats (id, review_stats, rating_overall, review_count, total_employees, reviewed_employees, updated_at)
    VALUES (
        target_agency_id,
        COALESCE(agency_stats_json, '{}'::jsonb),
        COALESCE(overall_rating, 0),
        COALESCE(total_review_count, 0),
        COALESCE(total_employees_count, 0),
        COALESCE(reviewed_employees_count, 0),
        now()
    )
    ON CONFLICT (id) 
    DO UPDATE SET 
        review_stats = COALESCE(agency_stats_json, '{}'::jsonb),
        rating_overall = COALESCE(overall_rating, 0),
        review_count = COALESCE(total_review_count, 0),
        total_employees = COALESCE(total_employees_count, 0),
        reviewed_employees = COALESCE(reviewed_employees_count, 0),
        updated_at = now();
END;
$function$
;


