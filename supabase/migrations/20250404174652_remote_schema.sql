drop trigger if exists "agency_officer_change" on "public"."agency_officers";

drop trigger if exists "review_rating_change" on "public"."review_officers_ratings";

drop view if exists "public"."agency_states";

alter table "public"."agency" drop column "rating_overall";

alter table "public"."agency" drop column "review_count";

alter table "public"."agency" drop column "review_stats";

alter table "public"."agency_officers" drop column "rating_overall";

alter table "public"."agency_officers" drop column "review_stats";

alter table "public"."agency_stats" add column "reviewed_employees" integer default 0;

alter table "public"."agency_stats" add column "total_employees" integer default 0;

alter table "public"."officers" drop column "rating_overall";

alter table "public"."officers" drop column "review_stats";

set check_function_bodies = off;

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
    all_ratings jsonb;
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
    
    -- Collect all ratings to calculate review_stats, using rubric_value directly
    WITH ratings_collection AS (
        SELECT 
            ror.*,
            r.incident_date,
            rb.rubric_value
        FROM agency_officers ao
        JOIN review_officers ro ON ro.officer_id = ao.officer_id
        JOIN reviews r ON r.id = ro.review_id
        JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
        JOIN rubrics rb ON rb.id = ror.rubric_id
        WHERE ao.agency_id = target_agency_id
    )
    SELECT jsonb_agg(to_jsonb(ratings_collection)) INTO all_ratings
    FROM ratings_collection;
    
    -- Update the agency_stats record with all calculated values
    UPDATE agency_stats 
    SET 
        rating_overall = COALESCE(overall_rating, 0),
        review_count = COALESCE(total_review_count, 0),
        total_employees = COALESCE(total_employees_count, 0),
        reviewed_employees = COALESCE(reviewed_employees_count, 0),
        review_stats = CASE WHEN all_ratings IS NOT NULL 
                        THEN calculate_rating_stats(all_ratings) 
                        ELSE '{}'::jsonb END,
        updated_at = now()
    WHERE id = target_agency_id;
    
    -- Generate overall stats
    UPDATE agency_stats 
    SET review_stats = review_stats || calculate_overall_rating_stats(review_stats)
    WHERE id = target_agency_id;
END;
$function$
;

create or replace view "public"."agency_states" as  SELECT DISTINCT agency.state
   FROM agency
  ORDER BY agency.state;


