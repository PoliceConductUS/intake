set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.audit_trigger_func()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (table_name, record_id, action, new_values, created_by)
        VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', row_to_json(NEW), auth.uid());
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, created_by)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', row_to_json(OLD), row_to_json(NEW), auth.uid());
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (table_name, record_id, action, old_values, created_by)
        VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', row_to_json(OLD), auth.uid());
    END IF;
    RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_agency_officer_stats(agency_officer_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    ao record;
    stats jsonb;
    overall_rating numeric;
BEGIN
    -- Get the agency officer record
    SELECT * INTO ao FROM agency_officers WHERE id = agency_officer_id;
    
    -- Calculate stats for reviews within the employment period
    WITH review_ratings AS (
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
    SELECT 
        calculate_rating_stats(jsonb_agg(to_jsonb(review_ratings))) INTO stats
    FROM review_ratings;

    -- Calculate overall rating as weighted average
    SELECT ROUND(AVG(rv.value)::numeric, 1)
    INTO overall_rating
    FROM review_ratings rr
    JOIN rating_values rv ON rv.label = rr.rubric_label;

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

CREATE OR REPLACE FUNCTION public.calculate_overall_rating_stats(rating_stats jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  overall_stats jsonb;
  stat record;
  total_count integer := 0;
  weighted_sum numeric := 0;
BEGIN
  -- Initialize counts for each rating level
  overall_stats := jsonb_build_object(
    'outstanding', jsonb_build_object('count', 0, 'average', 0, 'weighted_average', 0),
    'good', jsonb_build_object('count', 0, 'average', 0, 'weighted_average', 0),
    'adequate', jsonb_build_object('count', 0, 'average', 0, 'weighted_average', 0),
    'needs_improvement', jsonb_build_object('count', 0, 'average', 0, 'weighted_average', 0),
    'unacceptable', jsonb_build_object('count', 0, 'average', 0, 'weighted_average', 0)
  );

  -- Calculate totals and classify ratings
  FOR stat IN 
    SELECT * FROM jsonb_each(rating_stats)
  LOOP
    -- Skip the 'overall' key if it exists
    IF stat.key != 'overall' THEN
      -- Extract values from the stat
      SELECT 
        (stat.value->>'count')::integer,
        (stat.value->>'average')::numeric,
        (stat.value->>'weighted_average')::numeric
      INTO total_count, weighted_sum;

      -- Classify the rating and update the corresponding count
      IF (stat.value->>'average')::numeric >= 4.5 THEN
        overall_stats := jsonb_set(
          overall_stats,
          '{outstanding,count}',
          (((overall_stats->'outstanding'->>'count')::integer + total_count)::text)::jsonb
        );
      ELSIF (stat.value->>'average')::numeric >= 3.5 THEN
        overall_stats := jsonb_set(
          overall_stats,
          '{good,count}',
          (((overall_stats->'good'->>'count')::integer + total_count)::text)::jsonb
        );
      ELSIF (stat.value->>'average')::numeric >= 2.5 THEN
        overall_stats := jsonb_set(
          overall_stats,
          '{adequate,count}',
          (((overall_stats->'adequate'->>'count')::integer + total_count)::text)::jsonb
        );
      ELSIF (stat.value->>'average')::numeric >= 1.5 THEN
        overall_stats := jsonb_set(
          overall_stats,
          '{needs_improvement,count}',
          (((overall_stats->'needs_improvement'->>'count')::integer + total_count)::text)::jsonb
        );
      ELSE
        overall_stats := jsonb_set(
          overall_stats,
          '{unacceptable,count}',
          (((overall_stats->'unacceptable'->>'count')::integer + total_count)::text)::jsonb
        );
      END IF;
    END IF;
  END LOOP;

  -- Calculate averages for each category
  FOR stat IN 
    SELECT * FROM jsonb_each(overall_stats)
  LOOP
    IF (stat.value->>'count')::integer > 0 THEN
      overall_stats := jsonb_set(
        overall_stats,
        ARRAY[stat.key, 'average'],
        '5'::jsonb  -- Set to maximum for the category
      );
      -- We could implement a more sophisticated weighted average calculation here if needed
      overall_stats := jsonb_set(
        overall_stats,
        ARRAY[stat.key, 'weighted_average'],
        '5'::jsonb  -- Set to maximum for the category
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('overall', overall_stats);
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
      r.label,
      COUNT(*) as count,
      AVG(rv.value) as average_value,
      -- Calculate weighted average based on review recency
      AVG(
        rv.value * 
        GREATEST(
          0.5,  -- Minimum weight of 0.5 for old reviews
          LEAST(
            1.0,  -- Maximum weight of 1.0 for recent reviews
            1.0 / (
              EXTRACT(EPOCH FROM (now() - (ror->>'created_at')::timestamp)) / 
              (365.25 * 24 * 60 * 60) + 1  -- Decay over years
            )
          )
        )
      ) as weighted_average
    FROM jsonb_array_elements(review_officers_ratings_array) as ror
    JOIN public.rubrics r ON (ror->>'rubric_id')::text = r.id
    JOIN public.rating_values rv ON rv.label = r.label
    GROUP BY r.label
  )
  SELECT 
    jsonb_object_agg(
      label::text,
      jsonb_build_object(
        'count', count,
        'average', ROUND(average_value::numeric, 1),
        'weighted_average', ROUND(weighted_average::numeric, 1)
      )
    )
  INTO stats
  FROM rating_counts;

  RETURN coalesce(stats, '{}'::jsonb);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_cuid()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN LOWER(
        'c' || 
        TO_CHAR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP), 'FM9999999999') || 
        SUBSTRING(MD5(RANDOM()::TEXT) FOR 8)
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_agency_officer_change()
 RETURNS trigger
 LANGUAGE plpgsql
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

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_review_rating_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    review_officer record;
    agency_officer record;
BEGIN
    -- Get the review_officer record
    SELECT * INTO review_officer 
    FROM review_officers 
    WHERE id = NEW.review_officer_id;

    -- Update stats for all relevant agency_officer records
    FOR agency_officer IN
        SELECT ao.* 
        FROM agency_officers ao
        JOIN reviews r ON r.incident_date >= ao.start_date 
            AND (ao.end_date IS NULL OR r.incident_date <= ao.end_date)
        JOIN review_officers ro ON ro.review_id = r.id
        WHERE ao.officer_id = review_officer.officer_id
    LOOP
        PERFORM calculate_agency_officer_stats(agency_officer.id);
        PERFORM update_agency_overall_rating(agency_officer.agency_id);
    END LOOP;

    -- Update officer overall rating
    PERFORM update_officer_overall_rating(review_officer.officer_id);

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.officers_audit_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    NEW.updated_by = auth.uid();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_trait_deletion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM review_officers_ratings WHERE trait_id = OLD.id) THEN
        RAISE EXCEPTION 'Cannot delete trait with existing ratings';
    END IF;
    RETURN OLD;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_trait_modification()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM review_officers_ratings WHERE trait_id = NEW.id) 
       AND (OLD.label != NEW.label) THEN
        RAISE EXCEPTION 'Cannot modify trait with existing ratings';
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.review_links_audit_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    NEW.updated_by = auth.uid();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_set_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_agency_overall_rating(agency_id text)
 RETURNS void
 LANGUAGE plpgsql
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

CREATE OR REPLACE FUNCTION public.update_officer_overall_rating(officer_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    overall_rating numeric;
BEGIN
    -- Calculate overall rating across all reviews
    SELECT ROUND(AVG(rv.value)::numeric, 1)
    INTO overall_rating
    FROM review_officers ro
    JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
    JOIN rubrics rb ON rb.id = ror.rubric_id
    JOIN rating_values rv ON rv.label = rb.label
    WHERE ro.officer_id = officer_id;

    -- Update the officer record
    UPDATE officers 
    SET rating_overall = COALESCE(overall_rating, 0)
    WHERE id = officer_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_overall_stats()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Calculate and merge the overall stats with existing review_stats
  NEW.review_stats := NEW.review_stats || calculate_overall_rating_stats(NEW.review_stats);
  RETURN NEW;
END;
$function$
;


