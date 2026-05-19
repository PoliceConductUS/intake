drop trigger if exists "agency_officer_change" on "public"."agency_officers";

drop trigger if exists "review_rating_change" on "public"."review_officers_ratings";

alter table "public"."review_officers" add column "rating_overall" numeric default 0;

CREATE UNIQUE INDEX review_officers_ratings_review_officer_trait_unique ON public.review_officers_ratings USING btree (review_officer_id, trait_id);

alter table "public"."review_officers_ratings" add constraint "review_officers_ratings_review_officer_trait_unique" UNIQUE using index "review_officers_ratings_review_officer_trait_unique";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.calculate_agency_officer_stats(agency_officer_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
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
        
        -- Calculate overall rating as weighted average using the proper casting
        SELECT ROUND(AVG(rv.value)::numeric, 1)
        INTO overall_rating
        FROM jsonb_array_elements(ratings_data) AS elements
        JOIN rating_values rv ON rv.label = (elements->>'rubric_label')::public.rating_label;
    END IF;

    -- Update the agency_officer record
    UPDATE agency_officers 
    SET 
        review_stats = COALESCE(stats, '{}'::jsonb),
        rating_overall = COALESCE(overall_rating, 0),
        updated_at = now()
    WHERE id = agency_officer_id;
    
    -- Log the update for debugging
    RAISE NOTICE 'Updated agency_officer % with rating %', agency_officer_id, overall_rating;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_agency_officer_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Recalculate stats for the agency officer
        PERFORM calculate_agency_officer_stats(NEW.id);
        -- Update agency overall rating
        PERFORM update_agency_overall_rating(NEW.agency_id);
    ELSIF TG_OP = 'INSERT' THEN
        -- Calculate initial stats
        PERFORM calculate_agency_officer_stats(NEW.id);
        -- Update agency overall rating
        PERFORM update_agency_overall_rating(NEW.agency_id);
    ELSIF TG_OP = 'DELETE' THEN
        -- Update agency overall rating
        PERFORM update_agency_overall_rating(OLD.agency_id);
    END IF;
    
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
    SELECT ROUND(AVG(rating_overall)::numeric, 1)
    INTO overall_rating
    FROM agency_officers
    WHERE agency_id = agency_id
    AND rating_overall > 0;

    -- Update the agency record
    UPDATE agency 
    SET rating_overall = COALESCE(overall_rating, 0)
    WHERE id = agency_id;
END;
$function$
;

CREATE TRIGGER agency_officer_change AFTER INSERT OR DELETE OR UPDATE ON public.agency_officers FOR EACH ROW EXECUTE FUNCTION handle_agency_officer_change();
ALTER TABLE "public"."agency_officers" DISABLE TRIGGER "agency_officer_change";

CREATE TRIGGER review_rating_change AFTER INSERT OR DELETE OR UPDATE ON public.review_officers_ratings FOR EACH ROW EXECUTE FUNCTION handle_review_rating_change();
ALTER TABLE "public"."review_officers_ratings" DISABLE TRIGGER "review_rating_change";