CREATE OR REPLACE FUNCTION public.handle_agency_officer_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN
        -- Calculate officer's rating for this agency and time period
        WITH officer_ratings AS (
            SELECT ROUND(AVG(rb.rubric_value)::numeric, 1) as avg_rating
            FROM review_officers ro
            JOIN reviews r ON r.id = ro.review_id
            JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
            JOIN rubrics rb ON rb.id = ror.rubric_id
            WHERE ro.officer_id = NEW.officer_id
            AND (r.incident_date >= NEW.start_date)
            AND (NEW.end_date IS NULL OR r.incident_date <= NEW.end_date)
        )
        -- Update agency_officers_stats
        INSERT INTO agency_officers_stats (id, rating_overall, updated_at)
        VALUES (
            NEW.id, 
            COALESCE((SELECT avg_rating FROM officer_ratings), 0),
            now()
        )
        ON CONFLICT (id) 
        DO UPDATE SET 
            rating_overall = COALESCE((SELECT avg_rating FROM officer_ratings), 0),
            updated_at = now();
        
        -- Update agency_stats
        WITH agency_ratings AS (
            SELECT ROUND(AVG(CASE WHEN aos.rating_overall > 0 THEN aos.rating_overall ELSE NULL END)::numeric, 1) as avg_rating
            FROM agency_officers_stats aos
            JOIN agency_officers ao ON ao.id = aos.id
            WHERE ao.agency_id = NEW.agency_id
        )
        UPDATE agency_stats 
        SET rating_overall = COALESCE((SELECT avg_rating FROM agency_ratings), 0),
            updated_at = now()
        WHERE id = NEW.agency_id;
        
    ELSIF TG_OP = 'DELETE' THEN
        -- Update agency_stats on officer deletion
        WITH agency_ratings AS (
            SELECT ROUND(AVG(CASE WHEN aos.rating_overall > 0 THEN aos.rating_overall ELSE NULL END)::numeric, 1) as avg_rating
            FROM agency_officers_stats aos
            JOIN agency_officers ao ON ao.id = aos.id
            WHERE ao.agency_id = OLD.agency_id
        )
        UPDATE agency_stats 
        SET rating_overall = COALESCE((SELECT avg_rating FROM agency_ratings), 0),
            updated_at = now()
        WHERE id = OLD.agency_id;
    END IF;
    
    RETURN NEW;
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
BEGIN
    -- Get the review_officer record
    SELECT * INTO review_officer 
    FROM review_officers 
    WHERE id = NEW.review_officer_id;
    
    current_officer_id := review_officer.officer_id;

    -- Update stats for all relevant agency_officers
    FOR agency_officer IN
        SELECT ao.* 
        FROM agency_officers ao
        JOIN reviews r ON r.incident_date >= ao.start_date 
            AND (ao.end_date IS NULL OR r.incident_date <= ao.end_date)
        JOIN review_officers ro ON ro.review_id = r.id
        WHERE ao.officer_id = current_officer_id
    LOOP
        -- Calculate average rating for the officer's time at the agency
        WITH officer_ratings AS (
            SELECT ROUND(AVG(rb.rubric_value)::numeric, 1) as avg_rating
            FROM review_officers ro
            JOIN reviews r ON r.id = ro.review_id
            JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
            JOIN rubrics rb ON rb.id = ror.rubric_id
            WHERE ro.officer_id = agency_officer.officer_id
            AND (r.incident_date >= agency_officer.start_date)
            AND (agency_officer.end_date IS NULL OR r.incident_date <= agency_officer.end_date)
        )
        -- Update agency_officers_stats
        UPDATE agency_officers_stats 
        SET 
            rating_overall = COALESCE((SELECT avg_rating FROM officer_ratings), 0),
            updated_at = now()
        WHERE id = agency_officer.id;
        
        -- Calculate average agency rating based on officers
        WITH agency_ratings AS (
            SELECT ROUND(AVG(CASE WHEN aos.rating_overall > 0 THEN aos.rating_overall ELSE NULL END)::numeric, 1) as avg_rating
            FROM agency_officers_stats aos
            JOIN agency_officers ao ON ao.id = aos.id
            WHERE ao.agency_id = agency_officer.agency_id
        )
        -- Update agency_stats
        UPDATE agency_stats 
        SET rating_overall = COALESCE((SELECT avg_rating FROM agency_ratings), 0),
        updated_at = now()
        WHERE id = agency_officer.agency_id;
    END LOOP;

    -- Update officer_stats with overall rating
    WITH officer_ratings AS (
        SELECT ROUND(AVG(rb.rubric_value)::numeric, 1) as avg_rating
        FROM review_officers ro
        JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
        JOIN rubrics rb ON rb.id = ror.rubric_id
        WHERE ro.officer_id = current_officer_id
    )
    UPDATE officers_stats 
    SET rating_overall = COALESCE((SELECT avg_rating FROM officer_ratings), 0),
        updated_at = now()
    WHERE id = current_officer_id;
    
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_agency_overall_rating(agency_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    overall_rating numeric;
BEGIN
    -- Calculate overall rating as average of agency_officers ratings
    SELECT ROUND(AVG(CASE WHEN aos.rating_overall > 0 THEN aos.rating_overall ELSE NULL END)::numeric, 1)
    INTO overall_rating
    FROM agency_officers_stats aos
    JOIN agency_officers ao ON ao.id = aos.id
    WHERE ao.agency_id = agency_id;

    -- Update the agency_stats record
    UPDATE agency_stats 
    SET rating_overall = COALESCE(overall_rating, 0),
        updated_at = now()
    WHERE id = agency_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_officer_overall_rating(officer_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    overall_rating numeric;
BEGIN
    -- Calculate overall rating across all reviews using rubric_value directly
    SELECT ROUND(AVG(rb.rubric_value)::numeric, 1)
    INTO overall_rating
    FROM review_officers ro
         JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
         JOIN rubrics rb ON rb.id = ror.rubric_id
    WHERE ro.officer_id = officer_id;

    -- Update the officers_stats record
    UPDATE officers_stats
    SET rating_overall = COALESCE(overall_rating, 0),
        updated_at = now()
    WHERE id = officer_id;
END;
$function$
;

CREATE TRIGGER agency_officer_change AFTER INSERT OR DELETE OR UPDATE ON public.agency_officers FOR EACH ROW EXECUTE FUNCTION handle_agency_officer_change();

CREATE TRIGGER review_rating_change AFTER INSERT OR DELETE OR UPDATE ON public.review_officers_ratings FOR EACH ROW EXECUTE FUNCTION handle_review_rating_change();


