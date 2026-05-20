-- Collapsed from 20250304014526_remote_schema.sql

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



-- Collapsed from 20250304020837_remote_schema.sql

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



-- Collapsed from 20250304093111_remote_schema.sql

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



-- Collapsed from 20250322033735_remote_schema.sql


create or replace view "public"."agency_states" as  SELECT DISTINCT agency.state
   FROM agency
  ORDER BY agency.state;

-- Collapsed from 20250403042228_remote_schema.sql

drop trigger if exists "update_agency_overall_stats" on "public"."agency";

drop trigger if exists "update_officers_overall_stats" on "public"."officers";

revoke delete on table "public"."rating_values" from "anon";

revoke insert on table "public"."rating_values" from "anon";

revoke references on table "public"."rating_values" from "anon";

revoke select on table "public"."rating_values" from "anon";

revoke trigger on table "public"."rating_values" from "anon";

revoke truncate on table "public"."rating_values" from "anon";

revoke update on table "public"."rating_values" from "anon";

revoke delete on table "public"."rating_values" from "authenticated";

revoke insert on table "public"."rating_values" from "authenticated";

revoke references on table "public"."rating_values" from "authenticated";

revoke select on table "public"."rating_values" from "authenticated";

revoke trigger on table "public"."rating_values" from "authenticated";

revoke truncate on table "public"."rating_values" from "authenticated";

revoke update on table "public"."rating_values" from "authenticated";

revoke delete on table "public"."rating_values" from "service_role";

revoke insert on table "public"."rating_values" from "service_role";

revoke references on table "public"."rating_values" from "service_role";

revoke select on table "public"."rating_values" from "service_role";

revoke trigger on table "public"."rating_values" from "service_role";

revoke truncate on table "public"."rating_values" from "service_role";

revoke update on table "public"."rating_values" from "service_role";

alter table "public"."rating_values" drop constraint "rating_values_pkey";

drop table "public"."rating_values";

create table "public"."agency_officers_stats" (
    "id" text not null,
    "review_stats" jsonb default '{}'::jsonb,
    "rating_overall" numeric default 0,
    "review_count" integer default 0,
    "average" numeric default 0,
    "weighted_average" numeric default 0,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
    "updated_at" timestamp with time zone not null default timezone('utc'::text, now())
);


create table "public"."agency_stats" (
    "id" text not null,
    "review_stats" jsonb default '{}'::jsonb,
    "rating_overall" numeric default 0,
    "review_count" integer default 0,
    "average" numeric default 0,
    "weighted_average" numeric default 0,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
    "updated_at" timestamp with time zone not null default timezone('utc'::text, now())
);


create table "public"."officers_stats" (
    "id" text not null,
    "review_stats" jsonb default '{}'::jsonb,
    "rating_overall" numeric default 0,
    "review_count" integer default 0,
    "average" numeric default 0,
    "weighted_average" numeric default 0,
    "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
    "updated_at" timestamp with time zone not null default timezone('utc'::text, now())
);


create table "public"."rubric_labels" (
    "label" rating_label not null,
    "value" integer not null
);


alter table "public"."rubrics" drop column "label";

alter table "public"."rubrics" add column "rubric_value" integer not null;

CREATE UNIQUE INDEX agency_officers_stats_pkey ON public.agency_officers_stats USING btree (id);

CREATE UNIQUE INDEX agency_stats_pkey ON public.agency_stats USING btree (id);

CREATE UNIQUE INDEX officers_stats_pkey ON public.officers_stats USING btree (id);

CREATE UNIQUE INDEX rating_values_pkey ON public.rubric_labels USING btree (label);

alter table "public"."agency_officers_stats" add constraint "agency_officers_stats_pkey" PRIMARY KEY using index "agency_officers_stats_pkey";

alter table "public"."agency_stats" add constraint "agency_stats_pkey" PRIMARY KEY using index "agency_stats_pkey";

alter table "public"."officers_stats" add constraint "officers_stats_pkey" PRIMARY KEY using index "officers_stats_pkey";

alter table "public"."rubric_labels" add constraint "rating_values_pkey" PRIMARY KEY using index "rating_values_pkey";

alter table "public"."agency_officers_stats" add constraint "agency_officers_stats_id_fkey" FOREIGN KEY (id) REFERENCES agency_officers(id) ON DELETE CASCADE not valid;

alter table "public"."agency_officers_stats" validate constraint "agency_officers_stats_id_fkey";

alter table "public"."agency_stats" add constraint "agency_stats_id_fkey" FOREIGN KEY (id) REFERENCES agency(id) ON DELETE CASCADE not valid;

alter table "public"."agency_stats" validate constraint "agency_stats_id_fkey";

alter table "public"."officers_stats" add constraint "officers_stats_id_fkey" FOREIGN KEY (id) REFERENCES officers(id) ON DELETE CASCADE not valid;

alter table "public"."officers_stats" validate constraint "officers_stats_id_fkey";

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
            rl.label as rubric_label,
            rb.rubric_value
        FROM review_officers ro
        JOIN reviews r ON r.id = ro.review_id
        JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
        JOIN rubrics rb ON rb.id = ror.rubric_id
        JOIN rubric_labels rl ON rl.value = rb.rubric_value
        WHERE ro.officer_id = ao.officer_id
        AND (r.incident_date >= ao.start_date)
        AND (ao.end_date IS NULL OR r.incident_date <= ao.end_date)
    )
    SELECT jsonb_agg(to_jsonb(ratings_collection)) INTO ratings_data
    FROM ratings_collection;
    
    -- Calculate stats from the collected data
    IF ratings_data IS NOT NULL THEN
        stats := calculate_rating_stats(ratings_data);
        
        -- Calculate overall rating as weighted average using rubric_value directly
        SELECT ROUND(AVG(rubric_value)::numeric, 1)
        INTO overall_rating
        FROM (
            SELECT 
                (jsonb_array_elements(ratings_data)->>'rubric_value')::integer as rubric_value
            FROM (SELECT ratings_data) as rd
        ) as extracted_ratings;
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

CREATE OR REPLACE FUNCTION public.calculate_rating_stats(review_officers_ratings_array jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  stats jsonb;
BEGIN
  WITH rating_counts AS (
    SELECT 
      rl.label,
      COUNT(*) as count,
      AVG((ror->>'rubric_value')::numeric) as average_value,
      -- Calculate weighted average based on review recency
      AVG(
        (ror->>'rubric_value')::numeric * 
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
    JOIN public.rubric_labels rl ON rl.value = r.rubric_value
    GROUP BY rl.label
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

CREATE OR REPLACE FUNCTION public.update_officer_overall_rating(officer_id text)
 RETURNS void
 LANGUAGE plpgsql
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

    -- Update the officer record
    UPDATE officers
    SET rating_overall = COALESCE(overall_rating, 0)
    WHERE id = officer_id;
END;
$function$
;

grant delete on table "public"."agency_officers_stats" to "anon";

grant insert on table "public"."agency_officers_stats" to "anon";

grant references on table "public"."agency_officers_stats" to "anon";

grant select on table "public"."agency_officers_stats" to "anon";

grant trigger on table "public"."agency_officers_stats" to "anon";

grant truncate on table "public"."agency_officers_stats" to "anon";

grant update on table "public"."agency_officers_stats" to "anon";

grant delete on table "public"."agency_officers_stats" to "authenticated";

grant insert on table "public"."agency_officers_stats" to "authenticated";

grant references on table "public"."agency_officers_stats" to "authenticated";

grant select on table "public"."agency_officers_stats" to "authenticated";

grant trigger on table "public"."agency_officers_stats" to "authenticated";

grant truncate on table "public"."agency_officers_stats" to "authenticated";

grant update on table "public"."agency_officers_stats" to "authenticated";

grant delete on table "public"."agency_officers_stats" to "service_role";

grant insert on table "public"."agency_officers_stats" to "service_role";

grant references on table "public"."agency_officers_stats" to "service_role";

grant select on table "public"."agency_officers_stats" to "service_role";

grant trigger on table "public"."agency_officers_stats" to "service_role";

grant truncate on table "public"."agency_officers_stats" to "service_role";

grant update on table "public"."agency_officers_stats" to "service_role";

grant delete on table "public"."agency_stats" to "anon";

grant insert on table "public"."agency_stats" to "anon";

grant references on table "public"."agency_stats" to "anon";

grant select on table "public"."agency_stats" to "anon";

grant trigger on table "public"."agency_stats" to "anon";

grant truncate on table "public"."agency_stats" to "anon";

grant update on table "public"."agency_stats" to "anon";

grant delete on table "public"."agency_stats" to "authenticated";

grant insert on table "public"."agency_stats" to "authenticated";

grant references on table "public"."agency_stats" to "authenticated";

grant select on table "public"."agency_stats" to "authenticated";

grant trigger on table "public"."agency_stats" to "authenticated";

grant truncate on table "public"."agency_stats" to "authenticated";

grant update on table "public"."agency_stats" to "authenticated";

grant delete on table "public"."agency_stats" to "service_role";

grant insert on table "public"."agency_stats" to "service_role";

grant references on table "public"."agency_stats" to "service_role";

grant select on table "public"."agency_stats" to "service_role";

grant trigger on table "public"."agency_stats" to "service_role";

grant truncate on table "public"."agency_stats" to "service_role";

grant update on table "public"."agency_stats" to "service_role";

grant delete on table "public"."officers_stats" to "anon";

grant insert on table "public"."officers_stats" to "anon";

grant references on table "public"."officers_stats" to "anon";

grant select on table "public"."officers_stats" to "anon";

grant trigger on table "public"."officers_stats" to "anon";

grant truncate on table "public"."officers_stats" to "anon";

grant update on table "public"."officers_stats" to "anon";

grant delete on table "public"."officers_stats" to "authenticated";

grant insert on table "public"."officers_stats" to "authenticated";

grant references on table "public"."officers_stats" to "authenticated";

grant select on table "public"."officers_stats" to "authenticated";

grant trigger on table "public"."officers_stats" to "authenticated";

grant truncate on table "public"."officers_stats" to "authenticated";

grant update on table "public"."officers_stats" to "authenticated";

grant delete on table "public"."officers_stats" to "service_role";

grant insert on table "public"."officers_stats" to "service_role";

grant references on table "public"."officers_stats" to "service_role";

grant select on table "public"."officers_stats" to "service_role";

grant trigger on table "public"."officers_stats" to "service_role";

grant truncate on table "public"."officers_stats" to "service_role";

grant update on table "public"."officers_stats" to "service_role";

grant delete on table "public"."rubric_labels" to "anon";

grant insert on table "public"."rubric_labels" to "anon";

grant references on table "public"."rubric_labels" to "anon";

grant select on table "public"."rubric_labels" to "anon";

grant trigger on table "public"."rubric_labels" to "anon";

grant truncate on table "public"."rubric_labels" to "anon";

grant update on table "public"."rubric_labels" to "anon";

grant delete on table "public"."rubric_labels" to "authenticated";

grant insert on table "public"."rubric_labels" to "authenticated";

grant references on table "public"."rubric_labels" to "authenticated";

grant select on table "public"."rubric_labels" to "authenticated";

grant trigger on table "public"."rubric_labels" to "authenticated";

grant truncate on table "public"."rubric_labels" to "authenticated";

grant update on table "public"."rubric_labels" to "authenticated";

grant delete on table "public"."rubric_labels" to "service_role";

grant insert on table "public"."rubric_labels" to "service_role";

grant references on table "public"."rubric_labels" to "service_role";

grant select on table "public"."rubric_labels" to "service_role";

grant trigger on table "public"."rubric_labels" to "service_role";

grant truncate on table "public"."rubric_labels" to "service_role";

grant update on table "public"."rubric_labels" to "service_role";

CREATE TRIGGER update_agency_stats_overall_stats BEFORE UPDATE ON public.agency_stats FOR EACH ROW EXECUTE FUNCTION update_overall_stats();

CREATE TRIGGER update_officers_stats_overall_stats BEFORE UPDATE ON public.officers_stats FOR EACH ROW EXECUTE FUNCTION update_overall_stats();


-- Collapsed from 20250404174652_remote_schema.sql

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



-- Collapsed from 20250405021229_remote_schema.sql

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



-- Collapsed from 20250412000131_remote_schema.sql

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



-- Collapsed from 20250812130000_add_civil_cases.sql

create table if not exists public.civil_cases (
    id text not null,
    title text not null,
    cause_number text not null,
    court text,
    filed_date date not null,
    summary text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    primary key (id)
);

create unique index if not exists civil_cases_cause_number_key
    on public.civil_cases(cause_number);

create table if not exists public.civil_case_links (
    id text not null,
    civil_case_id text not null references public.civil_cases(id) on delete cascade,
    label text,
    url text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    primary key (id)
);

create unique index if not exists civil_case_links_case_url_key
    on public.civil_case_links(civil_case_id, url);

create table if not exists public.civil_case_agencies (
    civil_case_id text not null references public.civil_cases(id) on delete cascade,
    agency_id text not null references public.agency(id) on delete cascade,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    primary key (civil_case_id, agency_id)
);

create table if not exists public.civil_case_officers (
    civil_case_id text not null references public.civil_cases(id) on delete cascade,
    officer_id text not null references public.officers(id) on delete cascade,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    primary key (civil_case_id, officer_id)
);

create index if not exists civil_case_links_case_id_idx
    on public.civil_case_links(civil_case_id);

create index if not exists civil_case_agencies_agency_id_idx
    on public.civil_case_agencies(agency_id);

create index if not exists civil_case_officers_officer_id_idx
    on public.civil_case_officers(officer_id);

-- Civil cases data is seeded in seed.sql with explicit IDs

-- Collapsed from 20250820120000_add_entity_slugs.sql

do $$
begin
  if not exists (
    select 1
    from pg_extension
    where extname = 'pgcrypto'
  ) then
    create extension pgcrypto;
  end if;
end $$;

create or replace function public.hash_id(value text)
returns text
language sql
immutable
as $$
  select substr(encode(digest(value, 'sha1'), 'hex'), 1, 6);
$$;

create or replace function public.slugify(value text)
returns text
language sql
immutable
as $$
  select case
    when value is null or btrim(value) = '' then 'unknown'
    else regexp_replace(
      regexp_replace(lower(value), '[^a-z0-9]+', '-', 'g'),
      '(^-|-$)',
      '',
      'g'
    )
  end;
$$;

alter table public.agency
  add column if not exists slug text;

alter table public.officers
  add column if not exists slug text;

alter table public.reviews
  add column if not exists slug text;

update public.agency
set slug = public.slugify(name) || '-' || public.hash_id(id)
where slug is null;

update public.officers
set slug = public.slugify(trim(concat_ws(' ', first_name, last_name, suffix)))
  || '-' || public.hash_id(id)
where slug is null;

update public.reviews
set slug = concat_ws(
  '-',
  coalesce(to_char(incident_date, 'YYYY-MM-DD'), 'unknown-date'),
  coalesce(substring(address from '(\\d{5})'), '75061'),
  public.slugify(title),
  public.hash_id(id)
)
where slug is null;

alter table public.agency
  alter column slug set not null;

alter table public.officers
  alter column slug set not null;

alter table public.reviews
  alter column slug set not null;

create unique index if not exists agency_slug_key
  on public.agency(slug);

create unique index if not exists officers_slug_key
  on public.officers(slug);

create unique index if not exists reviews_slug_key
  on public.reviews(slug);

-- Collapsed from 20250820133000_add_agency_category.sql

create or replace function public.set_agency_category()
returns trigger
language plpgsql
as $$
begin
  if new.category is null then
    new.category := lower(new.state);
  end if;
  return new;
end;
$$;

alter table public.agency
  add column if not exists category text;

update public.agency
set category = lower(state)
where category is null;

-- Seeded IDs must be explicit and stable across database resets. Do not use
-- public.generate_cuid(), gen_random_uuid(), default-generated IDs, or any other
-- runtime ID generator in migrations or seed data.
with federal_rows(id, name, city, state, address, zip_code) as (
  values
    ('cgsmkptihlupk5bjwyvdgtcq', 'Federal Bureau of Investigation (FBI)', 'Washington', 'DC', '935 Pennsylvania Avenue NW', '20535'),
    ('cv04crq73alq62kp5v0s3fx3', 'Drug Enforcement Administration (DEA)', 'Washington', 'DC', '8701 Morrissette Drive', '22152'),
    ('cjtbmujxlur44dvljhfprrx1', 'Bureau of Alcohol, Tobacco, Firearms and Explosives (ATF)', 'Washington', 'DC', '99 New York Avenue NE', '20226'),
    ('cs2sz1y65zqybhahepchwol6', 'U.S. Marshals Service', 'Washington', 'DC', '510 5th Street NW', '20530'),
    ('czyyk2hqe9ke2kq3cg9nodb4', 'U.S. Immigration and Customs Enforcement (ICE)', 'Washington', 'DC', '500 12th Street SW', '20536'),
    ('cufdb3i3jzsr5kkfuto7huqk', 'U.S. Customs and Border Protection (CBP)', 'Washington', 'DC', '1300 Pennsylvania Avenue NW', '20229'),
    ('cato8mt9eyb6zrazpvbis0hz', 'U.S. Secret Service (USSS)', 'Washington', 'DC', '245 Murray Lane SW', '20223'),
    ('chvdwkxp1cjwertwzt6ll9b0', 'Transportation Security Administration (TSA)', 'Springfield', 'VA', '6595 Springfield Center Drive', '22150'),
    ('c887sm2ibjg8c2yp4e4f4es5', 'U.S. Coast Guard (USCG)', 'Washington', 'DC', '2703 Martin Luther King Jr Ave SE', '20593')
)
insert into public.agency (
  id,
  name,
  city,
  state,
  address,
  zip_code,
  category,
  created_at,
  updated_at,
  slug
)
select
  id,
  name,
  city,
  state,
  address,
  zip_code,
  'federal',
  timezone('utc'::text, now()),
  timezone('utc'::text, now()),
  public.slugify(name) || '-' || public.hash_id(id)
from federal_rows
on conflict (slug) do update
set name = excluded.name,
    city = excluded.city,
    state = excluded.state,
    address = excluded.address,
    zip_code = excluded.zip_code,
    category = excluded.category,
    updated_at = excluded.updated_at;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'agency_set_category'
  ) then
    create trigger agency_set_category
      before insert or update on public.agency
      for each row
      execute function public.set_agency_category();
  end if;
end;
$$;

alter table public.agency
  alter column category set not null;

-- Collapsed from 20250820143000_add_review_category.sql

alter table public.reviews
  add column if not exists category text;

update public.reviews
set category = 'tx'
where category is null;

alter table public.reviews
  alter column category set not null;

-- Collapsed from 20250914000000_add_review_charges.sql

alter table public.reviews
add column if not exists charges text;

-- Collapsed from 20260127012004_change_review_officers_to_agency_officer_id.sql

-- Migration: Change review_officers.officer_id to agency_officer_id
-- This links reviews directly to the officer-at-agency context

-- Step 1: Add new column
ALTER TABLE public.review_officers
  ADD COLUMN IF NOT EXISTS agency_officer_id text;

-- Step 2: Populate new column from existing data
-- Maps officer_id + review.incident_date to the appropriate agency_officers record
UPDATE review_officers ro
SET agency_officer_id = (
  SELECT ao.id
  FROM agency_officers ao
  JOIN reviews r ON r.id = ro.review_id
  WHERE ao.officer_id = ro.officer_id
    AND r.incident_date >= ao.start_date
    AND (ao.end_date IS NULL OR r.incident_date <= ao.end_date)
  ORDER BY ao.start_date DESC
  LIMIT 1
);

-- Step 3: Verify no orphaned records (fail if any exist)
DO $$
DECLARE
  orphan_count integer;
  orphan_details text;
BEGIN
  SELECT COUNT(*), string_agg(ro.id || ' (officer: ' || ro.officer_id || ', review: ' || ro.review_id || ')', ', ')
  INTO orphan_count, orphan_details
  FROM review_officers ro
  WHERE ro.agency_officer_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % review_officers records have no matching agency_officer. Records: %', orphan_count, orphan_details;
  END IF;
END $$;

-- Step 4: Add NOT NULL constraint
ALTER TABLE public.review_officers
  ALTER COLUMN agency_officer_id SET NOT NULL;

-- Step 5: Add foreign key constraint
ALTER TABLE public.review_officers
  ADD CONSTRAINT review_officers_agency_officer_id_fkey
  FOREIGN KEY (agency_officer_id) REFERENCES agency_officers(id);

-- Step 6: Create index on new column
CREATE INDEX IF NOT EXISTS review_officers_agency_officer_id_idx
  ON public.review_officers(agency_officer_id);

-- Step 7: Drop old column and index
DROP INDEX IF EXISTS review_officers_officer_id_idx;
ALTER TABLE public.review_officers
  DROP CONSTRAINT IF EXISTS review_officers_officer_id_fkey;
ALTER TABLE public.review_officers
  DROP COLUMN IF EXISTS officer_id;

-- Step 8: Disable stats-related triggers (stats are pre-calculated in seed)
-- These can be re-enabled later after updating the functions
DO $$
BEGIN
  ALTER TABLE public.agency_officers DISABLE TRIGGER agency_officer_change;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.review_officers_ratings DISABLE TRIGGER review_rating_change;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.agency_stats DISABLE TRIGGER update_agency_stats_overall_stats;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.officers_stats DISABLE TRIGGER update_officers_stats_overall_stats;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Collapsed from 20260127023839_make_reviews_user_id_not_null.sql

-- Set user_id for all existing reviews
UPDATE public.reviews
SET user_id = 'ccce35fb-938c-4c94-8724-492367b17ce5'
WHERE user_id IS NULL;

-- Make user_id NOT NULL
ALTER TABLE public.reviews
ALTER COLUMN user_id SET NOT NULL;

-- Update the foreign key constraint to ON DELETE RESTRICT (since NULL is no longer allowed)
ALTER TABLE public.reviews
DROP CONSTRAINT reviews_user_id_fkey;

ALTER TABLE public.reviews
ADD CONSTRAINT reviews_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- Collapsed from 20260127044838_remove_duplicate_ice_agency.sql

-- Consolidate duplicate ICE agencies
-- Keep the one with reports, rename it to include "(ICE)", delete the empty duplicate

-- First, rename the agency that has linked officers/reports to include "(ICE)" and use abbreviation slug
UPDATE public.agency
SET name = 'U.S. Immigration and Customs Enforcement (ICE)',
    slug = 'ice',
    updated_at = NOW()
WHERE name = 'U.S. Immigration and Customs Enforcement'
AND id IN (SELECT DISTINCT agency_id FROM public.agency_officers WHERE agency_id IS NOT NULL);

-- Delete agency_stats for the duplicate (the one with no linked officers)
DELETE FROM public.agency_stats
WHERE id IN (
  SELECT id FROM public.agency
  WHERE name = 'U.S. Immigration and Customs Enforcement (ICE)'
  AND id NOT IN (SELECT DISTINCT agency_id FROM public.agency_officers WHERE agency_id IS NOT NULL)
);

-- Delete the duplicate agency (the one with no linked officers)
DELETE FROM public.agency
WHERE name = 'U.S. Immigration and Customs Enforcement (ICE)'
AND id NOT IN (SELECT DISTINCT agency_id FROM public.agency_officers WHERE agency_id IS NOT NULL);

-- Update other federal agency slugs to use common abbreviations
UPDATE public.agency SET slug = 'fbi', updated_at = NOW()
WHERE name = 'Federal Bureau of Investigation (FBI)' AND slug != 'fbi';

UPDATE public.agency SET slug = 'dea', updated_at = NOW()
WHERE name = 'Drug Enforcement Administration (DEA)' AND slug != 'dea';

UPDATE public.agency SET slug = 'atf', updated_at = NOW()
WHERE name = 'Bureau of Alcohol, Tobacco, Firearms and Explosives (ATF)' AND slug != 'atf';

UPDATE public.agency SET slug = 'usms', updated_at = NOW()
WHERE name = 'U.S. Marshals Service' AND slug != 'usms';

UPDATE public.agency SET slug = 'cbp', updated_at = NOW()
WHERE name = 'U.S. Customs and Border Protection (CBP)' AND slug != 'cbp';

UPDATE public.agency SET slug = 'usss', updated_at = NOW()
WHERE name = 'U.S. Secret Service (USSS)' AND slug != 'usss';

UPDATE public.agency SET slug = 'tsa', updated_at = NOW()
WHERE name = 'Transportation Security Administration (TSA)' AND slug != 'tsa';

UPDATE public.agency SET slug = 'uscg', updated_at = NOW()
WHERE name = 'U.S. Coast Guard (USCG)' AND slug != 'uscg';

-- Collapsed from 20260127050000_refactor_civil_case_officers.sql

-- Refactor civil_case_officers to use agency_officer_id instead of officer_id
-- This mirrors the review_officers pattern where agency_officer_id links to both officer and agency

-- Add category column to civil_cases (like agency and reviews have)
ALTER TABLE public.civil_cases
  ADD COLUMN IF NOT EXISTS category text;

-- Drop civil_case_agencies (agency is now inferred from agency_officer_id)
DROP TABLE IF EXISTS public.civil_case_agencies;

-- Drop old civil_case_officers table
DROP TABLE IF EXISTS public.civil_case_officers;

-- Create new civil_case_officers table with agency_officer_id
CREATE TABLE public.civil_case_officers (
    id text NOT NULL,
    civil_case_id text NOT NULL REFERENCES public.civil_cases(id) ON DELETE CASCADE,
    agency_officer_id text NOT NULL REFERENCES public.agency_officers(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (id)
);

-- Unique constraint on civil_case_id + agency_officer_id pair
CREATE UNIQUE INDEX civil_case_officers_case_agency_officer_unique
    ON public.civil_case_officers(civil_case_id, agency_officer_id);

-- Index for lookups by agency_officer_id
CREATE INDEX civil_case_officers_agency_officer_id_idx
    ON public.civil_case_officers(agency_officer_id);

-- Index for lookups by civil_case_id
CREATE INDEX civil_case_officers_civil_case_id_idx
    ON public.civil_case_officers(civil_case_id);

-- Collapsed from 20260224120000_add_officer_deceased_fields.sql

alter table public.officers
  add column if not exists deceased_on date null,
  add column if not exists deceased_source text null,
  add column if not exists deceased_message text null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.officers'::regclass
      and conname = 'officers_deceased_on_not_future_check'
  ) then
    alter table public.officers
      drop constraint officers_deceased_on_not_future_check;
  end if;
end $$;

alter table public.officers
  add constraint officers_deceased_on_not_future_check
  check (deceased_on is null or deceased_on <= current_date);

update public.officers
set
  deceased_on = date '2026-02-08',
  deceased_source = 'https://www.ktre.com/2026/02/08/san-augustine-police-officer-dies-duty/',
  deceased_message = 'Reported deceased on February 8, 2026.'
where slug = 'cody-levassar-3403af';

update public.officers
set
  deceased_on = date '2026-02-18',
  deceased_source = 'https://abc13.com/post/off-duty-hcso-deputy-killed-crash-aldine-westfield-north-harris-county-sheriff-says/18615911/',
  deceased_message = 'Reported deceased on February 18, 2026.'
where slug = 'ricky-zaragosa-fb1f53';

-- Collapsed from 20260321190000_upgrade_civil_cases_for_detail_pages.sql

alter table public.civil_cases
  add column if not exists slug text,
  add column if not exists outcome text,
  add column if not exists primary_source_url text;

alter table public.civil_cases
  rename column summary to claims_summary;

update public.civil_cases civil_case
set slug = concat(
  coalesce(
    nullif(
      lower(
        regexp_replace(
          regexp_replace(
            coalesce(civil_case.cause_number, civil_case.title, 'civil-case'),
            '[^a-zA-Z0-9]+',
            '-',
            'g'
          ),
          '(^-|-$)',
          '',
          'g'
        )
      ),
      ''
    ),
    'civil-case'
  ),
  '-',
  substr(md5(civil_case.id), 1, 6)
)
where civil_case.slug is null;

update public.civil_cases civil_case
set category = category_data.category
from (
  select
    cco.civil_case_id,
    case
      when bool_or(lower(agency.category) = 'federal') then 'federal'
      else min(lower(agency.category))
    end as category
  from public.civil_case_officers cco
  join public.agency_officers agency_officer
    on agency_officer.id = cco.agency_officer_id
  join public.agency agency
    on agency.id = agency_officer.agency_id
  group by cco.civil_case_id
) as category_data
where civil_case.id = category_data.civil_case_id
  and civil_case.category is null;

update public.civil_cases civil_case
set primary_source_url = primary_link.url
from (
  select distinct on (civil_case_id)
    civil_case_id,
    url
  from public.civil_case_links
  order by
    civil_case_id,
    case when coalesce(label, '') = 'CourtListener' then 0 else 1 end,
    created_at,
    id
) as primary_link
where civil_case.id = primary_link.civil_case_id
  and civil_case.primary_source_url is null;

alter table public.civil_case_links
  add column if not exists title text;

update public.civil_case_links
set title = coalesce(
  nullif(title, ''),
  nullif(label, ''),
  regexp_replace(url, '^https?://(www\.)?([^/]+)/?.*$', '\2')
)
where title is null;

delete from public.civil_case_links link
using public.civil_cases civil_case
where link.civil_case_id = civil_case.id
  and civil_case.primary_source_url = link.url;

alter table public.civil_case_links
  alter column title set not null;

alter table public.civil_case_links
  drop column if exists label;

alter table public.civil_cases
  alter column slug set not null,
  alter column category set not null;

create unique index if not exists civil_cases_slug_key
  on public.civil_cases(slug);

-- Collapsed from 20260505120000_add_video_collection.sql

create table if not exists public.coverage_links (
  id text not null,
  url text not null,
  normalized_url text not null,
  title text not null,
  source_name text,
  published_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (id)
);

create unique index if not exists coverage_links_normalized_url_key
  on public.coverage_links(normalized_url);

create table if not exists public.coverage_link_agency_officers (
  id text not null,
  coverage_link_id text not null references public.coverage_links(id) on delete cascade,
  agency_officer_id text not null references public.agency_officers(id) on delete cascade,
  confidence text not null default 'documented',
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (id)
);

create unique index if not exists coverage_link_agency_officers_unique_relationship
  on public.coverage_link_agency_officers(coverage_link_id, agency_officer_id);

create index if not exists coverage_link_agency_officers_coverage_link_id_idx
  on public.coverage_link_agency_officers(coverage_link_id);

create index if not exists coverage_link_agency_officers_agency_officer_id_idx
  on public.coverage_link_agency_officers(agency_officer_id);

create table if not exists public.coverage_link_civil_cases (
  id text not null,
  coverage_link_id text not null references public.coverage_links(id) on delete cascade,
  civil_case_id text not null references public.civil_cases(id) on delete cascade,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (id)
);

create unique index if not exists coverage_link_civil_cases_unique_relationship
  on public.coverage_link_civil_cases(coverage_link_id, civil_case_id);

create index if not exists coverage_link_civil_cases_coverage_link_id_idx
  on public.coverage_link_civil_cases(coverage_link_id);

create index if not exists coverage_link_civil_cases_civil_case_id_idx
  on public.coverage_link_civil_cases(civil_case_id);

create table if not exists public.coverage_link_reports (
  id text not null,
  coverage_link_id text not null references public.coverage_links(id) on delete cascade,
  review_id text not null references public.reviews(id) on delete cascade,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (id)
);

create unique index if not exists coverage_link_reports_unique_relationship
  on public.coverage_link_reports(coverage_link_id, review_id);

create index if not exists coverage_link_reports_coverage_link_id_idx
  on public.coverage_link_reports(coverage_link_id);

create index if not exists coverage_link_reports_review_id_idx
  on public.coverage_link_reports(review_id);

-- Collapsed from 20260507210000_add_personnel_coverage_links.sql

-- Personnel coverage now uses public.coverage_links plus
-- public.coverage_link_agency_officers.

-- Collapsed from 20260508120000_require_agency_link_labels.sql

alter table public.agency_links
  add column if not exists label text;

update public.agency_links
set label = case
  when url ~* '(^|//)(www\.)?youtube\.com/' then 'YouTube'
  when url ~* '(^|//)(www\.)?facebook\.com/' then 'Facebook'
  when url ~* '(^|//)(www\.)?(twitter|x)\.com/' then 'X'
  when url ~* '(^|//)(www\.)?instagram\.com/' then 'Instagram'
  else 'Website'
end
where label is null or btrim(label) = '';

alter table public.agency_links
  alter column label set not null;

comment on column public.agency_links.label is
  'Short display label for the agency link. The URL remains the href.';

-- Collapsed from 20260509120000_add_agency_place_navigation_fields.sql

alter table public.agency
  add column if not exists administrative_area text,
  add column if not exists administrative_area_slug text,
  add column if not exists place_slug text,
  add column if not exists canonical_url text;

comment on column public.agency.administrative_area is
  'Address-derived county, parish, borough, district, or named county-equivalent. Not jurisdiction or service area.';
comment on column public.agency.administrative_area_slug is
  'Database-backed slug for the address-derived county or county-equivalent.';
comment on column public.agency.place_slug is
  'Database-backed slug for address-derived city/place.';
comment on column public.agency.canonical_url is
  'Canonical address-derived public agency URL.';

-- Deterministic address-based navigation enrichment.
-- Values are generated from agency address data using Census geocoding, ZIP centroid county lookup,
-- explicit county names in agency names, and manual corrections for invalid placeholder address rows.
with agency_location_seed(id, city, state, category, administrative_area, administrative_area_slug, place_slug) as (
  values
    ('1qae8g9bwjxizot3oik77aobek9o', 'Cleveland', 'OH', 'oh', 'Cuyahoga County', 'cuyahoga-county', 'cleveland'),
    ('26326oq3fib5momlue31ripuejqg', 'Sacramento', 'CA', 'ca', 'Sacramento County', 'sacramento-county', 'sacramento'),
    ('26ordlmg9n6l5gmciznxjtgehkqq', 'Antioch', 'CA', 'ca', 'Contra Costa County', 'contra-costa-county', 'antioch'),
    ('2rpk0ho90sfk5lehkx6ae94c50kz', 'Oakland', 'CA', 'ca', 'Alameda County', 'alameda-county', 'oakland'),
    ('3za6b983yf3rrjbo5m0j4z9v073y', 'Chicago', 'IL', 'il', 'Cook County', 'cook-county', 'chicago'),
    ('498sqd3yl4gl6m67qole8f8k7u4k', 'Akron', 'OH', 'oh', 'Summit County', 'summit-county', 'akron'),
    ('6tglneef7eqy6kcb1agfxx7iq7bd', 'Memphis', 'TN', 'tn', 'Shelby County', 'shelby-county', 'memphis'),
    ('6v3oagumkwb0utqi39tn0v7k76k8', 'Sacramento', 'CA', 'ca', 'Sacramento County', 'sacramento-county', 'sacramento'),
    ('azc6n47oplmlxa1cu0izal7wwoyv', 'Dallas', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('bx86sthiesceqzexnjalnhyy', 'Lodi', 'CA', 'ca', 'San Joaquin County', 'san-joaquin-county', 'lodi'),
    ('c17783684580eaa7e82', 'Washington', 'DC', 'dc', 'Fairfax County', 'fairfax-county', 'washington'),
    ('c17783684581c7d0d70', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('c17783684581e49c64e', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('c17783684581f33d73e', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('c177836845850fb54be', 'Springfield', 'VA', 'va', 'Fairfax County', 'fairfax-county', 'springfield'),
    ('c1778368458a37d8915', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('c1778368458a58659b6', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('c1778368458f1881f2d', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm76wpxay0000vrvgdxiu6q4p', 'Austin', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm76wpxay0002vrvgzo69nez1', 'Palestine', 'TX', 'tx', 'Anderson County', 'anderson-county', 'palestine'),
    ('cm76wpxay0005vrvg1wut7mlg', 'PALESTINE', 'TX', 'tx', 'Anderson County', 'anderson-county', 'palestine'),
    ('cm76wpxay0008vrvgb79ptov8', 'Elkhart', 'TX', 'tx', 'Anderson County', 'anderson-county', 'elkhart'),
    ('cm76wpxay000bvrvg0jy1z0ho', 'Palestine', 'TX', 'tx', 'Anderson County', 'anderson-county', 'palestine'),
    ('cm76wpxay000evrvgpxcoivky', 'Palestine', 'TX', 'tx', 'Anderson County', 'anderson-county', 'palestine'),
    ('cm76wpxay000hvrvgtacgx2xn', 'PALESTINE', 'TX', 'tx', 'Anderson County', 'anderson-county', 'palestine'),
    ('cm76wpxay000kvrvgcurs2lfg', 'PALESTINE', 'TX', 'tx', 'Anderson County', 'anderson-county', 'palestine'),
    ('cm76wpxay000nvrvg2aii9dma', 'FRANKSTON', 'TX', 'tx', 'Anderson County', 'anderson-county', 'frankston'),
    ('cm76wpxay000qvrvgodeb5gko', 'PALESTINE', 'TX', 'tx', 'Anderson County', 'anderson-county', 'palestine'),
    ('cm76wpxay000tvrvgvnc5lshx', 'PALESTINE', 'TX', 'tx', 'Anderson County', 'anderson-county', 'palestine'),
    ('cm76wpxay000vvrvgd7ezo4fp', 'PALESTINE', 'TX', 'tx', 'Anderson County', 'anderson-county', 'palestine'),
    ('cm76wpxay000yvrvg723pf9r0', 'Palestine', 'TX', 'tx', 'Anderson County', 'anderson-county', 'palestine'),
    ('cm76wpxay0011vrvgv3hd6ldt', 'Palestine', 'TX', 'tx', 'Anderson County', 'anderson-county', 'palestine'),
    ('cm76wpxay0014vrvgicuzi1y4', 'TENNESSEE COLONY', 'TX', 'tx', 'Anderson County', 'anderson-county', 'tennessee-colony'),
    ('cm76wpxay0017vrvgz7vi1nch', 'ELKHART', 'TX', 'tx', 'Anderson County', 'anderson-county', 'elkhart'),
    ('cm76wpxay0019vrvgy0k36aen', 'Andrews', 'TX', 'tx', 'Andrews County', 'andrews-county', 'andrews'),
    ('cm76wpxay001cvrvga2zjpx2m', 'ANDREWS', 'TX', 'tx', 'Andrews County', 'andrews-county', 'andrews'),
    ('cm76wpxay001fvrvgcj1ydhrx', 'Andrews', 'TX', 'tx', 'Andrews County', 'andrews-county', 'andrews'),
    ('cm76wpxay001ivrvgnqyuey7j', 'Andrews', 'TX', 'tx', 'Andrews County', 'andrews-county', 'andrews'),
    ('cm76wpxay001lvrvgs1nt3ez2', 'Andrews', 'TX', 'tx', 'Andrews County', 'andrews-county', 'andrews'),
    ('cm76wpxay001ovrvgqgvf6gla', 'ANDREWS', 'TX', 'tx', 'Andrews County', 'andrews-county', 'andrews'),
    ('cm76wpxay001rvrvg66rttft3', 'Lufkin', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz001uvrvghjrllpvw', 'Lufkin', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz001xvrvg4cju5vxj', 'LUFKIN', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz0020vrvghqd6h2ir', 'Lufkin', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz0023vrvgh6z4c1it', 'Lufkin', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz0026vrvgi9724a4g', 'HUNTINGTON', 'TX', 'tx', 'Angelina County', 'angelina-county', 'huntington'),
    ('cm76wpxaz0029vrvgdvnaxfnw', 'Diboll', 'TX', 'tx', 'Angelina County', 'angelina-county', 'diboll'),
    ('cm76wpxaz002cvrvg1sqt6y4a', 'LUFKIN', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz002fvrvg8cizrvbi', 'LUFKIN', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz002ivrvg34rzy0t3', 'DIBOLL', 'TX', 'tx', 'Angelina County', 'angelina-county', 'diboll'),
    ('cm76wpxaz002lvrvg9qtqv2ac', 'HUDSON', 'TX', 'tx', 'Angelina County', 'angelina-county', 'hudson'),
    ('cm76wpxaz002ovrvga1639qgk', 'HUNTINGTON', 'TX', 'tx', 'Angelina County', 'angelina-county', 'huntington'),
    ('cm76wpxaz002rvrvgzt6sie79', 'LUFKIN', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz002uvrvgm7smc4qv', 'ZAVALLA', 'TX', 'tx', 'Angelina County', 'angelina-county', 'zavalla'),
    ('cm76wpxaz002xvrvgsql5psag', 'LUFKIN', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz0030vrvgbz19cr6q', 'Lufkin', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz0033vrvg94sh0wnm', 'Zavalla', 'TX', 'tx', 'Angelina County', 'angelina-county', 'zavalla'),
    ('cm76wpxaz0036vrvgcqd52xa7', 'LUFKIN', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz0039vrvgkev4v5d9', 'HUNTINGTON', 'TX', 'tx', 'Angelina County', 'angelina-county', 'huntington'),
    ('cm76wpxaz003cvrvgybrb16cb', 'DIBOLL', 'TX', 'tx', 'Angelina County', 'angelina-county', 'diboll'),
    ('cm76wpxaz003fvrvg17anj5p7', 'POLLOK', 'TX', 'tx', 'Angelina County', 'angelina-county', 'pollok'),
    ('cm76wpxaz003ivrvg1olyvgmm', 'Lufkin', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz003lvrvglz9yi6op', 'Lufkin', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxaz003ovrvgur8hx59x', 'ROCKPORT', 'TX', 'tx', 'Aransas County', 'aransas-county', 'rockport'),
    ('cm76wpxaz003rvrvgry3mxdyi', 'ROCKPORT', 'TX', 'tx', 'Aransas County', 'aransas-county', 'rockport'),
    ('cm76wpxaz003uvrvgjbtkwvpa', 'Rockport', 'TX', 'tx', 'Aransas County', 'aransas-county', 'rockport'),
    ('cm76wpxaz003xvrvgogx5py7p', 'ROCKPORT', 'TX', 'tx', 'Aransas County', 'aransas-county', 'rockport'),
    ('cm76wpxaz0040vrvghjn91mp3', 'ROCKPORT', 'TX', 'tx', 'Aransas County', 'aransas-county', 'rockport'),
    ('cm76wpxaz0043vrvg0k8vw9bu', 'FULTON', 'TX', 'tx', 'Aransas County', 'aransas-county', 'fulton'),
    ('cm76wpxaz0046vrvghrw532jl', 'ROCKPORT', 'TX', 'tx', 'Aransas County', 'aransas-county', 'rockport'),
    ('cm76wpxaz0049vrvg6pljzush', 'ROCKPORT', 'TX', 'tx', 'Aransas County', 'aransas-county', 'rockport'),
    ('cm76wpxaz004cvrvgta4xrd5a', 'ARCHER CITY', 'TX', 'tx', 'Archer County', 'archer-county', 'archer-city'),
    ('cm76wpxaz004fvrvg57kmu4j2', 'Holliday', 'TX', 'tx', 'Archer County', 'archer-county', 'holliday'),
    ('cm76wpxaz004ivrvgzmv3gb5d', 'Lakeside City', 'TX', 'tx', 'Archer County', 'archer-county', 'lakeside-city'),
    ('cm76wpxaz004kvrvgl13cxmgt', 'Archer', 'TX', 'tx', 'Archer County', 'archer-county', 'archer'),
    ('cm76wpxaz004mvrvggeao7cgd', 'Archer City', 'TX', 'tx', 'Hamilton County', 'hamilton-county', 'archer-city'),
    ('cm76wpxaz004ovrvgnuyj4oiw', 'ARCHER CITY', 'TX', 'tx', 'Archer County', 'archer-county', 'archer-city'),
    ('cm76wpxaz004rvrvgloinxqjf', 'HOLLIDAY', 'TX', 'tx', 'Archer County', 'archer-county', 'holliday'),
    ('cm76wpxaz004uvrvgznwnx1za', 'CLAUDE', 'TX', 'tx', 'Armstrong County', 'armstrong-county', 'claude'),
    ('cm76wpxaz004xvrvg020grggv', 'JOURDANTON', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'jourdanton'),
    ('cm76wpxaz0050vrvg5iqduobd', 'PLEASANTON', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'pleasanton'),
    ('cm76wpxaz0053vrvg7hexk7vh', 'LYTLE', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'lytle'),
    ('cm76wpxaz0056vrvg3r9806n5', 'Jourdanton', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'jourdanton'),
    ('cm76wpxaz0059vrvg2anr2x3j', 'Pleasanton', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'pleasanton'),
    ('cm76wpxaz005cvrvg676a2aj3', 'JOURDANTON', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'jourdanton'),
    ('cm76wpxaz005fvrvgizunl7hc', 'Floresville', 'TX', 'tx', 'Wilson County', 'wilson-county', 'floresville'),
    ('cm76wpxaz005ivrvgi1g6vena', 'Jourdanton', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'jourdanton'),
    ('cm76wpxaz005lvrvgfuxazt80', 'JOURDANTON', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'jourdanton'),
    ('cm76wpxaz005ovrvgyzoz4swx', 'LYTLE', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'lytle'),
    ('cm76wpxaz005rvrvgbt9lb2h0', 'PLEASANTON', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'pleasanton'),
    ('cm76wpxaz005uvrvg1x57u9lu', 'Poteet', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'poteet'),
    ('cm76wpxaz005xvrvgce18zunk', 'POTEET', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'poteet'),
    ('cm76wpxaz0060vrvgvrnzoujb', 'PLEASANTON', 'TX', 'tx', 'Atascosa County', 'atascosa-county', 'pleasanton'),
    ('cm76wpxaz0063vrvgrr8j9m0t', 'Belleville', 'TX', 'tx', 'Austin County', 'austin-county', 'belleville'),
    ('cm76wpxaz0066vrvg7m22y3wg', 'BELLVILLE', 'TX', 'tx', 'Austin County', 'austin-county', 'bellville'),
    ('cm76wpxaz0069vrvgnxm10091', 'BELLVILLE', 'TX', 'tx', 'Austin County', 'austin-county', 'bellville'),
    ('cm76wpxaz006cvrvgnjbqazt8', 'Bleiblerville', 'TX', 'tx', 'Austin County', 'austin-county', 'bleiblerville'),
    ('cm76wpxaz006fvrvgqq46qu10', 'Sealy', 'TX', 'tx', 'Austin County', 'austin-county', 'sealy'),
    ('cm76wpxaz006ivrvg4gamxst1', 'WALLIS', 'TX', 'tx', 'Austin County', 'austin-county', 'wallis'),
    ('cm76wpxaz006lvrvgh2s33c12', 'Bellville', 'TX', 'tx', 'Austin County', 'austin-county', 'bellville'),
    ('cm76wpxaz006ovrvgigry0qsp', 'SAN FELIPE', 'TX', 'tx', 'Austin County', 'austin-county', 'san-felipe'),
    ('cm76wpxaz006rvrvgzy9naxqq', 'SEALY', 'TX', 'tx', 'Austin County', 'austin-county', 'sealy'),
    ('cm76wpxaz006uvrvggxwwkpcy', 'WALLIS', 'TX', 'tx', 'Austin County', 'austin-county', 'wallis'),
    ('cm76wpxaz006xvrvgstxsm7dv', 'SEALY', 'TX', 'tx', 'Austin County', 'austin-county', 'sealy'),
    ('cm76wpxaz0070vrvg64742o91', 'Muleshoe', 'TX', 'tx', 'Bailey County', 'bailey-county', 'muleshoe'),
    ('cm76wpxaz0073vrvgqhnkvnc7', 'MULESHOE', 'TX', 'tx', 'Bailey County', 'bailey-county', 'muleshoe'),
    ('cm76wpxaz0076vrvg568d18zc', 'Muleshoe', 'TX', 'tx', 'Bailey County', 'bailey-county', 'muleshoe'),
    ('cm76wpxaz0079vrvg7efnunxs', 'MULESHOE', 'TX', 'tx', 'Bailey County', 'bailey-county', 'muleshoe'),
    ('cm76wpxaz007cvrvgrponfb3y', 'BANDERA', 'TX', 'tx', 'Bandera County', 'bandera-county', 'bandera'),
    ('cm76wpxaz007fvrvg37iv5dl5', 'BANDERA', 'TX', 'tx', 'Bandera County', 'bandera-county', 'bandera'),
    ('cm76wpxaz007ivrvg1c0tv1ug', 'LAKEHILLS', 'TX', 'tx', 'Bandera County', 'bandera-county', 'lakehills'),
    ('cm76wpxaz007lvrvg6utatpx0', 'Medina', 'TX', 'tx', 'Bandera County', 'bandera-county', 'medina'),
    ('cm76wpxb0007ovrvgsez3548d', 'UTOPIA', 'TX', 'tx', 'Bandera County', 'bandera-county', 'utopia'),
    ('cm76wpxb0007qvrvg9pjbjrha', 'BANDERA', 'TX', 'tx', 'Bandera County', 'bandera-county', 'bandera'),
    ('cm76wpxb0007tvrvgxic15mnx', 'Medina', 'TX', 'tx', 'Bandera County', 'bandera-county', 'medina'),
    ('cm76wpxb0007vvrvgg23ar2c0', 'BASTROP', 'TX', 'tx', 'Bastrop County', 'bastrop-county', 'bastrop'),
    ('cm76wpxb0007yvrvglv98ipbx', 'BASTROP', 'TX', 'tx', 'Bastrop County', 'bastrop-county', 'bastrop'),
    ('cm76wpxb00081vrvg2eow6xut', 'SMITHVILLE', 'TX', 'tx', 'Bastrop County', 'bastrop-county', 'smithville'),
    ('cm76wpxb00084vrvg7jaukvo5', 'CEDAR CREEK', 'TX', 'tx', 'Bastrop County', 'bastrop-county', 'cedar-creek'),
    ('cm76wpxb00087vrvg41qrgwb9', 'ELGIN', 'TX', 'tx', 'Bastrop County', 'bastrop-county', 'elgin'),
    ('cm76wpxb0008avrvg0r39p6mi', 'Bastrop', 'TX', 'tx', 'Bastrop County', 'bastrop-county', 'bastrop'),
    ('cm76wpxb0008dvrvg62u6v2t7', 'BASTROP', 'TX', 'tx', 'Bastrop County', 'bastrop-county', 'bastrop'),
    ('cm76wpxb0008gvrvgae00r0l6', 'BASTROP', 'TX', 'tx', 'Bastrop County', 'bastrop-county', 'bastrop'),
    ('cm76wpxb0008jvrvgjz9vr4ut', 'ELGIN', 'TX', 'tx', 'Bastrop County', 'bastrop-county', 'elgin'),
    ('cm76wpxb0008mvrvgku6k0bd2', 'SMITHVILLE', 'TX', 'tx', 'Bastrop County', 'bastrop-county', 'smithville'),
    ('cm76wpxb0008pvrvgwow38sny', 'BASTROP', 'TX', 'tx', 'Bastrop County', 'bastrop-county', 'bastrop'),
    ('cm76wpxb0008svrvge9c2krnf', 'SEYMOUR', 'TX', 'tx', 'Baylor County', 'baylor-county', 'seymour'),
    ('cm76wpxb0008vvrvg0orhpzso', 'Seymour', 'TX', 'tx', 'Baylor County', 'baylor-county', 'seymour'),
    ('cm76wpxb0008yvrvga6sh0kvx', 'SEYMOUR', 'TX', 'tx', 'Baylor County', 'baylor-county', 'seymour'),
    ('cm76wpxb00091vrvgbj1vmgwh', 'Seymour', 'TX', 'tx', 'Baylor County', 'baylor-county', 'seymour'),
    ('cm76wpxb00094vrvguu6ndf5h', 'BEEVILLE', 'TX', 'tx', 'Bee County', 'bee-county', 'beeville'),
    ('cm76wpxb00097vrvg0d6d4icj', 'BEEVILLE', 'TX', 'tx', 'Bee County', 'bee-county', 'beeville'),
    ('cm76wpxb0009avrvgfapdxw2l', 'BEEVILLE', 'TX', 'tx', 'Bee County', 'bee-county', 'beeville'),
    ('cm76wpxb0009dvrvgjyaio1jd', 'Beevillle', 'TX', 'tx', 'Bee County', 'bee-county', 'beevillle'),
    ('cm76wpxb0009gvrvg5ctc2awk', 'BEEVILLE', 'TX', 'tx', 'Bee County', 'bee-county', 'beeville'),
    ('cm76wpxb0009ivrvg9oascgwu', 'Skidmore', 'TX', 'tx', 'Bee County', 'bee-county', 'skidmore'),
    ('cm76wpxb0009lvrvg838ugd5c', 'BEEVILLE', 'TX', 'tx', 'Bee County', 'bee-county', 'beeville'),
    ('cm76wpxb0009ovrvgfwwy18q1', 'BEEVILLE', 'TX', 'tx', 'Bee County', 'bee-county', 'beeville'),
    ('cm76wpxb0009rvrvgia80m3s2', 'Beeville', 'TX', 'tx', 'Bee County', 'bee-county', 'beeville'),
    ('cm76wpxb0009uvrvgamv8f065', 'KILLEEN', 'TX', 'tx', 'Bell County', 'bell-county', 'killeen'),
    ('cm76wpxb0009xvrvgz6g6r7wc', 'BELTON', 'TX', 'tx', 'Bell County', 'bell-county', 'belton'),
    ('cm76wpxb000a0vrvg23crjhnl', 'TEMPLE', 'TX', 'tx', 'Bell County', 'bell-county', 'temple'),
    ('cm76wpxb000a3vrvgg9lcz3b1', 'KILLEEN', 'TX', 'tx', 'Bell County', 'bell-county', 'killeen'),
    ('cm76wpxb000a6vrvgduyushjn', 'BELTON', 'TX', 'tx', 'Bell County', 'bell-county', 'belton'),
    ('cm76wpxb000a9vrvg5kn17b07', 'BELTON', 'TX', 'tx', 'Bell County', 'bell-county', 'belton'),
    ('cm76wpxb000acvrvgi589v5t4', 'BELTON', 'TX', 'tx', 'Bell County', 'bell-county', 'belton'),
    ('cm76wpxb000afvrvg5kk9zd4k', 'Salado', 'TX', 'tx', 'Bell County', 'bell-county', 'salado'),
    ('cm76wpxb000aivrvgf16uahwf', 'TEMPLE', 'TX', 'tx', 'Bell County', 'bell-county', 'temple'),
    ('cm76wpxb000alvrvgzcm02wgk', 'KILLEEN', 'TX', 'tx', 'Bell County', 'bell-county', 'killeen'),
    ('cm76wpxb000aovrvgrc46t27y', 'BELTON', 'TX', 'tx', 'Bell County', 'bell-county', 'belton'),
    ('cm76wpxb000arvrvgp0jiz0yw', 'BELTON', 'TX', 'tx', 'Bell County', 'bell-county', 'belton'),
    ('cm76wpxb000auvrvg5e2ikqxk', 'Belton', 'TX', 'tx', 'Bell County', 'bell-county', 'belton'),
    ('cm76wpxb000axvrvgxhml07gc', 'BELTON', 'TX', 'tx', 'Bell County', 'bell-county', 'belton'),
    ('cm76wpxb000b0vrvgtsx6uxcr', 'BELTON', 'TX', 'tx', 'Bell County', 'bell-county', 'belton'),
    ('cm76wpxb000b3vrvgd4e4h6ac', 'BELTON', 'TX', 'tx', 'Bell County', 'bell-county', 'belton'),
    ('cm76wpxb000b6vrvg7qbyzq7h', 'HARKER HEIGHTS', 'TX', 'tx', 'Bell County', 'bell-county', 'harker-heights'),
    ('cm76wpxb000b9vrvg76prftos', 'HOLLAND', 'TX', 'tx', 'Bell County', 'bell-county', 'holland'),
    ('cm76wpxb000bcvrvgjevocyxx', 'KILLEEN', 'TX', 'tx', 'Bell County', 'bell-county', 'killeen'),
    ('cm76wpxb000bfvrvgto6nzqf3', 'NOLANVILLE', 'TX', 'tx', 'Bell County', 'bell-county', 'nolanville'),
    ('cm76wpxb000bivrvg8fe8k9m3', 'ROGERS', 'TX', 'tx', 'Bell County', 'bell-county', 'rogers'),
    ('cm76wpxb000blvrvgeqlg2xgr', 'TEMPLE', 'TX', 'tx', 'Bell County', 'bell-county', 'temple'),
    ('cm76wpxb000bovrvgq750zt4c', 'TROY', 'TX', 'tx', 'Bell County', 'bell-county', 'troy'),
    ('cm76wpxb000brvrvgr9hzfa7r', 'LITTLE RIVER', 'TX', 'tx', 'Bell County', 'bell-county', 'little-river'),
    ('cm76wpxb000buvrvgu16sse0m', 'Salado', 'TX', 'tx', 'Bell County', 'bell-county', 'salado'),
    ('cm76wpxb000bxvrvgyxg0tpc5', 'HARKER HEIGHTS', 'TX', 'tx', 'Bell County', 'bell-county', 'harker-heights'),
    ('cm76wpxb000c0vrvg3o1luvy9', 'KILLEEN', 'TX', 'tx', 'Bell County', 'bell-county', 'killeen'),
    ('cm76wpxb000c2vrvgzy0kxgle', 'TEMPLE', 'TX', 'tx', 'Bell County', 'bell-county', 'temple'),
    ('cm76wpxb000c5vrvg79375b9g', 'KILLEEN', 'TX', 'tx', 'Bell County', 'bell-county', 'killeen'),
    ('cm76wpxb000c8vrvgobofvnfs', 'Salado', 'TX', 'tx', 'Bell County', 'bell-county', 'salado'),
    ('cm76wpxb000cbvrvg7gtc27gf', 'KILLEEN', 'TX', 'tx', 'Bell County', 'bell-county', 'killeen'),
    ('cm76wpxb000cevrvgwcfh7nbt', 'San Antonio', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000chvrvgor5btbxv', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000ckvrvgfc4j33l4', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000cnvrvgabo8sya0', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000cqvrvgxazuxv4t', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000ctvrvg7a0z1rck', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000cwvrvgz5f4fhy0', 'Atascosa', 'TX', 'tx', 'Bexar County', 'bexar-county', 'atascosa'),
    ('cm76wpxb000czvrvgapckjvat', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000d2vrvg260lnmuu', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000d5vrvgbb9r0m8p', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000d8vrvgg29z70nf', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000dbvrvgor05os3n', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000devrvg7rcikuiz', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000dhvrvgpu00eecd', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000dkvrvgfxf10fam', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000dnvrvgctls47o7', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb000dqvrvgwpa6hggx', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100dtvrvgoo5n7tmz', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100dwvrvgxu2vghu7', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100dzvrvg70qm11kv', 'China Grove', 'TX', 'tx', 'Bexar County', 'bexar-county', 'china-grove'),
    ('cm76wpxb100e1vrvgpaai6mo6', 'CONVERSE', 'TX', 'tx', 'Bexar County', 'bexar-county', 'converse'),
    ('cm76wpxb100e4vrvg4mzmkezo', 'ELMENDORF', 'TX', 'tx', 'Bexar County', 'bexar-county', 'elmendorf'),
    ('cm76wpxb100e7vrvg7ermgfh2', 'HELOTES', 'TX', 'tx', 'Bexar County', 'bexar-county', 'helotes'),
    ('cm76wpxb100eavrvgq42dvtiy', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100edvrvgkgs7flsq', 'HOLLYWOOD PARK', 'TX', 'tx', 'Bexar County', 'bexar-county', 'hollywood-park'),
    ('cm76wpxb100egvrvgv00ek3xk', 'Kirby', 'TX', 'tx', 'Bexar County', 'bexar-county', 'kirby'),
    ('cm76wpxb100ejvrvgx932lct2', 'LEON VALLEY', 'TX', 'tx', 'Bexar County', 'bexar-county', 'leon-valley'),
    ('cm76wpxb100emvrvgjy3oeww2', 'LIVE OAK', 'TX', 'tx', 'Bexar County', 'bexar-county', 'live-oak'),
    ('cm76wpxb100epvrvgwsmem0k2', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100esvrvgtsldpmzc', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100evvrvgnkliuwge', 'SELMA', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'selma'),
    ('cm76wpxb100eyvrvgxd3i13j9', 'SHAVANO PARK', 'TX', 'tx', 'Bexar County', 'bexar-county', 'shavano-park'),
    ('cm76wpxb100f1vrvgivvp85e5', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100f4vrvgq59t7v2t', 'UNIVERSAL CITY', 'TX', 'tx', 'Bexar County', 'bexar-county', 'universal-city'),
    ('cm76wpxb100f7vrvg8yw6be2u', 'WINDCREST', 'TX', 'tx', 'Bexar County', 'bexar-county', 'windcrest'),
    ('cm76wpxb100favrvgl6aak1mx', 'SOMERSET', 'TX', 'tx', 'Bexar County', 'bexar-county', 'somerset'),
    ('cm76wpxb100fdvrvgnbj0blcx', 'HELOTES', 'TX', 'tx', 'Bexar County', 'bexar-county', 'helotes'),
    ('cm76wpxb100fgvrvgt4hr35ft', 'BOERNE', 'TX', 'tx', 'Bexar County', 'bexar-county', 'boerne'),
    ('cm76wpxb100fjvrvgmko16blt', 'VON ORMY', 'TX', 'tx', 'Bexar County', 'bexar-county', 'von-ormy'),
    ('cm76wpxb100fmvrvgvvdme2fi', 'ELMENDORF', 'TX', 'tx', 'Bexar County', 'bexar-county', 'elmendorf'),
    ('cm76wpxb100fpvrvgbwz73vhl', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100frvrvgzqd45jl8', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100fuvrvgijoehkhi', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100fxvrvg7lwrc8u8', 'San Antonio', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100g0vrvg0vls53g5', 'Shavano Park', 'TX', 'tx', 'Bexar County', 'bexar-county', 'shavano-park'),
    ('cm76wpxb100g3vrvgojnx8hq8', 'HELOTES', 'TX', 'tx', 'Bexar County', 'bexar-county', 'helotes'),
    ('cm76wpxb100g6vrvggoderrpl', 'Universal City', 'TX', 'tx', 'Bexar County', 'bexar-county', 'universal-city'),
    ('cm76wpxb100g9vrvgg5o220fv', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100gcvrvg0i0ub36y', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100gfvrvg1cy6qusk', 'Saint Hedwig', 'TX', 'tx', 'Bexar County', 'bexar-county', 'saint-hedwig'),
    ('cm76wpxb100ghvrvg7mzmajop', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100gkvrvg5bx5c2k3', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100gnvrvgjo891npq', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100gqvrvg7vpbxvpu', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100gtvrvgik4xx7mw', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100gwvrvgywcu60v7', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100gzvrvgj6d6i7zy', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100h2vrvg8vzfbpha', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100h5vrvgue11zeib', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100h8vrvg6epmui47', 'CONVERSE', 'TX', 'tx', 'Bexar County', 'bexar-county', 'converse'),
    ('cm76wpxb100hbvrvgfmqoqu9n', 'SAN ANTONIO', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm76wpxb100hevrvgq0jfv1lz', 'SOMERSET', 'TX', 'tx', 'Bexar County', 'bexar-county', 'somerset'),
    ('cm76wpxb100hhvrvgkveezapt', 'JOHNSON CITY', 'TX', 'tx', 'Blanco County', 'blanco-county', 'johnson-city'),
    ('cm76wpxb100hkvrvg8mc4yq25', 'Johnson City', 'TX', 'tx', 'Blanco County', 'blanco-county', 'johnson-city'),
    ('cm76wpxb100hmvrvg4yr5io5o', 'BLANCO', 'TX', 'tx', 'Blanco County', 'blanco-county', 'blanco'),
    ('cm76wpxb100hpvrvgmprs7xii', 'JOHNSON CITY', 'TX', 'tx', 'Blanco County', 'blanco-county', 'johnson-city'),
    ('cm76wpxb100hsvrvgtd98b2re', 'BLANCO', 'TX', 'tx', 'Blanco County', 'blanco-county', 'blanco'),
    ('cm76wpxb100hvvrvg65zyokqh', 'JOHNSON CITY', 'TX', 'tx', 'Blanco County', 'blanco-county', 'johnson-city'),
    ('cm76wpxb100hyvrvgy0xsf4yt', 'GAIL', 'TX', 'tx', 'Borden County', 'borden-county', 'gail'),
    ('cm76wpxb100i1vrvg826ch7t5', 'MERIDIAN', 'TX', 'tx', 'Bosque County', 'bosque-county', 'meridian'),
    ('cm76wpxb100i4vrvg9uf9wnnn', 'MERIDIAN', 'TX', 'tx', 'Bosque County', 'bosque-county', 'meridian'),
    ('cm76wpxb100i7vrvg6hys9czy', 'Meridian', 'TX', 'tx', 'Bosque County', 'bosque-county', 'meridian'),
    ('cm76wpxb100i9vrvg7ljyn74e', 'CLIFTON', 'TX', 'tx', 'Bosque County', 'bosque-county', 'clifton'),
    ('cm76wpxb100icvrvgov1qt7m3', 'MERIDAN', 'TX', 'tx', 'Bosque County', 'bosque-county', 'meridan'),
    ('cm76wpxb100ifvrvg7wek1mna', 'Valley Mills', 'TX', 'tx', 'Bosque County', 'bosque-county', 'valley-mills'),
    ('cm76wpxb100iivrvgjliai703', 'Kopperl', 'TX', 'tx', 'Bosque County', 'bosque-county', 'kopperl'),
    ('cm76wpxb100ilvrvgwd5o6p31', 'Valley Mills', 'TX', 'tx', 'Bosque County', 'bosque-county', 'valley-mills'),
    ('cm76wpxb100iovrvg6tjyp4pb', 'WHITNEY', 'TX', 'tx', 'Hill County', 'hill-county', 'whitney'),
    ('cm76wpxb100iqvrvgkrv0btso', 'TEXARKANA', 'TX', 'tx', 'Bowie County', 'bowie-county', 'texarkana'),
    ('cm76wpxb100itvrvgaqzdh3qd', 'TEXARKANA', 'TX', 'tx', 'Bowie County', 'bowie-county', 'texarkana'),
    ('cm76wpxb100iwvrvgvs9a5ijb', 'TEXARKANA', 'TX', 'tx', 'Bowie County', 'bowie-county', 'texarkana'),
    ('cm76wpxb100izvrvglhu96635', 'Texarkana', 'TX', 'tx', 'Bowie County', 'bowie-county', 'texarkana'),
    ('cm76wpxb100j2vrvgxlfm842i', 'NEW BOSTON', 'TX', 'tx', 'Bowie County', 'bowie-county', 'new-boston'),
    ('cm76wpxb100j5vrvgj6vyl74o', 'Avery', 'TX', 'tx', 'Bowie County', 'bowie-county', 'avery'),
    ('cm76wpxb100j8vrvgazb144st', 'SIMMS', 'TX', 'tx', 'Bowie County', 'bowie-county', 'simms'),
    ('cm76wpxb100jbvrvg70ik5ymo', 'MAUD', 'TX', 'tx', 'Bowie County', 'bowie-county', 'maud'),
    ('cm76wpxb200jevrvg569st4ef', 'TEXARKANA', 'TX', 'tx', 'Bowie County', 'bowie-county', 'texarkana'),
    ('cm76wpxb200jhvrvgmmpnsk52', 'DE KALB', 'TX', 'tx', 'Bowie County', 'bowie-county', 'de-kalb'),
    ('cm76wpxb200jkvrvg9u4in6yg', 'HOOKS', 'TX', 'tx', 'Bowie County', 'bowie-county', 'hooks'),
    ('cm76wpxb200jnvrvgqxkw18uu', 'Nash', 'TX', 'tx', 'Bowie County', 'bowie-county', 'nash'),
    ('cm76wpxb200jqvrvgylno7g25', 'NEW BOSTON', 'TX', 'tx', 'Bowie County', 'bowie-county', 'new-boston'),
    ('cm76wpxb200jtvrvgm5rpllna', 'TEXARKANA', 'TX', 'tx', 'Bowie County', 'bowie-county', 'texarkana'),
    ('cm76wpxb200jwvrvgq6bx70hb', 'TEXARKANA', 'TX', 'tx', 'Bowie County', 'bowie-county', 'texarkana'),
    ('cm76wpxb200jzvrvgx4u15lja', 'TEXARKANA', 'TX', 'tx', 'Bowie County', 'bowie-county', 'texarkana'),
    ('cm76wpxb200k2vrvgbmnq4zjc', 'TEXARKANA', 'TX', 'tx', 'Bowie County', 'bowie-county', 'texarkana'),
    ('cm76wpxb200k5vrvg612r3lhy', 'TEXARKANA', 'TX', 'tx', 'Bowie County', 'bowie-county', 'texarkana'),
    ('cm76wpxb200k7vrvg7az5lel0', 'Texarkana', 'TX', 'tx', 'Bowie County', 'bowie-county', 'texarkana'),
    ('cm76wpxb200kavrvgnx54yqv5', 'Maud', 'TX', 'tx', 'Bowie County', 'bowie-county', 'maud'),
    ('cm76wpxb200kdvrvgaqqqf33l', 'DeKalb', 'TX', 'tx', 'Bowie County', 'bowie-county', 'dekalb'),
    ('cm76wpxb200kgvrvgdimf8jow', 'Texarkana', 'TX', 'tx', 'Bowie County', 'bowie-county', 'texarkana'),
    ('cm76wpxb200kjvrvg8mkbssin', 'SIMMS', 'TX', 'tx', 'Bowie County', 'bowie-county', 'simms'),
    ('cm76wpxb200kmvrvga17mbfog', 'REDWATER', 'TX', 'tx', 'Bowie County', 'bowie-county', 'redwater'),
    ('cm76wpxb200kpvrvgmjkdnt6i', 'ALVIN', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'alvin'),
    ('cm76wpxb200ksvrvg2laslmor', 'LAKE JACKSON', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'lake-jackson'),
    ('cm76wpxb200kvvrvgu8twlp6k', 'ANGLETON', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'angleton'),
    ('cm76wpxb200kyvrvglzul5dbc', 'Lake Jackson', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'lake-jackson'),
    ('cm76wpxb200l1vrvg91ils93t', 'Manvel', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'manvel'),
    ('cm76wpxb200l3vrvgulgppcvw', 'PEARLAND', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'pearland'),
    ('cm76wpxb200l6vrvgcvvczcbv', 'WEST COLUMBIA', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'west-columbia'),
    ('cm76wpxb200l9vrvgms81mp41', 'ANGLETON', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'angleton'),
    ('cm76wpxb200lcvrvgggyerw8h', 'ALVIN', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'alvin'),
    ('cm76wpxb200lfvrvgm3xkdo77', 'ANGLETON', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'angleton'),
    ('cm76wpxb200livrvg7lhtsant', 'BRAZORIA', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'brazoria'),
    ('cm76wpxb200llvrvga12fx1v7', 'PEARLAND', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'pearland'),
    ('cm76wpxb200lovrvgzqmghh87', 'Clute', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'clute'),
    ('cm76wpxb200lrvrvgzjg30u9a', 'DANBURY', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'danbury'),
    ('cm76wpxb200luvrvgm4chrzcb', 'FREEPORT', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'freeport'),
    ('cm76wpxb200lxvrvgy7046tz9', 'FREEPORT', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'freeport'),
    ('cm76wpxb200m0vrvgvm9blf33', 'LAKE JACKSON', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'lake-jackson'),
    ('cm76wpxb200m3vrvgspggbra5', 'LIVERPOOL', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'liverpool'),
    ('cm76wpxb200m6vrvgl3lhqqsg', 'MANVEL', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'manvel'),
    ('cm76wpxb200m9vrvgkxnuwf9r', 'PEARLAND', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'pearland'),
    ('cm76wpxb200mcvrvg05wrs0f5', 'RICHWOOD', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'richwood'),
    ('cm76wpxb200mfvrvgzujunyne', 'SWEENY', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'sweeny'),
    ('cm76wpxb200mivrvg0c28vbmu', 'WEST COLUMBIA', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'west-columbia'),
    ('cm76wpxb200mlvrvgdr245u7k', 'Iowa Colony', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'iowa-colony'),
    ('cm76wpxb200movrvgd6vuqnw2', 'OYSTER CREEK', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'oyster-creek'),
    ('cm76wpxb200mrvrvgf3g02tx5', 'SURFSIDE BEACH', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'surfside-beach'),
    ('cm76wpxb200muvrvg3a81kn23', 'ANGLETON', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'angleton'),
    ('cm76wpxb200mxvrvg1j2r4t63', 'LAKE JACKSON', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'lake-jackson'),
    ('cm76wpxb200n0vrvgd4u9wga4', 'PEARLAND', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'pearland'),
    ('cm76wpxb200n3vrvgk5tpsu89', 'Angleton', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'angleton'),
    ('cm76wpxb200n6vrvgo1vbm091', 'ALVIN', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'alvin'),
    ('cm76wpxb200n9vrvgm02ivurj', 'ALVIN', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'alvin'),
    ('cm76wpxb200ncvrvgkyfda8rj', 'WEST COLUMBIA', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'west-columbia'),
    ('cm76wpxb200nevrvgcqwj2up4', 'ANGLETON', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'angleton'),
    ('cm76wpxb200nhvrvgurihjrif', 'SWEENY', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'sweeny'),
    ('cm76wpxb200nkvrvgdkhbrb9b', 'Clute', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'clute'),
    ('cm76wpxb200nnvrvgvy4gbyfm', 'Damon', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'damon'),
    ('cm76wpxb200nqvrvg1o301j6e', 'Danbury', 'TX', 'tx', 'Brazoria County', 'brazoria-county', 'danbury'),
    ('cm76wpxb200ntvrvgtolovin4', 'COLLEGE STATION', 'TX', 'tx', 'Brazos County', 'brazos-county', 'college-station'),
    ('cm76wpxb200nwvrvgjcj6tbc3', 'LUFKIN', 'TX', 'tx', 'Angelina County', 'angelina-county', 'lufkin'),
    ('cm76wpxb200nzvrvgzjqmd3o2', 'BRYAN', 'TX', 'tx', 'Brazos County', 'brazos-county', 'bryan'),
    ('cm76wpxb200o2vrvgztorbtk4', 'COLLEGE STATION', 'TX', 'tx', 'Brazos County', 'brazos-county', 'college-station'),
    ('cm76wpxb200o5vrvggnbymthb', 'BRYAN', 'TX', 'tx', 'Brazos County', 'brazos-county', 'bryan'),
    ('cm76wpxb200o8vrvgj3fsjawx', 'COLLEGE STATION', 'TX', 'tx', 'Brazos County', 'brazos-county', 'college-station'),
    ('cm76wpxb200obvrvga8ned9zu', 'BRYAN', 'TX', 'tx', 'Brazos County', 'brazos-county', 'bryan'),
    ('cm76wpxb200oevrvgjuim0n6t', 'BRYAN', 'TX', 'tx', 'Brazos County', 'brazos-county', 'bryan'),
    ('cm76wpxb200ohvrvgoh148au0', 'BRYAN', 'TX', 'tx', 'Brazos County', 'brazos-county', 'bryan'),
    ('cm76wpxb200okvrvg9ktc7uny', 'BRYAN', 'TX', 'tx', 'Brazos County', 'brazos-county', 'bryan'),
    ('cm76wpxb200onvrvgasapd2ct', 'BRYAN', 'TX', 'tx', 'Brazos County', 'brazos-county', 'bryan'),
    ('cm76wpxb200oqvrvgdz6eba7h', 'COLLEGE STATION', 'TX', 'tx', 'Brazos County', 'brazos-county', 'college-station'),
    ('cm76wpxb200otvrvgzowm0u2k', 'BRYAN', 'TX', 'tx', 'Brazos County', 'brazos-county', 'bryan'),
    ('cm76wpxb200owvrvgfg43ugly', 'COLLEGE STATION', 'TX', 'tx', 'Brazos County', 'brazos-county', 'college-station'),
    ('cm76wpxb200ozvrvgz7rqmrqe', 'BRYAN', 'TX', 'tx', 'Brazos County', 'brazos-county', 'bryan'),
    ('cm76wpxb200p2vrvgck3zlm7i', 'COLLEGE STATION', 'TX', 'tx', 'Brazos County', 'brazos-county', 'college-station'),
    ('cm76wpxb200p5vrvgmfam8fpr', 'ALPINE', 'TX', 'tx', 'Brewster County', 'brewster-county', 'alpine'),
    ('cm76wpxb200p8vrvgl059zibi', 'ALPINE', 'TX', 'tx', 'Brewster County', 'brewster-county', 'alpine'),
    ('cm76wpxb200pbvrvgwjislywu', 'ALPINE', 'TX', 'tx', 'Brewster County', 'brewster-county', 'alpine'),
    ('cm76wpxb300pevrvg7f5eufcr', 'ALPINE', 'TX', 'tx', 'Brewster County', 'brewster-county', 'alpine'),
    ('cm76wpxb300phvrvg0ki8z6sp', 'SILVERTON', 'TX', 'tx', 'Briscoe County', 'briscoe-county', 'silverton'),
    ('cm76wpxb300pkvrvg1l62iwqg', 'FALFURRIAS', 'TX', 'tx', 'Brooks County', 'brooks-county', 'falfurrias'),
    ('cm76wpxb300pnvrvgk6w6jn9t', 'FALFURRIAS', 'TX', 'tx', 'Brooks County', 'brooks-county', 'falfurrias'),
    ('cm76wpxb300pqvrvgwdg8g0ej', 'FALFURRIAS', 'TX', 'tx', 'Brooks County', 'brooks-county', 'falfurrias'),
    ('cm76wpxb300ptvrvgxu6hck6e', 'FALFURRIAS', 'TX', 'tx', 'Brooks County', 'brooks-county', 'falfurrias'),
    ('cm76wpxb300pwvrvg6cyrzro5', 'Brownwood', 'TX', 'tx', 'Brown County', 'brown-county', 'brownwood'),
    ('cm76wpxb300pzvrvgqziytki8', 'BROWNWOOD', 'TX', 'tx', 'Brown County', 'brown-county', 'brownwood'),
    ('cm76wpxb300q2vrvg5t25b292', 'Brownwood', 'TX', 'tx', 'Brown County', 'brown-county', 'brownwood'),
    ('cm76wpxb300q5vrvg09r0iwtt', 'Brownwood', 'TX', 'tx', 'Brown County', 'brown-county', 'brownwood'),
    ('cm76wpxb300q8vrvg9u7vl8i0', 'BROWNWOOD', 'TX', 'tx', 'Brown County', 'brown-county', 'brownwood'),
    ('cm76wpxb300qbvrvgh25npiyp', 'Brownwood', 'TX', 'tx', 'Brown County', 'brown-county', 'brownwood'),
    ('cm76wpxb300qevrvgn8t7v20d', 'BROWNWOOD', 'TX', 'tx', 'Brown County', 'brown-county', 'brownwood'),
    ('cm76wpxb300qgvrvg087z58iv', 'BANGS', 'TX', 'tx', 'Brown County', 'brown-county', 'bangs'),
    ('cm76wpxb300qjvrvglkjsp2mc', 'BROWNWOOD', 'TX', 'tx', 'Brown County', 'brown-county', 'brownwood'),
    ('cm76wpxb300qmvrvgt9z1rec4', 'EARLY', 'TX', 'tx', 'Brown County', 'brown-county', 'early'),
    ('cm76wpxb300qpvrvgw57vn7o6', 'BROWNWOOD', 'TX', 'tx', 'Brown County', 'brown-county', 'brownwood'),
    ('cm76wpxb300qsvrvgh30csxok', 'CALDWELL', 'TX', 'tx', 'Burleson County', 'burleson-county', 'caldwell'),
    ('cm76wpxb300qvvrvg1m7drrfn', 'Deanville', 'TX', 'tx', 'Burleson County', 'burleson-county', 'deanville'),
    ('cm76wpxb300qxvrvgm81qlt1h', 'Snook', 'TX', 'tx', 'Burleson County', 'burleson-county', 'snook'),
    ('cm76wpxb300r0vrvgml5vpywp', 'CALDWELL', 'TX', 'tx', 'Burleson County', 'burleson-county', 'caldwell'),
    ('cm76wpxb300r3vrvgudxxg8xv', 'SOMERVILLE', 'TX', 'tx', 'Burleson County', 'burleson-county', 'somerville'),
    ('cm76wpxb300r6vrvg8rpey03t', 'Caldwell', 'TX', 'tx', 'Burleson County', 'burleson-county', 'caldwell'),
    ('cm76wpxb300r9vrvgx60wat1b', 'BRENHAM', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm76wpxb300rcvrvgr3unnvtl', 'CALDWELL', 'TX', 'tx', 'Burleson County', 'burleson-county', 'caldwell'),
    ('cm76wpxb300rfvrvg1lyf3ecs', 'SOMERVILLE', 'TX', 'tx', 'Burleson County', 'burleson-county', 'somerville'),
    ('cm76wpxb300rivrvg2xp1ksh0', 'Snook', 'TX', 'tx', 'Burleson County', 'burleson-county', 'snook'),
    ('cm76wpxb300rkvrvgntmar8ig', 'BURNET', 'TX', 'tx', 'Burnet County', 'burnet-county', 'burnet'),
    ('cm76wpxb300rnvrvg970kj1tq', 'BURNET', 'TX', 'tx', 'Burnet County', 'burnet-county', 'burnet'),
    ('cm76wpxb300rqvrvg8rluh9mc', 'BURNET', 'TX', 'tx', 'Burnet County', 'burnet-county', 'burnet'),
    ('cm76wpxb300rtvrvgj0hl6s87', 'Burnet', 'TX', 'tx', 'Burnet County', 'burnet-county', 'burnet'),
    ('cm76wpxb300rwvrvgmy1h16v8', 'MARBLE FALLS', 'TX', 'tx', 'Burnet County', 'burnet-county', 'marble-falls'),
    ('cm76wpxb300rzvrvgmpmgzmu5', 'MARBLE FALLS', 'TX', 'tx', 'Burnet County', 'burnet-county', 'marble-falls'),
    ('cm76wpxb300s2vrvg6f5p6tgl', 'Marble Falls', 'TX', 'tx', 'Burnet County', 'burnet-county', 'marble-falls'),
    ('cm76wpxb300s4vrvg3b33bfsh', 'BURNET', 'TX', 'tx', 'Burnet County', 'burnet-county', 'burnet'),
    ('cm76wpxb300s7vrvg7m013y9c', 'GRANITE SHOALS', 'TX', 'tx', 'Burnet County', 'burnet-county', 'granite-shoals'),
    ('cm76wpxb300savrvg2scmhkxl', 'MARBLE FALLS', 'TX', 'tx', 'Burnet County', 'burnet-county', 'marble-falls'),
    ('cm76wpxb300sdvrvgz6z1y02h', 'BERTRAM', 'TX', 'tx', 'Burnet County', 'burnet-county', 'bertram'),
    ('cm76wpxb300sgvrvgp35m238r', 'COTTONWOOD SHORES', 'TX', 'tx', 'Burnet County', 'burnet-county', 'cottonwood-shores'),
    ('cm76wpxb300sjvrvg51lvg0mw', 'BURNET', 'TX', 'tx', 'Burnet County', 'burnet-county', 'burnet'),
    ('cm76wpxb300smvrvg1tc994z1', 'MARBLE FALLS', 'TX', 'tx', 'Burnet County', 'burnet-county', 'marble-falls'),
    ('cm76wpxb300spvrvgmfipz310', 'LOCKHART', 'TX', 'tx', 'Caldwell County', 'caldwell-county', 'lockhart'),
    ('cm76wpxb300ssvrvgsc8813d9', 'LOCKHART', 'TX', 'tx', 'Caldwell County', 'caldwell-county', 'lockhart'),
    ('cm76wpxb300svvrvg0j78gcr1', 'Luling', 'TX', 'tx', 'Caldwell County', 'caldwell-county', 'luling'),
    ('cm76wpxb300sxvrvgzznpvfy9', 'MAXWELL', 'TX', 'tx', 'Caldwell County', 'caldwell-county', 'maxwell'),
    ('cm76wpxb300t0vrvgyyqm3xc4', 'Lockhart', 'TX', 'tx', 'Caldwell County', 'caldwell-county', 'lockhart'),
    ('cm76wpxb300t3vrvg0g0npqoi', 'LOCKHART', 'TX', 'tx', 'Caldwell County', 'caldwell-county', 'lockhart'),
    ('cm76wpxb300t6vrvgqvqx39q6', 'LOCKHART', 'TX', 'tx', 'Caldwell County', 'caldwell-county', 'lockhart'),
    ('cm76wpxb300t9vrvgy4qr5shh', 'LULING', 'TX', 'tx', 'Caldwell County', 'caldwell-county', 'luling'),
    ('cm76wpxb300tcvrvgzgf6vofq', 'MARTINDALE', 'TX', 'tx', 'Caldwell County', 'caldwell-county', 'martindale'),
    ('cm76wpxb300tevrvg75wj870p', 'KYLE', 'TX', 'tx', 'Caldwell County', 'caldwell-county', 'kyle'),
    ('cm76wpxb300tgvrvgokziazol', 'Port Lavaca', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'port-lavaca'),
    ('cm76wpxb300tjvrvg33qgb65p', 'PORT LAVACA', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'port-lavaca'),
    ('cm76wpxb300tmvrvg640i8mec', 'Port Lavaca', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'port-lavaca'),
    ('cm76wpxb300tpvrvgbkpiqv2r', 'PORT LAVACA', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'port-lavaca'),
    ('cm76wpxb300trvrvg2nnsf3ug', 'PORT LAVACA', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'port-lavaca'),
    ('cm76wpxb300tuvrvgpsfqx5j2', 'Port Lavaca', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'port-lavaca'),
    ('cm76wpxb300twvrvgnnzn2irm', 'Port Lavaca', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'port-lavaca'),
    ('cm76wpxb300tzvrvgbuaz9j5f', 'Port Lavaca', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'port-lavaca'),
    ('cm76wpxb300u2vrvg9w1j0eb0', 'PORT LAVACA', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'port-lavaca'),
    ('cm76wpxb300u5vrvg4yube9kk', 'POINT COMFORT', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'point-comfort'),
    ('cm76wpxb300u8vrvg7bvhop9t', 'PORT LAVACA', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'port-lavaca'),
    ('cm76wpxb300ubvrvg25p2qpmx', 'SEADRIFT', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'seadrift'),
    ('cm76wpxb300uevrvgj3tk82q4', 'PORT LAVACA', 'TX', 'tx', 'Calhoun County', 'calhoun-county', 'port-lavaca'),
    ('cm76wpxb300uhvrvg7yksouct', 'BAIRD', 'TX', 'tx', 'Callahan County', 'callahan-county', 'baird'),
    ('cm76wpxb300ukvrvgd3lrhxpp', 'BAIRD', 'TX', 'tx', 'Callahan County', 'callahan-county', 'baird'),
    ('cm76wpxb300umvrvgood6flgq', 'Cross Plains', 'TX', 'tx', 'Callahan County', 'callahan-county', 'cross-plains'),
    ('cm76wpxb300upvrvgn369kz57', 'BAIRD', 'TX', 'tx', 'Callahan County', 'callahan-county', 'baird'),
    ('cm76wpxb300usvrvgq50dvek7', 'CLYDE', 'TX', 'tx', 'Callahan County', 'callahan-county', 'clyde'),
    ('cm76wpxb300uvvrvg7uc0tyng', 'CROSS PLAINS', 'TX', 'tx', 'Callahan County', 'callahan-county', 'cross-plains'),
    ('cm76wpxb300uyvrvgn6orcog8', 'Clyde', 'TX', 'tx', 'Callahan County', 'callahan-county', 'clyde'),
    ('cm76wpxb300v1vrvgmebsv22r', 'HARLINGEN', 'TX', 'tx', 'Cameron County', 'cameron-county', 'harlingen'),
    ('cm76wpxb300v4vrvgmfm2jtsc', 'OLMITO', 'TX', 'tx', 'Cameron County', 'cameron-county', 'olmito'),
    ('cm76wpxb400v7vrvgu7jaab5m', 'PORT ISABEL', 'TX', 'tx', 'Cameron County', 'cameron-county', 'port-isabel'),
    ('cm76wpxb400vavrvgayrs1t24', 'BROWNSVILLE', 'TX', 'tx', 'Cameron County', 'cameron-county', 'brownsville'),
    ('cm76wpxb400vdvrvgq6g5vyhr', 'SAN BENITO', 'TX', 'tx', 'Cameron County', 'cameron-county', 'san-benito'),
    ('cm76wpxb400vgvrvglb26dt7a', 'LOS FRESNOS', 'TX', 'tx', 'Cameron County', 'cameron-county', 'los-fresnos'),
    ('cm76wpxb400vjvrvg9fu9yrzm', 'HARLINGEN', 'TX', 'tx', 'Cameron County', 'cameron-county', 'harlingen'),
    ('cm76wpxb400vmvrvg22ro8x9i', 'BROWNSVILLE', 'TX', 'tx', 'Cameron County', 'cameron-county', 'brownsville'),
    ('cm76wpxb400vpvrvga8iylluv', 'BROWNSVILLE', 'TX', 'tx', 'Cameron County', 'cameron-county', 'brownsville'),
    ('cm76wpxb400vsvrvg19d8yzbl', 'South Padre Island', 'TX', 'tx', 'Cameron County', 'cameron-county', 'south-padre-island'),
    ('cm76wpxb400vvvrvg5ai2ten3', 'BROWNSVILLE', 'TX', 'tx', 'Cameron County', 'cameron-county', 'brownsville'),
    ('cm76wpxb400vyvrvgkb618vit', 'COMBES', 'TX', 'tx', 'Cameron County', 'cameron-county', 'combes'),
    ('cm76wpxb400w1vrvgs5cxfc6k', 'HARLINGEN', 'TX', 'tx', 'Cameron County', 'cameron-county', 'harlingen'),
    ('cm76wpxb400w4vrvgwgbp753a', 'LA FERIA', 'TX', 'tx', 'Cameron County', 'cameron-county', 'la-feria'),
    ('cm76wpxb400w7vrvgvtur2xtu', 'LAGUNA VISTA', 'TX', 'tx', 'Cameron County', 'cameron-county', 'laguna-vista'),
    ('cm76wpxb400wavrvghwxupi86', 'LOS FRESNOS', 'TX', 'tx', 'Cameron County', 'cameron-county', 'los-fresnos'),
    ('cm76wpxb400wdvrvgh2e3sb8x', 'PORT ISABEL', 'TX', 'tx', 'Cameron County', 'cameron-county', 'port-isabel'),
    ('cm76wpxb400wgvrvgqiwb090i', 'HARLINGEN', 'TX', 'tx', 'Cameron County', 'cameron-county', 'harlingen'),
    ('cm76wpxb400wjvrvgva7iyk1p', 'RIO HONDO', 'TX', 'tx', 'Cameron County', 'cameron-county', 'rio-hondo'),
    ('cm76wpxb400wmvrvgz55r7pcc', 'SAN BENITO', 'TX', 'tx', 'Cameron County', 'cameron-county', 'san-benito'),
    ('cm76wpxb400wpvrvgpfhu9bhg', 'SANTA ROSA', 'TX', 'tx', 'Cameron County', 'cameron-county', 'santa-rosa'),
    ('cm76wpxb400wsvrvgjvqh9ui5', 'SOUTH PADRE ISLAND', 'TX', 'tx', 'Cameron County', 'cameron-county', 'south-padre-island'),
    ('cm76wpxb400wvvrvgnrjkxh60', 'Indian Lake', 'TX', 'tx', 'Cameron County', 'cameron-county', 'indian-lake'),
    ('cm76wpxb400wyvrvgkp1c88dz', 'RANCHO VIEJO', 'TX', 'tx', 'Cameron County', 'cameron-county', 'rancho-viejo'),
    ('cm76wpxb400x1vrvgk87k2n33', 'HARLINGEN', 'TX', 'tx', 'Cameron County', 'cameron-county', 'harlingen'),
    ('cm76wpxb400x4vrvgkcjbze9t', 'SAN BENITO', 'TX', 'tx', 'Cameron County', 'cameron-county', 'san-benito'),
    ('cm76wpxb400x7vrvgnn2mmz7o', 'BROWNSVILLE', 'TX', 'tx', 'Cameron County', 'cameron-county', 'brownsville'),
    ('cm76wpxb400xavrvgh6v2pvgh', 'HARLINGEN', 'TX', 'tx', 'Cameron County', 'cameron-county', 'harlingen'),
    ('cm76wpxb400xdvrvg48ed64p4', 'South Padre Island', 'TX', 'tx', 'Cameron County', 'cameron-county', 'south-padre-island'),
    ('cm76wpxb400xfvrvgp0ew4my3', 'SAN BENITO', 'TX', 'tx', 'Cameron County', 'cameron-county', 'san-benito'),
    ('cm76wpxb400xivrvgrcz4aoef', 'HARLINGEN', 'TX', 'tx', 'Cameron County', 'cameron-county', 'harlingen'),
    ('cm76wpxb400xlvrvg00u47nrf', 'South Padre Island', 'TX', 'tx', 'Cameron County', 'cameron-county', 'south-padre-island'),
    ('cm76wpxb400xnvrvgzj7cxs2y', 'BROWNSVILLE', 'TX', 'tx', 'Cameron County', 'cameron-county', 'brownsville'),
    ('cm76wpxb400xqvrvghfak4d51', 'BROWNSVILLE', 'TX', 'tx', 'Cameron County', 'cameron-county', 'brownsville'),
    ('cm76wpxb400xsvrvgzbhrtbdv', 'RIO HONDO', 'TX', 'tx', 'Cameron County', 'cameron-county', 'rio-hondo'),
    ('cm76wpxb400xvvrvgjbjh9jdq', 'SAN BENITO', 'TX', 'tx', 'Cameron County', 'cameron-county', 'san-benito'),
    ('cm76wpxb400xyvrvgednr7hus', 'SANTA ROSA', 'TX', 'tx', 'Cameron County', 'cameron-county', 'santa-rosa'),
    ('cm76wpxb400y1vrvg1asxfefn', 'LOS FRESNOS', 'TX', 'tx', 'Cameron County', 'cameron-county', 'los-fresnos'),
    ('cm76wpxb400y4vrvgkxezuigq', 'PORT ISABEL', 'TX', 'tx', 'Cameron County', 'cameron-county', 'port-isabel'),
    ('cm76wpxb400y7vrvgq68t0zzo', 'SANTA MARIA', 'TX', 'tx', 'Cameron County', 'cameron-county', 'santa-maria'),
    ('cm76wpxb400yavrvgss0etez8', 'LA FERIA', 'TX', 'tx', 'Cameron County', 'cameron-county', 'la-feria'),
    ('cm76wpxb400ydvrvg3vzx27k4', 'PITTSBURG', 'TX', 'tx', 'Camp County', 'camp-county', 'pittsburg'),
    ('cm76wpxb400ygvrvgijbneskd', 'PITTSBURG', 'TX', 'tx', 'Camp County', 'camp-county', 'pittsburg'),
    ('cm76wpxb400yjvrvgm4d9ms4z', 'PITTSBURG', 'TX', 'tx', 'Camp County', 'camp-county', 'pittsburg'),
    ('cm76wpxb400ymvrvg4lpq7ruu', 'PITTSBURG', 'TX', 'tx', 'Camp County', 'camp-county', 'pittsburg'),
    ('cm76wpxb400ypvrvgfz09n6ia', 'PANHANDLE', 'TX', 'tx', 'Carson County', 'carson-county', 'panhandle'),
    ('cm76wpxb400ysvrvg3z1qywki', 'PANHANDLE', 'TX', 'tx', 'Carson County', 'carson-county', 'panhandle'),
    ('cm76wpxb400yvvrvgw49irhwc', 'SKELLYTOWN', 'TX', 'tx', 'Carson County', 'carson-county', 'skellytown'),
    ('cm76wpxb400yyvrvgdhevl60x', 'WHITE DEER', 'TX', 'tx', 'Carson County', 'carson-county', 'white-deer'),
    ('cm76wpxb400z0vrvgnutjrmyx', 'Linden', 'TX', 'tx', 'Cass County', 'cass-county', 'linden'),
    ('cm76wpxb400z3vrvgy8b5nrej', 'LINDEN', 'TX', 'tx', 'Cass County', 'cass-county', 'linden'),
    ('cm76wpxb400z6vrvgb57fmu7s', 'Linden', 'TX', 'tx', 'Cass County', 'cass-county', 'linden'),
    ('cm76wpxb400z9vrvg6ihhwdrk', 'Hughes Springs', 'TX', 'tx', 'Cass County', 'cass-county', 'hughes-springs'),
    ('cm76wpxb400zcvrvggtr3tta4', 'QUEEN CITY', 'TX', 'tx', 'Cass County', 'cass-county', 'queen-city'),
    ('cm76wpxb400zfvrvggrzlqv6f', 'Atlanta', 'TX', 'tx', 'Cass County', 'cass-county', 'atlanta'),
    ('cm76wpxb400zivrvgzolaovov', 'LINDEN', 'TX', 'tx', 'Cass County', 'cass-county', 'linden'),
    ('cm76wpxb400zlvrvgnf60lq9n', 'ATLANTA', 'TX', 'tx', 'Cass County', 'cass-county', 'atlanta'),
    ('cm76wpxb400zovrvg45sy7n41', 'Bloomburg', 'TX', 'tx', 'Cass County', 'cass-county', 'bloomburg'),
    ('cm76wpxb400zrvrvg138cbxf3', 'HUGHES SPRINGS', 'TX', 'tx', 'Cass County', 'cass-county', 'hughes-springs'),
    ('cm76wpxb400zuvrvg962i4vwt', 'LINDEN', 'TX', 'tx', 'Cass County', 'cass-county', 'linden'),
    ('cm76wpxb400zxvrvgmjsvhwyq', 'QUEEN CITY', 'TX', 'tx', 'Cass County', 'cass-county', 'queen-city'),
    ('cm76wpxb40100vrvggjpvofwi', 'ATLANTA', 'TX', 'tx', 'Cass County', 'cass-county', 'atlanta'),
    ('cm76wpxb40102vrvgni5msacc', 'McLeod', 'TX', 'tx', 'Cass County', 'cass-county', 'mcleod'),
    ('cm76wpxb40105vrvgghbk5ahn', 'Hughes Springs', 'TX', 'tx', 'Cass County', 'cass-county', 'hughes-springs'),
    ('cm76wpxb40108vrvgf49kh1zq', 'Linden', 'TX', 'tx', 'Cass County', 'cass-county', 'linden'),
    ('cm76wpxb4010bvrvg1f0nxawn', 'Atlanta', 'TX', 'tx', 'Cass County', 'cass-county', 'atlanta'),
    ('cm76wpxb4010evrvgtq87snqd', 'Queen CIty', 'TX', 'tx', 'Cass County', 'cass-county', 'queen-city'),
    ('cm76wpxb4010hvrvgwujtqpa1', 'DIMMITT', 'TX', 'tx', 'Castro County', 'castro-county', 'dimmitt'),
    ('cm76wpxb4010kvrvg3a3zvlko', 'DIMMIT', 'TX', 'tx', 'Castro County', 'castro-county', 'dimmit'),
    ('cm76wpxb4010nvrvgectvecg7', 'DIMMITT', 'TX', 'tx', 'Castro County', 'castro-county', 'dimmitt'),
    ('cm76wpxb4010qvrvg2q8y9fxp', 'Dimmitt', 'TX', 'tx', 'Castro County', 'castro-county', 'dimmitt'),
    ('cm76wpxb4010tvrvghah5ktu2', 'ANAHUAC', 'TX', 'tx', 'Chambers County', 'chambers-county', 'anahuac'),
    ('cm76wpxb4010wvrvgvhxlssa8', 'Anahuac', 'TX', 'tx', 'Chambers County', 'chambers-county', 'anahuac'),
    ('cm76wpxb4010zvrvgi09lbyn2', 'ANAHUAC', 'TX', 'tx', 'Chambers County', 'chambers-county', 'anahuac'),
    ('cm76wpxb40112vrvg1o8fgi6j', 'ANAHUAC', 'TX', 'tx', 'Chambers County', 'chambers-county', 'anahuac'),
    ('cm76wpxb40115vrvgpede6rac', 'MONT BELVIEU', 'TX', 'tx', 'Chambers County', 'chambers-county', 'mont-belvieu'),
    ('cm76wpxb40118vrvgb8a9l6p1', 'Anahuac', 'TX', 'tx', 'Chambers County', 'chambers-county', 'anahuac'),
    ('cm76wpxb5011bvrvgm052h04w', 'BAYTOWN', 'TX', 'tx', 'Chambers County', 'chambers-county', 'baytown'),
    ('cm76wpxb5011evrvgpx39gdoo', 'Anahuac', 'TX', 'tx', 'Chambers County', 'chambers-county', 'anahuac'),
    ('cm76wpxb5011hvrvgx227pffl', 'ANAHUAC', 'TX', 'tx', 'Chambers County', 'chambers-county', 'anahuac'),
    ('cm76wpxb5011kvrvgc0pd7bip', 'MONT BELVIEU', 'TX', 'tx', 'Chambers County', 'chambers-county', 'mont-belvieu'),
    ('cm76wpxb5011nvrvgfgwsfb8q', 'MONT BELVIEU', 'TX', 'tx', 'Chambers County', 'chambers-county', 'mont-belvieu'),
    ('cm76wpxb5011qvrvgidmgt4a6', 'Rusk', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'rusk'),
    ('cm76wpxb5011tvrvge372hzxs', 'RUSK', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'rusk'),
    ('cm76wpxb5011wvrvgihc5yqe4', 'Jacksonville', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'jacksonville'),
    ('cm76wpxb5011yvrvgkcl4y2pe', 'RUSK', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'rusk'),
    ('cm76wpxb50121vrvgd8kqzulr', 'JACKSONVILLE', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'jacksonville'),
    ('cm76wpxb50124vrvgr0pehn7k', 'New Summerfield', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'new-summerfield'),
    ('cm76wpxb50127vrvgnkh4ayvb', 'RUSK', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'rusk'),
    ('cm76wpxb5012avrvg06dfhi15', 'Alto', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'alto'),
    ('cm76wpxb5012dvrvgv5ahgvwe', 'JACKSONVILLE', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'jacksonville'),
    ('cm76wpxb5012gvrvg7f22q9q3', 'NEW SUMMERFIELD', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'new-summerfield'),
    ('cm76wpxb5012jvrvg2l0zszbj', 'RUSK', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'rusk'),
    ('cm76wpxb5012mvrvghwv5rhk3', 'Wells', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'wells'),
    ('cm76wpxb5012pvrvgfqril1pz', 'CUNEY', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'cuney'),
    ('cm76wpxb5012svrvgv5ob3myx', 'JACKSONVILLE', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'jacksonville'),
    ('cm76wpxb5012vvrvg32w3ptsp', 'JACKSONVILLE', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'jacksonville'),
    ('cm76wpxb5012yvrvgohpcncsd', 'Bullard', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'bullard'),
    ('cm76wpxb50131vrvg2gf1456e', 'CHILDRESS', 'TX', 'tx', 'Childress County', 'childress-county', 'childress'),
    ('cm76wpxb50134vrvgxv1o2o75', 'CHILDRESS', 'TX', 'tx', 'Childress County', 'childress-county', 'childress'),
    ('cm76wpxb50137vrvg1oydkssq', 'Wellington', 'TX', 'tx', 'Collingsworth County', 'collingsworth-county', 'wellington'),
    ('cm76wpxb5013avrvga9hxpgxr', 'CHILDRESS', 'TX', 'tx', 'Childress County', 'childress-county', 'childress'),
    ('cm76wpxb5013dvrvgr2aa5v7m', 'HENRIETTA', 'TX', 'tx', 'Clay County', 'clay-county', 'henrietta'),
    ('cm76wpxb5013gvrvg3nh3r70d', 'HENRIETTA', 'TX', 'tx', 'Clay County', 'clay-county', 'henrietta'),
    ('cm76wpxb5013jvrvgbotbyjqk', 'Henrietta', 'TX', 'tx', 'Clay County', 'clay-county', 'henrietta'),
    ('cm76wpxb5013mvrvg0ywfzx9d', 'Morton', 'TX', 'tx', 'Cochran County', 'cochran-county', 'morton'),
    ('cm76wpxb5013pvrvgqatygku6', 'MORTON', 'TX', 'tx', 'Cochran County', 'cochran-county', 'morton'),
    ('cm76wpxb5013svrvgrw6rje7g', 'MORTON', 'TX', 'tx', 'Cochran County', 'cochran-county', 'morton'),
    ('cm76wpxb5013vvrvgk4jicfgn', 'Whiteface', 'TX', 'tx', 'Cochran County', 'cochran-county', 'whiteface'),
    ('cm76wpxb5013yvrvg9v298y7k', 'ROBERT LEE', 'TX', 'tx', 'Coke County', 'coke-county', 'robert-lee'),
    ('cm76wpxb50141vrvgf2g7qla3', 'Bronte', 'TX', 'tx', 'Coke County', 'coke-county', 'bronte'),
    ('cm76wpxb50144vrvg63raj0xe', 'COLEMAN', 'TX', 'tx', 'Coleman County', 'coleman-county', 'coleman'),
    ('cm76wpxb50147vrvgqoqo15lq', 'COLEMAN', 'TX', 'tx', 'Coleman County', 'coleman-county', 'coleman'),
    ('cm76wpxb5014avrvgfsxx0xya', 'COLEMAN', 'TX', 'tx', 'Coleman County', 'coleman-county', 'coleman'),
    ('cm76wpxb5014dvrvgdt02el77', 'COLEMAN', 'TX', 'tx', 'Coleman County', 'coleman-county', 'coleman'),
    ('cm76wpxb5014gvrvg2gic307z', 'SANTA ANNA', 'TX', 'tx', 'Coleman County', 'coleman-county', 'santa-anna'),
    ('cm76wpxb5014jvrvg1x1umxyt', 'COLEMAN', 'TX', 'tx', 'Coleman County', 'coleman-county', 'coleman'),
    ('cm76wpxb5014lvrvg4aexk7uk', 'PLANO', 'TX', 'tx', 'Collin County', 'collin-county', 'plano'),
    ('cm76wpxb5014ovrvga0xnbrn3', 'McKinney', 'TX', 'tx', 'Collin County', 'collin-county', 'mckinney'),
    ('cm76wpxb5014rvrvgh8n7dpmi', 'MCKINNEY', 'TX', 'tx', 'Collin County', 'collin-county', 'mckinney'),
    ('cm76wpxb5014uvrvgc6n4bwey', 'MCKINNEY', 'TX', 'tx', 'Collin County', 'collin-county', 'mckinney'),
    ('cm76wpxb5014xvrvgh8b0e9ug', 'Lavon', 'TX', 'tx', 'Collin County', 'collin-county', 'lavon'),
    ('cm76wpxb50150vrvg5t34foo0', 'Plano', 'TX', 'tx', 'Collin County', 'collin-county', 'plano'),
    ('cm76wpxb50153vrvg4v48ghjq', 'FRISCO', 'TX', 'tx', 'Collin County', 'collin-county', 'frisco'),
    ('cm76wpxb50156vrvgysg0h4ad', 'MCKINNEY', 'TX', 'tx', 'Collin County', 'collin-county', 'mckinney'),
    ('cm76wpxb50159vrvg5nnacx33', 'MCKINNEY', 'TX', 'tx', 'Collin County', 'collin-county', 'mckinney'),
    ('cm76wpxb5015cvrvgkiqhlb3r', 'WYLIE', 'TX', 'tx', 'Collin County', 'collin-county', 'wylie'),
    ('cm76wpxb5015fvrvgj5wd68vu', 'ALLEN', 'TX', 'tx', 'Collin County', 'collin-county', 'allen'),
    ('cm76wpxb5015ivrvgjgf0zjjq', 'ANNA', 'TX', 'tx', 'Collin County', 'collin-county', 'anna'),
    ('cm76wpxb5015lvrvggp800ric', 'CELINA', 'TX', 'tx', 'Collin County', 'collin-county', 'celina'),
    ('cm76wpxb5015ovrvg68qx48e0', 'FAIRVIEW', 'TX', 'tx', 'Collin County', 'collin-county', 'fairview'),
    ('cm76wpxb5015rvrvgwvy1j7mg', 'FARMERSVILLE', 'TX', 'tx', 'Collin County', 'collin-county', 'farmersville'),
    ('cm76wpxb5015uvrvgedgyrorx', 'FRISCO', 'TX', 'tx', 'Collin County', 'collin-county', 'frisco'),
    ('cm76wpxb5015xvrvgxjdldmzx', 'JOSEPHINE', 'TX', 'tx', 'Collin County', 'collin-county', 'josephine'),
    ('cm76wpxb50160vrvgqq1gf71o', 'LAVON', 'TX', 'tx', 'Collin County', 'collin-county', 'lavon'),
    ('cm76wpxb50163vrvgibxb4ni5', 'MCKINNEY', 'TX', 'tx', 'Collin County', 'collin-county', 'mckinney'),
    ('cm76wpxb50166vrvgggvs5pul', 'MELISSA', 'TX', 'tx', 'Collin County', 'collin-county', 'melissa'),
    ('cm76wpxb50169vrvgu3ui696m', 'MURPHY', 'TX', 'tx', 'Collin County', 'collin-county', 'murphy'),
    ('cm76wpxb5016cvrvgem74zbcm', 'ALLEN', 'TX', 'tx', 'Collin County', 'collin-county', 'allen'),
    ('cm76wpxb5016fvrvg5wx5jubc', 'PLANO', 'TX', 'tx', 'Collin County', 'collin-county', 'plano'),
    ('cm76wpxb5016ivrvglizd86i9', 'PRINCETON', 'TX', 'tx', 'Collin County', 'collin-county', 'princeton'),
    ('cm76wpxb5016lvrvgkcev87bz', 'PROSPER', 'TX', 'tx', 'Collin County', 'collin-county', 'prosper'),
    ('cm76wpxb5016ovrvg30sgt9hy', 'WYLIE', 'TX', 'tx', 'Collin County', 'collin-county', 'wylie'),
    ('cm76wpxb5016rvrvg126txnku', 'ALLEN', 'TX', 'tx', 'Collin County', 'collin-county', 'allen'),
    ('cm76wpxb5016uvrvg4ait0li6', 'Fairview', 'TX', 'tx', 'Collin County', 'collin-county', 'fairview'),
    ('cm76wpxb5016xvrvgvrksgrap', 'Celina', 'TX', 'tx', 'Collin County', 'collin-county', 'celina'),
    ('cm76wpxb50170vrvglq2mqqu5', 'FRISCO', 'TX', 'tx', 'Collin County', 'collin-county', 'frisco'),
    ('cm76wpxb50173vrvg3t4bvrjz', 'MCKINNEY', 'TX', 'tx', 'Collin County', 'collin-county', 'mckinney'),
    ('cm76wpxb50176vrvg9svzxjn1', 'Melissa', 'TX', 'tx', 'Collin County', 'collin-county', 'melissa'),
    ('cm76wpxb60179vrvgvvkgc2pk', 'PLANO', 'TX', 'tx', 'Collin County', 'collin-county', 'plano'),
    ('cm76wpxb6017cvrvgyvc2lcf8', 'Prosper', 'TX', 'tx', 'Collin County', 'collin-county', 'prosper'),
    ('cm76wpxb6017fvrvg4mkj6n29', 'McKinney', 'TX', 'tx', 'Collin County', 'collin-county', 'mckinney'),
    ('cm76wpxb6017ivrvgvdvmmsia', 'Prosper', 'TX', 'tx', 'Collin County', 'collin-county', 'prosper'),
    ('cm76wpxb6017lvrvgnfg70kd5', 'Farmersville', 'TX', 'tx', 'Collin County', 'collin-county', 'farmersville'),
    ('cm76wpxb6017ovrvgdq3nfrn6', 'MELISSA', 'TX', 'tx', 'Collin County', 'collin-county', 'melissa'),
    ('cm76wpxb6017rvrvgisp0wkpo', 'CELINA', 'TX', 'tx', 'Collin County', 'collin-county', 'celina'),
    ('cm76wpxb6017uvrvg1hh7jkyn', 'Anna', 'TX', 'tx', 'Collin County', 'collin-county', 'anna'),
    ('cm76wpxb6017xvrvg9yjfvqtn', 'Nevada', 'TX', 'tx', 'Collin County', 'collin-county', 'nevada'),
    ('cm76wpxb60180vrvgy9cjl9ld', 'WELLINGTON', 'TX', 'tx', 'Collingsworth County', 'collingsworth-county', 'wellington'),
    ('cm76wpxb60183vrvgpfjxlyyi', 'WELLINGTON', 'TX', 'tx', 'Collingsworth County', 'collingsworth-county', 'wellington'),
    ('cm76wpxb60186vrvgtysk0mzg', 'COLUMBUS', 'TX', 'tx', 'Colorado County', 'colorado-county', 'columbus'),
    ('cm76wpxb60189vrvgr3vkvs6h', 'Columbus', 'TX', 'tx', 'Colorado County', 'colorado-county', 'columbus'),
    ('cm76wpxb6018bvrvgovrwqvj1', 'WEIMAR', 'TX', 'tx', 'Colorado County', 'colorado-county', 'weimar'),
    ('cm76wpxb6018evrvgddmvn6bd', 'CAT SPRING', 'TX', 'tx', 'Colorado County', 'colorado-county', 'cat-spring'),
    ('cm76wpxb6018hvrvgoco4upo6', 'EAGLE LAKE', 'TX', 'tx', 'Colorado County', 'colorado-county', 'eagle-lake'),
    ('cm76wpxb6018kvrvggtg3ph0p', 'COLUMBUS', 'TX', 'tx', 'Colorado County', 'colorado-county', 'columbus'),
    ('cm76wpxb6018mvrvgytqbz6kn', 'COLUMBUS', 'TX', 'tx', 'Colorado County', 'colorado-county', 'columbus'),
    ('cm76wpxb6018pvrvgiith6rk2', 'EAGLE LAKE', 'TX', 'tx', 'Colorado County', 'colorado-county', 'eagle-lake'),
    ('cm76wpxb6018svrvgxq23of8w', 'WEIMAR', 'TX', 'tx', 'Colorado County', 'colorado-county', 'weimar'),
    ('cm76wpxb6018vvrvgqc4vajl4', 'Columbus', 'TX', 'tx', 'Colorado County', 'colorado-county', 'columbus'),
    ('cm76wpxb6018yvrvgs8a511k5', 'NEW BRAUNFELS', 'TX', 'tx', 'Comal County', 'comal-county', 'new-braunfels'),
    ('cm76wpxb60191vrvgc899bafd', 'NEW BRAUNFELS', 'TX', 'tx', 'Comal County', 'comal-county', 'new-braunfels'),
    ('cm76wpxb60194vrvg8ho0e3l4', 'BULVERDE', 'TX', 'tx', 'Comal County', 'comal-county', 'bulverde'),
    ('cm76wpxb60197vrvgcwgxgr3s', 'NEW BRAUNFELS', 'TX', 'tx', 'Comal County', 'comal-county', 'new-braunfels'),
    ('cm76wpxb6019avrvgag981a0j', 'CANYON LAKE', 'TX', 'tx', 'Comal County', 'comal-county', 'canyon-lake'),
    ('cm76wpxb6019dvrvgrl2nxh5i', 'NEW BRAUNFELS', 'TX', 'tx', 'Comal County', 'comal-county', 'new-braunfels'),
    ('cm76wpxb6019gvrvgf57z7q5x', 'NEW BRAUNFELS', 'TX', 'tx', 'Comal County', 'comal-county', 'new-braunfels'),
    ('cm76wpxb6019jvrvgwp5vocil', 'GARDEN RIDGE', 'TX', 'tx', 'Comal County', 'comal-county', 'garden-ridge'),
    ('cm76wpxb6019mvrvgpm0uv1t3', 'NEW BRAUNFELS', 'TX', 'tx', 'Comal County', 'comal-county', 'new-braunfels'),
    ('cm76wpxb6019pvrvgx44mwy7p', 'BULVERDE', 'TX', 'tx', 'Comal County', 'comal-county', 'bulverde'),
    ('cm76wpxb6019svrvggw6y7aoy', 'NEW BRAUNFELS', 'TX', 'tx', 'Comal County', 'comal-county', 'new-braunfels'),
    ('cm76wpxb6019vvrvga9ariq7f', 'COMANCHE', 'TX', 'tx', 'Comanche County', 'comanche-county', 'comanche'),
    ('cm76wpxb6019yvrvgwzqlx7lt', 'Comanche', 'TX', 'tx', 'Comanche County', 'comanche-county', 'comanche'),
    ('cm76wpxb601a1vrvgj1uuvusv', 'COMANCHE', 'TX', 'tx', 'Comanche County', 'comanche-county', 'comanche'),
    ('cm76wpxb601a4vrvgkos4booa', 'PAINT ROCK', 'TX', 'tx', 'Concho County', 'concho-county', 'paint-rock'),
    ('cm76wpxb601a7vrvgafaz2cbg', 'EDEN', 'TX', 'tx', 'Concho County', 'concho-county', 'eden'),
    ('cm76wpxb601aavrvgt4u8xwsp', 'Gainesville', 'TX', 'tx', 'Cooke County', 'cooke-county', 'gainesville'),
    ('cm76wpxb601advrvgahnxk5ro', 'GAINESVILLE', 'TX', 'tx', 'Cooke County', 'cooke-county', 'gainesville'),
    ('cm76wpxb601agvrvgdbz67w48', 'GAINESVILLE', 'TX', 'tx', 'Cooke County', 'cooke-county', 'gainesville'),
    ('cm76wpxb601ajvrvg2rxgxvl2', 'Gainsville', 'TX', 'tx', 'Cooke County', 'cooke-county', 'gainsville'),
    ('cm76wpxb601amvrvgs12mqrmy', 'GAINESVILLE', 'TX', 'tx', 'Cooke County', 'cooke-county', 'gainesville'),
    ('cm76wpxb601apvrvg9f7tyfh2', 'GAINESVILLE', 'TX', 'tx', 'Cooke County', 'cooke-county', 'gainesville'),
    ('cm76wpxb601asvrvgc0rduag1', 'LINDSAY', 'TX', 'tx', 'Cooke County', 'cooke-county', 'lindsay'),
    ('cm76wpxb601avvrvgxkjc2v41', 'MUENSTER', 'TX', 'tx', 'Cooke County', 'cooke-county', 'muenster'),
    ('cm76wpxb601ayvrvg6u63sobc', 'VALLEY VIEW', 'TX', 'tx', 'Cooke County', 'cooke-county', 'valley-view'),
    ('cm76wpxb601b1vrvg092zvjmi', 'GAINESVILLE', 'TX', 'tx', 'Cooke County', 'cooke-county', 'gainesville'),
    ('cm76wpxb601b4vrvg0i59d8jg', 'GAINESVILLE', 'TX', 'tx', 'Cooke County', 'cooke-county', 'gainesville'),
    ('cm76wpxb601b7vrvgxwj94yka', 'GAINESVILLE', 'TX', 'tx', 'Cooke County', 'cooke-county', 'gainesville'),
    ('cm76wpxb601bavrvged1g0xnh', 'GATESVILLE', 'TX', 'tx', 'Coryell County', 'coryell-county', 'gatesville'),
    ('cm76wpxb601bdvrvg2ict1p76', 'COPPERAS COVE', 'TX', 'tx', 'Coryell County', 'coryell-county', 'copperas-cove'),
    ('cm76wpxb601bgvrvgwk0664so', 'Copperas Cove', 'TX', 'tx', 'Coryell County', 'coryell-county', 'copperas-cove'),
    ('cm76wpxb601bjvrvgee5zuoa6', 'GATESVILLE', 'TX', 'tx', 'Coryell County', 'coryell-county', 'gatesville'),
    ('cm76wpxb601bmvrvglhervwdd', 'GATESVILLE', 'TX', 'tx', 'Coryell County', 'coryell-county', 'gatesville'),
    ('cm76wpxb601bpvrvghusw6g6a', 'GATESVILLE', 'TX', 'tx', 'Coryell County', 'coryell-county', 'gatesville'),
    ('cm76wpxb601bsvrvgq9c2acnj', 'COPPERAS COVE', 'TX', 'tx', 'Coryell County', 'coryell-county', 'copperas-cove'),
    ('cm76wpxb601bvvrvgxvysl5a2', 'GATESVILLE', 'TX', 'tx', 'Coryell County', 'coryell-county', 'gatesville'),
    ('cm76wpxb601byvrvgdomthzoe', 'COPPERAS COVE', 'TX', 'tx', 'Coryell County', 'coryell-county', 'copperas-cove'),
    ('cm76wpxb601c1vrvg92h2znin', 'COPPERAS COVE', 'TX', 'tx', 'Coryell County', 'coryell-county', 'copperas-cove'),
    ('cm76wpxb601c4vrvgw0i8pjrs', 'Gatesville', 'TX', 'tx', 'Coryell County', 'coryell-county', 'gatesville'),
    ('cm76wpxb601c7vrvgow6oyt53', 'PADUCAH', 'TX', 'tx', 'Cottle County', 'cottle-county', 'paducah'),
    ('cm76wpxb601cavrvgmsurnyqt', 'PADUCAH', 'TX', 'tx', 'Cottle County', 'cottle-county', 'paducah'),
    ('cm76wpxb601cdvrvg2cwsn3vs', 'Crane', 'TX', 'tx', 'Crane County', 'crane-county', 'crane'),
    ('cm76wpxb601cgvrvgk18syru2', 'CRANE', 'TX', 'tx', 'Crane County', 'crane-county', 'crane'),
    ('cm76wpxb601cjvrvgjs78glbg', 'CRANE', 'TX', 'tx', 'Crane County', 'crane-county', 'crane'),
    ('cm76wpxb601clvrvgrugrcp99', 'CRANE', 'TX', 'tx', 'Crane County', 'crane-county', 'crane'),
    ('cm76wpxb601covrvgimv8ssm8', 'OZONA', 'TX', 'tx', 'Crockett County', 'crockett-county', 'ozona'),
    ('cm76wpxb601crvrvgge4id77l', 'OZONA', 'TX', 'tx', 'Crockett County', 'crockett-county', 'ozona'),
    ('cm76wpxb601ctvrvg1quqkpgb', 'FT. STOCKTON', 'TX', 'tx', 'Pecos County', 'pecos-county', 'ft-stockton'),
    ('cm76wpxb601cwvrvg0hrpbw5h', 'CROSBYTON', 'TX', 'tx', 'Crosby County', 'crosby-county', 'crosbyton'),
    ('cm76wpxb701czvrvgq57vkzvr', 'CROSBYTON', 'TX', 'tx', 'Crosby County', 'crosby-county', 'crosbyton'),
    ('cm76wpxb701d2vrvg4543v9rq', 'CROSBYTON', 'TX', 'tx', 'Crosby County', 'crosby-county', 'crosbyton'),
    ('cm76wpxb701d5vrvgc6uqql66', 'SPUR', 'TX', 'tx', 'Dickens County', 'dickens-county', 'spur'),
    ('cm76wpxb701d8vrvgru1mp8pr', 'VAN HORN', 'TX', 'tx', 'Culberson County', 'culberson-county', 'van-horn'),
    ('cm76wpxb701dbvrvgbmviksm8', 'VAN HORN', 'TX', 'tx', 'Culberson County', 'culberson-county', 'van-horn'),
    ('cm76wpxb701devrvgrl41eodq', 'VAN HORN', 'TX', 'tx', 'Culberson County', 'culberson-county', 'van-horn'),
    ('cm76wpxb701dgvrvge6dv36qa', 'Van Horn', 'TX', 'tx', 'Culberson County', 'culberson-county', 'van-horn'),
    ('cm76wpxb701djvrvgltrkao8d', 'DALHART', 'TX', 'tx', 'Dallam County', 'dallam-county', 'dalhart'),
    ('cm76wpxb701dmvrvgfr78d0as', 'Dalhart', 'TX', 'tx', 'Dallam County', 'dallam-county', 'dalhart'),
    ('cm76wpxb701dpvrvgpqb0jqw8', 'DALHART', 'TX', 'tx', 'Dallam County', 'dallam-county', 'dalhart'),
    ('cm76wpxb701drvrvg1aoub3du', 'DALHART', 'TX', 'tx', 'Dallam County', 'dallam-county', 'dalhart'),
    ('cm76wpxb701duvrvg8o6fsaey', 'TEXLINE', 'TX', 'tx', 'Dallam County', 'dallam-county', 'texline'),
    ('cm76wpxb701dxvrvgxzq3mvxp', 'DALHART', 'TX', 'tx', 'Dallam County', 'dallam-county', 'dalhart'),
    ('cm76wpxb701e0vrvgq2moogrn', 'Dalhart', 'TX', 'tx', 'Dallam County', 'dallam-county', 'dalhart'),
    ('cm76wpxb701e2vrvgkz3hjvlo', 'PLANO', 'TX', 'tx', 'Collin County', 'collin-county', 'plano'),
    ('cm76wpxb701e5vrvg22wfsmwn', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701e8vrvgz963vdk2', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701ebvrvgj2rdpfl8', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701eevrvgi4sv18sm', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701ehvrvgmxpafldh', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701ekvrvg6wfteydw', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701envrvgm6npuh3y', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701eqvrvgth5rndl6', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701etvrvgr4azhnam', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701ewvrvgrijl2g6t', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701ezvrvg4x70r9o5', 'Dallas', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701f2vrvgyb7owt3e', 'Irving', 'TX', 'tx', 'Dallas County', 'dallas-county', 'irving'),
    ('cm76wpxb701f4vrvgmvk3c9te', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701f7vrvgbmazq4u2', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701favrvgzihv4anb', 'Mesquite', 'TX', 'tx', 'Dallas County', 'dallas-county', 'mesquite'),
    ('cm76wpxb701fdvrvg0e3l3djp', 'Dallas', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701fgvrvg7k0rk5si', 'Grand Prairie', 'TX', 'tx', 'Dallas County', 'dallas-county', 'grand-prairie'),
    ('cm76wpxb701fjvrvgai2tfxw1', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701fmvrvgihppxg7x', 'DESOTO', 'TX', 'tx', 'Dallas County', 'dallas-county', 'desoto'),
    ('cm76wpxb701fpvrvgb21qtm6x', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701fsvrvgjpiv64kf', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701fvvrvg42aav7n9', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701fyvrvg7kng7sa2', 'ADDISON', 'TX', 'tx', 'Dallas County', 'dallas-county', 'addison'),
    ('cm76wpxb701g1vrvgk4snwa6g', 'BALCH SPRINGS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'balch-springs'),
    ('cm76wpxb701g4vrvgu6xtzang', 'CARROLLTON', 'TX', 'tx', 'Dallas County', 'dallas-county', 'carrollton'),
    ('cm76wpxb701g7vrvgjx37987l', 'CEDAR HILL', 'TX', 'tx', 'Dallas County', 'dallas-county', 'cedar-hill'),
    ('cm76wpxb701gavrvgemnx92j5', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701gdvrvg5d5n4494', 'COPPELL', 'TX', 'tx', 'Dallas County', 'dallas-county', 'coppell'),
    ('cm76wpxb701ggvrvgmu50aa9n', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701gjvrvg3je78n9e', 'DESOTO', 'TX', 'tx', 'Dallas County', 'dallas-county', 'desoto'),
    ('cm76wpxb701gmvrvgh8fu67ig', 'DUNCANVILLE', 'TX', 'tx', 'Dallas County', 'dallas-county', 'duncanville'),
    ('cm76wpxb701gpvrvg749oqttc', 'FARMERS BRANCH', 'TX', 'tx', 'Dallas County', 'dallas-county', 'farmers-branch'),
    ('cm76wpxb701gsvrvg2y0vghdp', 'GARLAND', 'TX', 'tx', 'Dallas County', 'dallas-county', 'garland'),
    ('cm76wpxb701gvvrvgjowg7wat', 'GRAND PRAIRIE', 'TX', 'tx', 'Dallas County', 'dallas-county', 'grand-prairie'),
    ('cm76wpxb701gyvrvgzqfhv8vj', 'HIGHLAND PARK', 'TX', 'tx', 'Dallas County', 'dallas-county', 'highland-park'),
    ('cm76wpxb701h1vrvgb0nki54y', 'HUTCHINS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'hutchins'),
    ('cm76wpxb701h4vrvg7xtdz6gy', 'IRVING', 'TX', 'tx', 'Dallas County', 'dallas-county', 'irving'),
    ('cm76wpxb701h7vrvg8q8wh4t0', 'LANCASTER', 'TX', 'tx', 'Dallas County', 'dallas-county', 'lancaster'),
    ('cm76wpxb701havrvgvuhbb6xx', 'MESQUITE', 'TX', 'tx', 'Dallas County', 'dallas-county', 'mesquite'),
    ('cm76wpxb701hdvrvgr1l99m0s', 'RICHARDSON', 'TX', 'tx', 'Dallas County', 'dallas-county', 'richardson'),
    ('cm76wpxb701hgvrvgynju2mdf', 'ROWLETT', 'TX', 'tx', 'Dallas County', 'dallas-county', 'rowlett'),
    ('cm76wpxb701hjvrvge6ujhkxp', 'SACHSE', 'TX', 'tx', 'Dallas County', 'dallas-county', 'sachse'),
    ('cm76wpxb701hmvrvg797h6jw2', 'SEAGOVILLE', 'TX', 'tx', 'Dallas County', 'dallas-county', 'seagoville'),
    ('cm76wpxb701hpvrvgyriyqcpe', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701hsvrvggdyyxnb4', 'WILMER', 'TX', 'tx', 'Dallas County', 'dallas-county', 'wilmer'),
    ('cm76wpxb701hvvrvg1ufmsyoc', 'GLENN HEIGHTS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'glenn-heights'),
    ('cm76wpxb701hyvrvg0z314nyr', 'SUNNYVALE', 'TX', 'tx', 'Dallas County', 'dallas-county', 'sunnyvale'),
    ('cm76wpxb701i1vrvgw4ifpgsq', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701i4vrvgkrmikdfn', 'ADDISON', 'TX', 'tx', 'Dallas County', 'dallas-county', 'addison'),
    ('cm76wpxb701i7vrvglka2vciw', 'BALCH SPRINGS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'balch-springs'),
    ('cm76wpxb701iavrvg9fdfe5un', 'Cockrell Hill', 'TX', 'tx', 'Dallas County', 'dallas-county', 'cockrell-hill'),
    ('cm76wpxb701icvrvgr2duxzyg', 'CARROLLTON', 'TX', 'tx', 'Dallas County', 'dallas-county', 'carrollton'),
    ('cm76wpxb701ifvrvgrh7kmw8i', 'CEDAR HILL', 'TX', 'tx', 'Dallas County', 'dallas-county', 'cedar-hill'),
    ('cm76wpxb701iivrvgjejqerkl', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb701ilvrvgjcha793e', 'DESOTO', 'TX', 'tx', 'Dallas County', 'dallas-county', 'desoto'),
    ('cm76wpxb701iovrvgv3t65eza', 'Duncanville', 'TX', 'tx', 'Dallas County', 'dallas-county', 'duncanville'),
    ('cm76wpxb701irvrvgbx4q4wz1', 'FARMERS BRANCH', 'TX', 'tx', 'Dallas County', 'dallas-county', 'farmers-branch'),
    ('cm76wpxb701iuvrvgvxjaqw0b', 'GARLAND', 'TX', 'tx', 'Dallas County', 'dallas-county', 'garland'),
    ('cm76wpxb701ixvrvg2ppofcwx', 'GRAND PRAIRIE', 'TX', 'tx', 'Dallas County', 'dallas-county', 'grand-prairie'),
    ('cm76wpxb801j0vrvg94rqicgv', 'IRVING', 'TX', 'tx', 'Dallas County', 'dallas-county', 'irving'),
    ('cm76wpxb801j3vrvgvkjvkkfs', 'LANCASTER', 'TX', 'tx', 'Dallas County', 'dallas-county', 'lancaster'),
    ('cm76wpxb801j6vrvgg3amhx5h', 'MESQUITE', 'TX', 'tx', 'Dallas County', 'dallas-county', 'mesquite'),
    ('cm76wpxb801j9vrvgol86cmb2', 'RICHARDSON', 'TX', 'tx', 'Dallas County', 'dallas-county', 'richardson'),
    ('cm76wpxb801jcvrvgyb64jvfw', 'Rowlett', 'TX', 'tx', 'Dallas County', 'dallas-county', 'rowlett'),
    ('cm76wpxb801jfvrvg2oai6fnc', 'SUNNYVALE', 'TX', 'tx', 'Dallas County', 'dallas-county', 'sunnyvale'),
    ('cm76wpxb801jivrvg0ixjjce9', 'UNIVERSITY PARK', 'TX', 'tx', 'Dallas County', 'dallas-county', 'university-park'),
    ('cm76wpxb801jlvrvg8mvcvoqh', 'Sachse', 'TX', 'tx', 'Dallas County', 'dallas-county', 'sachse'),
    ('cm76wpxb801jovrvgalvblpyg', 'DFW Airport', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dfw-airport'),
    ('cm76wpxb801jrvrvgfhd09oxf', 'Balch Springs', 'TX', 'tx', 'Dallas County', 'dallas-county', 'balch-springs'),
    ('cm76wpxb801juvrvg1oydo64g', 'COPPELL', 'TX', 'tx', 'Dallas County', 'dallas-county', 'coppell'),
    ('cm76wpxb801jxvrvgm7gbglpq', 'DeSoto', 'TX', 'tx', 'Dallas County', 'dallas-county', 'desoto'),
    ('cm76wpxb801k0vrvg2sawqsnl', 'CARROLLTON', 'TX', 'tx', 'Dallas County', 'dallas-county', 'carrollton'),
    ('cm76wpxb801k3vrvgekws5sff', 'LANCASTER', 'TX', 'tx', 'Dallas County', 'dallas-county', 'lancaster'),
    ('cm76wpxb801k6vrvg036zov5a', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb801k9vrvgj9x1t82n', 'GRAND PRAIRIE', 'TX', 'tx', 'Dallas County', 'dallas-county', 'grand-prairie'),
    ('cm76wpxb801kcvrvgn7qzjnol', 'CEDAR HILL', 'TX', 'tx', 'Dallas County', 'dallas-county', 'cedar-hill'),
    ('cm76wpxb801kfvrvg3u1fcf4b', 'Mesquite', 'TX', 'tx', 'Dallas County', 'dallas-county', 'mesquite'),
    ('cm76wpxb801kivrvgprb4hmrj', 'IRVING', 'TX', 'tx', 'Dallas County', 'dallas-county', 'irving'),
    ('cm76wpxb801klvrvgypeihc72', 'GARLAND', 'TX', 'tx', 'Dallas County', 'dallas-county', 'garland'),
    ('cm76wpxb801kovrvg3dcx6az3', 'DUNCANVILLE', 'TX', 'tx', 'Dallas County', 'dallas-county', 'duncanville'),
    ('cm76wpxb801krvrvg3o3bgh0m', 'ROWLETT', 'TX', 'tx', 'Dallas County', 'dallas-county', 'rowlett'),
    ('cm76wpxb801kuvrvg0jocy12e', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb801kxvrvgu3yx9l8x', 'LANCASTER', 'TX', 'tx', 'Dallas County', 'dallas-county', 'lancaster'),
    ('cm76wpxb801kzvrvg77eb4pw7', 'CEDAR HILL', 'TX', 'tx', 'Dallas County', 'dallas-county', 'cedar-hill'),
    ('cm76wpxb801l2vrvgn0p6gzq2', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb801l5vrvg8c0gqrlx', 'Duncanville', 'TX', 'tx', 'Dallas County', 'dallas-county', 'duncanville'),
    ('cm76wpxb801l8vrvgs9m4fi1i', 'DALLAS', 'TX', 'tx', 'Dallas County', 'dallas-county', 'dallas'),
    ('cm76wpxb801lavrvgwlb2ipjq', 'Cedar Hill', 'TX', 'tx', 'Dallas County', 'dallas-county', 'cedar-hill'),
    ('cm76wpxb801ldvrvg9em6unor', 'Lamesa', 'TX', 'tx', 'Dawson County', 'dawson-county', 'lamesa'),
    ('cm76wpxb801lgvrvgu9gur9hd', 'Lamesa', 'TX', 'tx', 'Dawson County', 'dawson-county', 'lamesa'),
    ('cm76wpxb801ljvrvgeavvc44g', 'LAMESA', 'TX', 'tx', 'Dawson County', 'dawson-county', 'lamesa'),
    ('cm76wpxb801lmvrvg77017iem', 'Lamesa', 'TX', 'tx', 'Dawson County', 'dawson-county', 'lamesa'),
    ('cm76wpxb801lpvrvgayrgph3m', 'LAMESA', 'TX', 'tx', 'Dawson County', 'dawson-county', 'lamesa'),
    ('cm76wpxb801lsvrvga1rb58sv', 'LAMESA', 'TX', 'tx', 'Dawson County', 'dawson-county', 'lamesa'),
    ('cm76wpxb901lvvrvgjh1t3b0u', 'HEREFORD', 'TX', 'tx', 'Deaf Smith County', 'deaf-smith-county', 'hereford'),
    ('cm76wpxb901lyvrvgwq8ixs8y', 'HEREFORD', 'TX', 'tx', 'Deaf Smith County', 'deaf-smith-county', 'hereford'),
    ('cm76wpxb901m1vrvgn21huxa5', 'HEREFORD', 'TX', 'tx', 'Deaf Smith County', 'deaf-smith-county', 'hereford'),
    ('cm76wpxb901m4vrvgfcl1n7wm', 'HEREFORD', 'TX', 'tx', 'Deaf Smith County', 'deaf-smith-county', 'hereford'),
    ('cm76wpxb901m7vrvgtt0uvyr2', 'COOPER', 'TX', 'tx', 'Delta County', 'delta-county', 'cooper'),
    ('cm76wpxb901mavrvgs1mvfkcl', 'Cooper', 'TX', 'tx', 'Delta County', 'delta-county', 'cooper'),
    ('cm76wpxb901mdvrvg0iaxchvn', 'COOPER', 'TX', 'tx', 'Delta County', 'delta-county', 'cooper'),
    ('cm76wpxb901mgvrvg56qrls9t', 'Cooper', 'TX', 'tx', 'Delta County', 'delta-county', 'cooper'),
    ('cm76wpxb901mjvrvgzwl0p963', 'DENTON', 'TX', 'tx', 'Denton County', 'denton-county', 'denton'),
    ('cm76wpxb901mmvrvgyoxzccs9', 'DENTON', 'TX', 'tx', 'Denton County', 'denton-county', 'denton'),
    ('cm76wpxb901mpvrvgzxugmxc7', 'DENTON', 'TX', 'tx', 'Denton County', 'denton-county', 'denton'),
    ('cm76wpxb901msvrvgichgdkq8', 'DENTON', 'TX', 'tx', 'Denton County', 'denton-county', 'denton'),
    ('cm76wpxb901mvvrvgz2bwisxx', 'Frisco', 'TX', 'tx', 'Denton County', 'denton-county', 'frisco'),
    ('cm76wpxb901myvrvgdfyzw3xf', 'LEWISVILLE', 'TX', 'tx', 'Denton County', 'denton-county', 'lewisville'),
    ('cm76wpxb901n1vrvgp0fy8n2j', 'ARGYLE', 'TX', 'tx', 'Denton County', 'denton-county', 'argyle'),
    ('cm76wpxb901n4vrvgs5a966qa', 'CROSS ROADS', 'TX', 'tx', 'Denton County', 'denton-county', 'cross-roads'),
    ('cm76wpxb901n7vrvgyv1q36ft', 'CARROLLTON', 'TX', 'tx', 'Denton County', 'denton-county', 'carrollton'),
    ('cm76wpxb901navrvgpn94ithu', 'CARROLLTON', 'TX', 'tx', 'Denton County', 'denton-county', 'carrollton'),
    ('cm76wpxb901ndvrvginm4643q', 'DENTON', 'TX', 'tx', 'Denton County', 'denton-county', 'denton'),
    ('cm76wpxb901nfvrvg9n7u5d11', 'DENTON', 'TX', 'tx', 'Denton County', 'denton-county', 'denton'),
    ('cm76wpxb901nivrvgf3aawvd6', 'ARGYLE', 'TX', 'tx', 'Denton County', 'denton-county', 'argyle'),
    ('cm76wpxb901nlvrvgl3gr1wed', 'AUBREY', 'TX', 'tx', 'Denton County', 'denton-county', 'aubrey'),
    ('cm76wpxb901novrvgvxnt1uww', 'CORINTH', 'TX', 'tx', 'Denton County', 'denton-county', 'corinth'),
    ('cm76wpxb901nrvrvgo1htp8p3', 'DENTON', 'TX', 'tx', 'Denton County', 'denton-county', 'denton'),
    ('cm76wpxb901nuvrvgnnjhfkpc', 'FLOWER MOUND', 'TX', 'tx', 'Denton County', 'denton-county', 'flower-mound'),
    ('cm76wpxb901nxvrvgmyk5pimh', 'HICKORY CREEK', 'TX', 'tx', 'Denton County', 'denton-county', 'hickory-creek'),
    ('cm76wpxb901o0vrvgf85ac127', 'HIGHLAND VILLAGE', 'TX', 'tx', 'Denton County', 'denton-county', 'highland-village'),
    ('cm76wpxb901o3vrvgywsh1ck6', 'JUSTIN', 'TX', 'tx', 'Denton County', 'denton-county', 'justin'),
    ('cm76wpxb901o6vrvg6owguher', 'KRUM', 'TX', 'tx', 'Denton County', 'denton-county', 'krum'),
    ('cm76wpxb901o9vrvgo9d3xy16', 'LAKE DALLAS', 'TX', 'tx', 'Denton County', 'denton-county', 'lake-dallas'),
    ('cm76wpxb901ocvrvg91f5wq4x', 'LEWISVILLE', 'TX', 'tx', 'Denton County', 'denton-county', 'lewisville'),
    ('cm76wpxb901ofvrvg6a86is0k', 'LITTLE ELM', 'TX', 'tx', 'Denton County', 'denton-county', 'little-elm'),
    ('cm76wpxb901oivrvg3b52t7k5', 'NORTHLAKE', 'TX', 'tx', 'Denton County', 'denton-county', 'northlake'),
    ('cm76wpxb901olvrvgwrhx8yyb', 'PILOT POINT', 'TX', 'tx', 'Denton County', 'denton-county', 'pilot-point'),
    ('cm76wpxb901oovrvg16ct7avn', 'PONDER', 'TX', 'tx', 'Denton County', 'denton-county', 'ponder'),
    ('cm76wpxb901orvrvgwxmj1vsp', 'ROANOKE', 'TX', 'tx', 'Denton County', 'denton-county', 'roanoke'),
    ('cm76wpxb901ouvrvgvzfwdzuk', 'SANGER', 'TX', 'tx', 'Denton County', 'denton-county', 'sanger'),
    ('cm76wpxb901oxvrvgzd6728mn', 'THE COLONY', 'TX', 'tx', 'Denton County', 'denton-county', 'the-colony'),
    ('cm76wpxb901p0vrvg5ihf8jzi', 'LITTLE ELM', 'TX', 'tx', 'Denton County', 'denton-county', 'little-elm'),
    ('cm76wpxb901p3vrvg2tgyc2lv', 'DOUBLE OAK', 'TX', 'tx', 'Denton County', 'denton-county', 'double-oak'),
    ('cm76wpxb901p6vrvg0bjg7qbs', 'ROANOKE', 'TX', 'tx', 'Denton County', 'denton-county', 'roanoke'),
    ('cm76wpxb901p9vrvgfnk5aetb', 'KRUGERVILLE', 'TX', 'tx', 'Denton County', 'denton-county', 'krugerville'),
    ('cm76wpxba01pcvrvgcn913a7q', 'BARTONVILLE', 'TX', 'tx', 'Denton County', 'denton-county', 'bartonville'),
    ('cm76wpxba01pfvrvgt96ub80p', 'CROSSROADS', 'TX', 'tx', 'Denton County', 'denton-county', 'crossroads'),
    ('cm76wpxba01pivrvga714lily', 'LEWISVILLE', 'TX', 'tx', 'Denton County', 'denton-county', 'lewisville'),
    ('cm76wpxba01pkvrvg6ghlmgzd', 'HIGHLAND VILLAGE', 'TX', 'tx', 'Denton County', 'denton-county', 'highland-village'),
    ('cm76wpxba01pnvrvg2h7aty4w', 'DENTON', 'TX', 'tx', 'Denton County', 'denton-county', 'denton'),
    ('cm76wpxba01ppvrvgir4kdn9x', 'FLOWER MOUND', 'TX', 'tx', 'Denton County', 'denton-county', 'flower-mound'),
    ('cm76wpxba01psvrvg36tq39gk', 'LEWISVILLE', 'TX', 'tx', 'Denton County', 'denton-county', 'lewisville'),
    ('cm76wpxba01pvvrvgm5ucbmzk', 'LITTLE ELM', 'TX', 'tx', 'Denton County', 'denton-county', 'little-elm'),
    ('cm76wpxba01pyvrvg2v9hyzwe', 'THE COLONY', 'TX', 'tx', 'Denton County', 'denton-county', 'the-colony'),
    ('cm76wpxba01q1vrvgv42wli42', 'Trophy Club', 'TX', 'tx', 'Denton County', 'denton-county', 'trophy-club'),
    ('cm76wpxba01q4vrvgzsfhzcwd', 'FLOWER MOUND', 'TX', 'tx', 'Denton County', 'denton-county', 'flower-mound'),
    ('cm76wpxba01q7vrvg7xr93he6', 'Corinth', 'TX', 'tx', 'Denton County', 'denton-county', 'corinth'),
    ('cm76wpxba01qavrvgrp2k80qg', 'SAVANNAH', 'TX', 'tx', 'Denton County', 'denton-county', 'savannah'),
    ('cm76wpxba01qdvrvgyfwacyju', 'AUBREY', 'TX', 'tx', 'Denton County', 'denton-county', 'aubrey'),
    ('cm76wpxba01qgvrvgonwpysec', 'Flower Mound', 'TX', 'tx', 'Denton County', 'denton-county', 'flower-mound'),
    ('cm76wpxba01qjvrvgej96tkd5', 'Krum', 'TX', 'tx', 'Denton County', 'denton-county', 'krum'),
    ('cm76wpxba01qmvrvgpd32ss2g', 'PILOT POINT', 'TX', 'tx', 'Denton County', 'denton-county', 'pilot-point'),
    ('cm76wpxba01qpvrvggw58fyzz', 'SANGER', 'TX', 'tx', 'Denton County', 'denton-county', 'sanger'),
    ('cm76wpxba01qsvrvgl6k9ygi5', 'LAKE DALLAS', 'TX', 'tx', 'Denton County', 'denton-county', 'lake-dallas'),
    ('cm76wpxba01quvrvgqxhzf04m', 'CUERO', 'TX', 'tx', 'DeWitt County', 'dewitt-county', 'cuero'),
    ('cm76wpxba01qxvrvglauo0g4g', 'CUERO', 'TX', 'tx', 'DeWitt County', 'dewitt-county', 'cuero'),
    ('cm76wpxba01r0vrvgvi0typ6e', 'Yorktown', 'TX', 'tx', 'DeWitt County', 'dewitt-county', 'yorktown'),
    ('cm76wpxba01r2vrvgocs943zs', 'Cuero', 'TX', 'tx', 'DeWitt County', 'dewitt-county', 'cuero'),
    ('cm76wpxba01r5vrvgjc4qh087', 'Cuero', 'TX', 'tx', 'DeWitt County', 'dewitt-county', 'cuero'),
    ('cm76wpxba01r8vrvgihrlj5t6', 'CUERO', 'TX', 'tx', 'DeWitt County', 'dewitt-county', 'cuero'),
    ('cm76wpxba01rbvrvg50f3z7vk', 'Austin', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm76wpxba01rdvrvg75ytzxeh', 'YORKTOWN', 'TX', 'tx', 'DeWitt County', 'dewitt-county', 'yorktown'),
    ('cm76wpxba01rgvrvg83d1h1mv', 'DICKENS', 'TX', 'tx', 'Dickens County', 'dickens-county', 'dickens'),
    ('cm76wpxba01rjvrvgey4eq1mq', 'CARRIZO SPRINGS', 'TX', 'tx', 'Dimmit County', 'dimmit-county', 'carrizo-springs'),
    ('cm76wpxba01rmvrvg39g7nl6z', 'CARRIZO SPRINGS', 'TX', 'tx', 'Dimmit County', 'dimmit-county', 'carrizo-springs'),
    ('cm76wpxba01rovrvg3995kiu1', 'CARRIZO SPRINGS', 'TX', 'tx', 'Dimmit County', 'dimmit-county', 'carrizo-springs'),
    ('cm76wpxba01rrvrvgxzwmgsqp', 'Big Wells', 'TX', 'tx', 'Dimmit County', 'dimmit-county', 'big-wells'),
    ('cm76wpxba01ruvrvgnimql4to', 'Asherton', 'TX', 'tx', 'Dimmit County', 'dimmit-county', 'asherton'),
    ('cm76wpxba01rxvrvg4ogoejvs', 'Carrizo Springs', 'TX', 'tx', 'Dimmit County', 'dimmit-county', 'carrizo-springs'),
    ('cm76wpxba01s0vrvggit79a96', 'CARRIZO SPRINGS', 'TX', 'tx', 'Dimmit County', 'dimmit-county', 'carrizo-springs'),
    ('cm76wpxba01s3vrvg16pyjug9', 'CLARENDON', 'TX', 'tx', 'Donley County', 'donley-county', 'clarendon'),
    ('cm76wpxba01s6vrvgyemktm8f', 'Clarendon', 'TX', 'tx', 'Donley County', 'donley-county', 'clarendon'),
    ('cm76wpxba01s9vrvgw0ci6tg9', 'SAN DIEGO', 'TX', 'tx', 'Duval County', 'duval-county', 'san-diego'),
    ('cm76wpxba01scvrvg1g0cp7fe', 'SAN DIEGO', 'TX', 'tx', 'Duval County', 'duval-county', 'san-diego'),
    ('cm76wpxba01sfvrvghhfld3m7', 'San Diego', 'TX', 'tx', 'Duval County', 'duval-county', 'san-diego'),
    ('cm76wpxba01sivrvgswrxff3h', 'BENAVIDES', 'TX', 'tx', 'Duval County', 'duval-county', 'benavides'),
    ('cm76wpxba01skvrvgivuplh15', 'FREER', 'TX', 'tx', 'Duval County', 'duval-county', 'freer'),
    ('cm76wpxba01snvrvgps0shx69', 'BENAVIDES', 'TX', 'tx', 'Duval County', 'duval-county', 'benavides'),
    ('cm76wpxba01sqvrvgx0q3vv8h', 'FREER', 'TX', 'tx', 'Duval County', 'duval-county', 'freer'),
    ('cm76wpxba01stvrvg9entcxua', 'SAN DIEGO', 'TX', 'tx', 'Duval County', 'duval-county', 'san-diego'),
    ('cm76wpxba01swvrvgmude9cf6', 'EASTLAND', 'TX', 'tx', 'Eastland County', 'eastland-county', 'eastland'),
    ('cm76wpxba01szvrvgpfnrvlup', 'CISCO', 'TX', 'tx', 'Eastland County', 'eastland-county', 'cisco'),
    ('cm76wpxba01t2vrvgr21eofdc', 'EASTLAND', 'TX', 'tx', 'Eastland County', 'eastland-county', 'eastland'),
    ('cm76wpxba01t5vrvgmf86xbor', 'EASTLAND', 'TX', 'tx', 'Eastland County', 'eastland-county', 'eastland'),
    ('cm76wpxba01t7vrvgce1d458r', 'EASTLAND', 'TX', 'tx', 'Eastland County', 'eastland-county', 'eastland'),
    ('cm76wpxba01tavrvg313o0n6s', 'EASTLAND', 'TX', 'tx', 'Eastland County', 'eastland-county', 'eastland'),
    ('cm76wpxba01tdvrvg3z8yyuxz', 'EASTLAND', 'TX', 'tx', 'Eastland County', 'eastland-county', 'eastland'),
    ('cm76wpxba01tgvrvgf2f3ts50', 'CISCO', 'TX', 'tx', 'Eastland County', 'eastland-county', 'cisco'),
    ('cm76wpxba01tjvrvgn125vlem', 'EASTLAND', 'TX', 'tx', 'Eastland County', 'eastland-county', 'eastland'),
    ('cm76wpxba01tmvrvgqe4ccdyf', 'RANGER', 'TX', 'tx', 'Eastland County', 'eastland-county', 'ranger'),
    ('cm76wpxba01tpvrvgi8msx6yh', 'GORMAN', 'TX', 'tx', 'Eastland County', 'eastland-county', 'gorman'),
    ('cm76wpxba01trvrvgtti0cy8d', 'ODESSA', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01tuvrvgauxvdr1w', 'ODESSA', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01txvrvgi3ky1m5z', 'ODESSA', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01u0vrvglskczt0u', 'Odessa', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01u2vrvgyijpydub', 'ODESSA', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01u5vrvgj71268vb', 'ODESSA', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01u7vrvg9kje9lxz', 'ODESSA', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01u9vrvg4jwso1kz', 'Odessa', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01ucvrvg4zsa0lo0', 'ODESSA', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01ufvrvg3b0ifzf9', 'ODESSA', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01uivrvgyvx190vu', 'ODESSA', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01ulvrvgctnnizwi', 'Odessa', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01uovrvgp5tyjf2w', 'ODESSA', 'TX', 'tx', 'Ector County', 'ector-county', 'odessa'),
    ('cm76wpxba01urvrvgv185esxx', 'ROCKSPRINGS', 'TX', 'tx', 'Edwards County', 'edwards-county', 'rocksprings'),
    ('cm76wpxba01uuvrvge7vxwudg', 'ROCKSPRINGS', 'TX', 'tx', 'Edwards County', 'edwards-county', 'rocksprings'),
    ('cm76wpxba01uxvrvgsese6we0', 'WAXAHACHIE', 'TX', 'tx', 'Ellis County', 'ellis-county', 'waxahachie'),
    ('cm76wpxba01v0vrvgqpmjx8l7', 'ENNIS', 'TX', 'tx', 'Ellis County', 'ellis-county', 'ennis'),
    ('cm76wpxba01v3vrvggwr6to54', 'WAXAHACHIE', 'TX', 'tx', 'Ellis County', 'ellis-county', 'waxahachie'),
    ('cm76wpxbb01v6vrvg4tnh9l59', 'WAXAHACHIE', 'TX', 'tx', 'Ellis County', 'ellis-county', 'waxahachie'),
    ('cm76wpxbb01v9vrvgk1qov5iu', 'MIDLOTHIAN', 'TX', 'tx', 'Ellis County', 'ellis-county', 'midlothian'),
    ('cm76wpxbb01vcvrvgfj8y8edp', 'WAXAHACHIE', 'TX', 'tx', 'Ellis County', 'ellis-county', 'waxahachie'),
    ('cm76wpxbb01vfvrvgeg2m9wcq', 'ENNIS', 'TX', 'tx', 'Ellis County', 'ellis-county', 'ennis'),
    ('cm76wpxbb01vivrvgrnlpd1ak', 'FERRIS', 'TX', 'tx', 'Ellis County', 'ellis-county', 'ferris'),
    ('cm76wpxbb01vlvrvgy4bjm260', 'GARRETT', 'TX', 'tx', 'Ellis County', 'ellis-county', 'garrett'),
    ('cm76wpxbb01vovrvgi7nabki8', 'ITALY', 'TX', 'tx', 'Ellis County', 'ellis-county', 'italy'),
    ('cm76wpxbb01vrvrvgj1z619eq', 'MAYPEARL', 'TX', 'tx', 'Ellis County', 'ellis-county', 'maypearl'),
    ('cm76wpxbb01vuvrvgb4oywlxx', 'MIDLOTHIAN', 'TX', 'tx', 'Ellis County', 'ellis-county', 'midlothian'),
    ('cm76wpxbb01vxvrvga9a9b5kk', 'MILFORD', 'TX', 'tx', 'Ellis County', 'ellis-county', 'milford'),
    ('cm76wpxbb01w0vrvgyrl44ekq', 'OVILLA', 'TX', 'tx', 'Ellis County', 'ellis-county', 'ovilla'),
    ('cm76wpxbb01w3vrvgfqxfs7xa', 'PALMER', 'TX', 'tx', 'Ellis County', 'ellis-county', 'palmer'),
    ('cm76wpxbb01w6vrvg7cv7hw2b', 'RED OAK', 'TX', 'tx', 'Ellis County', 'ellis-county', 'red-oak'),
    ('cm76wpxbb01w9vrvgzq2mdile', 'WAXAHACHIE', 'TX', 'tx', 'Ellis County', 'ellis-county', 'waxahachie'),
    ('cm76wpxbb01wcvrvg8yl2hvuo', 'RED OAK', 'TX', 'tx', 'Ellis County', 'ellis-county', 'red-oak'),
    ('cm76wpxbb01wfvrvg0q41gnk6', 'ENNIS', 'TX', 'tx', 'Ellis County', 'ellis-county', 'ennis'),
    ('cm76wpxbb01whvrvgk8vgciiu', 'ENNIS', 'TX', 'tx', 'Ellis County', 'ellis-county', 'ennis'),
    ('cm76wpxbb01wkvrvg65dxwaxd', 'FERRIS', 'TX', 'tx', 'Ellis County', 'ellis-county', 'ferris'),
    ('cm76wpxbb01wnvrvgva5oeen0', 'Red Oak', 'TX', 'tx', 'Ellis County', 'ellis-county', 'red-oak'),
    ('cm76wpxbb01wqvrvguvv8moul', 'WAXAHACHIE', 'TX', 'tx', 'Ellis County', 'ellis-county', 'waxahachie'),
    ('cm76wpxbb01wtvrvgk5yf3tko', 'Waxahachie', 'TX', 'tx', 'Ellis County', 'ellis-county', 'waxahachie'),
    ('cm76wpxbb01wwvrvgzedag5go', 'ENNIS', 'TX', 'tx', 'Ellis County', 'ellis-county', 'ennis'),
    ('cm76wpxbb01wzvrvg9hllu1ty', 'RED OAK', 'TX', 'tx', 'Ellis County', 'ellis-county', 'red-oak'),
    ('cm76wpxbb01x2vrvgmqjfv0er', 'Ferris', 'TX', 'tx', 'Ellis County', 'ellis-county', 'ferris'),
    ('cm76wpxbb01x5vrvgpfa588of', 'MAYPEARL', 'TX', 'tx', 'Ellis County', 'ellis-county', 'maypearl'),
    ('cm76wpxbb01x8vrvg8yncbuhi', 'El Paso', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01xbvrvglx088pup', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01xevrvgw7mvfnzj', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01xhvrvgkymxqk4a', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01xkvrvgtnxthtmq', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01xnvrvgdh512wty', 'El Paso', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01xqvrvg7e1rhsoz', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01xtvrvgnco5gt07', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01xwvrvgyvjip3s7', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01xyvrvgwkou3smr', 'CLINT', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'clint'),
    ('cm76wpxbb01y1vrvgwaz2vaik', 'Vinton', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'vinton'),
    ('cm76wpxbb01y3vrvgpj3jz8ga', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01y6vrvgkhd2bwoj', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01y9vrvgi8yl8hky', 'ANTHONY', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'anthony'),
    ('cm76wpxbb01ycvrvg7zfnr40n', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01yfvrvgi923e3if', 'CLINT', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'clint'),
    ('cm76wpxbb01yivrvgee65r7fg', 'Horizon City', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'horizon-city'),
    ('cm76wpxbb01ylvrvgn8qutjjk', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01yovrvgfqso9vwe', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01yrvrvg0hcna532', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01yuvrvgv4xxuwi8', 'Fabens', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'fabens'),
    ('cm76wpxbb01yxvrvgua9ts4or', 'San Elizario', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'san-elizario'),
    ('cm76wpxbb01z0vrvg44swfsq2', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01z3vrvgpk6zh2il', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01z6vrvgbycfv1bc', 'EL PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm76wpxbb01z9vrvg2kk204is', 'Canutillo', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'canutillo'),
    ('cm76wpxbb01zcvrvg54vf1ld3', 'STEPHENVILLE', 'TX', 'tx', 'Erath County', 'erath-county', 'stephenville'),
    ('cm76wpxbb01zfvrvgibvty9ai', 'STEPHENVILLE', 'TX', 'tx', 'Erath County', 'erath-county', 'stephenville'),
    ('cm76wpxbb01zivrvghfhr1mmk', 'STEPHENVILLE', 'TX', 'tx', 'Erath County', 'erath-county', 'stephenville'),
    ('cm76wpxbb01zlvrvgyilricfa', 'STEPHENVILLE', 'TX', 'tx', 'Erath County', 'erath-county', 'stephenville'),
    ('cm76wpxbb01zovrvg4davxmlp', 'DUBLIN', 'TX', 'tx', 'Erath County', 'erath-county', 'dublin'),
    ('cm76wpxbb01zrvrvg8b4jzy0b', 'STEPHENVILLE', 'TX', 'tx', 'Erath County', 'erath-county', 'stephenville'),
    ('cm76wpxbb01zuvrvgmwj3yf8s', 'STEPHENVILLE', 'TX', 'tx', 'Erath County', 'erath-county', 'stephenville'),
    ('cm76wpxbb01zxvrvgt4w577ey', 'Stephenville', 'TX', 'tx', 'Erath County', 'erath-county', 'stephenville'),
    ('cm76wpxbb0200vrvgctsiu8p2', 'DUBLIN', 'TX', 'tx', 'Erath County', 'erath-county', 'dublin'),
    ('cm76wpxbb0203vrvgedauqgtt', 'STEPHENVILLE', 'TX', 'tx', 'Erath County', 'erath-county', 'stephenville'),
    ('cm76wpxbb0206vrvglxfim7ol', 'DUBLIN', 'TX', 'tx', 'Erath County', 'erath-county', 'dublin'),
    ('cm76wpxbb0209vrvg7493i1xa', 'STEPHENVILLE', 'TX', 'tx', 'Erath County', 'erath-county', 'stephenville'),
    ('cm76wpxbb020cvrvgroxnlisn', 'Marlin', 'TX', 'tx', 'Falls County', 'falls-county', 'marlin'),
    ('cm76wpxbb020evrvgn4ddbzza', 'MARLIN', 'TX', 'tx', 'Falls County', 'falls-county', 'marlin'),
    ('cm76wpxbb020hvrvgqva6t9p9', 'MARLIN', 'TX', 'tx', 'Falls County', 'falls-county', 'marlin'),
    ('cm76wpxbb020kvrvgzdcdb5sl', 'MARLIN', 'TX', 'tx', 'Falls County', 'falls-county', 'marlin'),
    ('cm76wpxbb020nvrvgidz7uzk2', 'Lott', 'TX', 'tx', 'Falls County', 'falls-county', 'lott'),
    ('cm76wpxbb020qvrvga8v33qjl', 'Chilton', 'TX', 'tx', 'Falls County', 'falls-county', 'chilton'),
    ('cm76wpxbb020svrvgw1cnel2t', 'MARLIN', 'TX', 'tx', 'Falls County', 'falls-county', 'marlin'),
    ('cm76wpxbb020vvrvgg9eciwde', 'MARLIN', 'TX', 'tx', 'Falls County', 'falls-county', 'marlin'),
    ('cm76wpxbb020yvrvgu4q27gv3', 'ROSEBUD', 'TX', 'tx', 'Falls County', 'falls-county', 'rosebud'),
    ('cm76wpxbc0211vrvg6fa3jct2', 'Marlin', 'TX', 'tx', 'Falls County', 'falls-county', 'marlin'),
    ('cm76wpxbc0214vrvgpsjdnwpf', 'BONHAM', 'TX', 'tx', 'Fannin County', 'fannin-county', 'bonham'),
    ('cm76wpxbc0217vrvgxtpzevru', 'Bonham', 'TX', 'tx', 'Fannin County', 'fannin-county', 'bonham'),
    ('cm76wpxbc021avrvg0u568axs', 'LEONARD', 'TX', 'tx', 'Fannin County', 'fannin-county', 'leonard'),
    ('cm76wpxbc021dvrvgf6wmy16u', 'Windom', 'TX', 'tx', 'Fannin County', 'fannin-county', 'windom'),
    ('cm76wpxbc021gvrvgrecoa92n', 'BONHAM', 'TX', 'tx', 'Fannin County', 'fannin-county', 'bonham'),
    ('cm76wpxbc021jvrvgj2lewq7d', 'BONHAM', 'TX', 'tx', 'Fannin County', 'fannin-county', 'bonham'),
    ('cm76wpxbc021mvrvgtdsh0nky', 'HONEY GROVE', 'TX', 'tx', 'Fannin County', 'fannin-county', 'honey-grove'),
    ('cm76wpxbc021pvrvgpd0zzloc', 'LEONARD', 'TX', 'tx', 'Fannin County', 'fannin-county', 'leonard'),
    ('cm76wpxbc021svrvg2d2x4zzt', 'SAVOY', 'TX', 'tx', 'Fannin County', 'fannin-county', 'savoy'),
    ('cm76wpxbc021vvrvg0y1zte8m', 'TRENTON', 'TX', 'tx', 'Fannin County', 'fannin-county', 'trenton'),
    ('cm76wpxbc021yvrvgny847722', 'ECTOR', 'TX', 'tx', 'Fannin County', 'fannin-county', 'ector'),
    ('cm76wpxbc0221vrvgr8jaosfg', 'LEONARD', 'TX', 'tx', 'Fannin County', 'fannin-county', 'leonard'),
    ('cm76wpxbc0224vrvgkxzp9j7e', 'Honey Grove', 'TX', 'tx', 'Fannin County', 'fannin-county', 'honey-grove'),
    ('cm76wpxbc0227vrvg8x2vihen', 'Dodd City', 'TX', 'tx', 'Fannin County', 'fannin-county', 'dodd-city'),
    ('cm76wpxbc022avrvg3soydyfx', 'BONHAM', 'TX', 'tx', 'Fannin County', 'fannin-county', 'bonham'),
    ('cm76wpxbc022dvrvge8ks2pyl', 'Ivanhoe', 'TX', 'tx', 'Fannin County', 'fannin-county', 'ivanhoe'),
    ('cm76wpxbc022gvrvgqcmnx2un', 'Trenton', 'TX', 'tx', 'Fannin County', 'fannin-county', 'trenton'),
    ('cm76wpxbc022jvrvgwvq5llqn', 'LA GRANGE', 'TX', 'tx', 'Fayette County', 'fayette-county', 'la-grange'),
    ('cm76wpxbc022mvrvgqwikpp9c', 'LA GRANGE', 'TX', 'tx', 'Fayette County', 'fayette-county', 'la-grange'),
    ('cm76wpxbc022pvrvg2dcyn70k', 'Fayetteville', 'TX', 'tx', 'Fayette County', 'fayette-county', 'fayetteville'),
    ('cm76wpxbc022svrvgq6wnp0gb', 'FLATONIA', 'TX', 'tx', 'Fayette County', 'fayette-county', 'flatonia'),
    ('cm76wpxbc022uvrvg4g05hos7', 'SCHULENBURG', 'TX', 'tx', 'Fayette County', 'fayette-county', 'schulenburg'),
    ('cm76wpxbc022wvrvghao0f88h', 'FLATONIA', 'TX', 'tx', 'Fayette County', 'fayette-county', 'flatonia'),
    ('cm76wpxbc022zvrvg5oaeq3hi', 'LA GRANGE', 'TX', 'tx', 'Fayette County', 'fayette-county', 'la-grange'),
    ('cm76wpxbc0232vrvgxqjgs1ho', 'SCHULENBURG', 'TX', 'tx', 'Fayette County', 'fayette-county', 'schulenburg'),
    ('cm76wpxbc0235vrvggm7m0hqc', 'ROBY', 'TX', 'tx', 'Fisher County', 'fisher-county', 'roby'),
    ('cm76wpxbc0238vrvgr3scd0pc', 'Rotan', 'TX', 'tx', 'Fisher County', 'fisher-county', 'rotan'),
    ('cm76wpxbc023avrvgnf1qj0cb', 'FLOYDADA', 'TX', 'tx', 'Floyd County', 'floyd-county', 'floydada'),
    ('cm76wpxbc023dvrvgozap8naw', 'FLOYDADA', 'TX', 'tx', 'Floyd County', 'floyd-county', 'floydada'),
    ('cm76wpxbc023fvrvgiq9zcgpo', 'FLOYDADA', 'TX', 'tx', 'Floyd County', 'floyd-county', 'floydada'),
    ('cm76wpxbc023ivrvggey5d9ld', 'CROWELL', 'TX', 'tx', 'Foard County', 'foard-county', 'crowell'),
    ('cm76wpxbc023lvrvgofiz62nu', 'CROWELL', 'TX', 'tx', 'Foard County', 'foard-county', 'crowell'),
    ('cm76wpxbc023nvrvglcul9yni', 'CROWELL', 'TX', 'tx', 'Foard County', 'foard-county', 'crowell'),
    ('cm76wpxbc023qvrvg25kyc0uh', 'RICHMOND', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'richmond'),
    ('cm76wpxbc023tvrvglpoxhb2z', 'Katy', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'katy'),
    ('cm76wpxbc023wvrvgcjiuinie', 'MISSOURI CITY', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'missouri-city'),
    ('cm76wpxbc023zvrvgqz1pupk2', 'Sugar Land', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'sugar-land'),
    ('cm76wpxbc0242vrvgggcrdl1i', 'Richmond', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'richmond'),
    ('cm76wpxbc0244vrvgebr1i6ln', 'RICHMOND', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'richmond'),
    ('cm76wpxbc0247vrvgiiftps0n', 'RICHMOND', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'richmond'),
    ('cm76wpxbc024avrvg5me8n3py', 'RICHMOND', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'richmond'),
    ('cm76wpxbc024dvrvggvxrk0dg', 'NEEDVILLE', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'needville'),
    ('cm76wpxbc024gvrvghqyaser8', 'RICHMOND', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'richmond'),
    ('cm76wpxbc024jvrvgl7tmddwg', 'ROSENBERG', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'rosenberg'),
    ('cm76wpxbc024mvrvgv5a7yaus', 'STAFFORD', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'stafford'),
    ('cm76wpxbc024pvrvgxgho1pud', 'SUGAR LAND', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'sugar-land'),
    ('cm76wpxbc024svrvgv3msy3gf', 'ARCOLA', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'arcola'),
    ('cm76wpxbc024vvrvgpurjcuju', 'FULSHEAR', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'fulshear'),
    ('cm76wpxbc024yvrvgim5eq5ma', 'MEADOWS PLACE', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'meadows-place'),
    ('cm76wpxbc0251vrvgi4zbmjhf', 'Richmond', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'richmond'),
    ('cm76wpxbc0254vrvghqcraohw', 'ROSENBERG', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'rosenberg'),
    ('cm76wpxbc0257vrvgkbmldon6', 'STAFFORD', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'stafford'),
    ('cm76wpxbc025avrvg1xs7vv0o', 'Sugar Land', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'sugar-land'),
    ('cm76wpxbc025dvrvgnbpdwlr0', 'Katy', 'TX', 'tx', 'Harris County', 'harris-county', 'katy'),
    ('cm76wpxbc025gvrvg9q6pu4bt', 'Sugarland', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'sugarland'),
    ('cm76wpxbc025jvrvgj5lj1m9a', 'NEEDVILLE', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'needville'),
    ('cm76wpxbc025mvrvg5mf431u9', 'Rosenberg', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'rosenberg'),
    ('cm76wpxbc025ovrvgfn7junwk', 'Mount Vernon', 'TX', 'tx', 'Franklin County', 'franklin-county', 'mount-vernon'),
    ('cm76wpxbc025rvrvg7z87xxpw', 'MT. VERNON', 'TX', 'tx', 'Franklin County', 'franklin-county', 'mt-vernon'),
    ('cm76wpxbc025uvrvgczutun31', 'MOUNT VERNON', 'TX', 'tx', 'Franklin County', 'franklin-county', 'mount-vernon'),
    ('cm76wpxbc025xvrvg7mfvp81e', 'MOUNT VERNON', 'TX', 'tx', 'Franklin County', 'franklin-county', 'mount-vernon'),
    ('cm76wpxbc0260vrvgfsiz6b06', 'MOUNT VERNON', 'TX', 'tx', 'Franklin County', 'franklin-county', 'mount-vernon'),
    ('cm76wpxbc0263vrvgwuvzucqa', 'FAIRFIELD', 'TX', 'tx', 'Freestone County', 'freestone-county', 'fairfield'),
    ('cm76wpxbc0266vrvg8nlvlajh', 'FAIRFIELD', 'TX', 'tx', 'Freestone County', 'freestone-county', 'fairfield'),
    ('cm76wpxbc0269vrvgetln1idt', 'TEAGUE', 'TX', 'tx', 'Freestone County', 'freestone-county', 'teague'),
    ('cm76wpxbc026cvrvg8dsob3h6', 'FAIRFIELD', 'TX', 'tx', 'Freestone County', 'freestone-county', 'fairfield'),
    ('cm76wpxbc026fvrvgwhwp2ppa', 'Kirvin', 'TX', 'tx', 'Freestone County', 'freestone-county', 'kirvin'),
    ('cm76wpxbd026ivrvgyta8fm28', 'FAIRFIELD', 'TX', 'tx', 'Freestone County', 'freestone-county', 'fairfield'),
    ('cm76wpxbd026lvrvgn2j58cty', 'FAIRFIELD', 'TX', 'tx', 'Freestone County', 'freestone-county', 'fairfield'),
    ('cm76wpxbd026ovrvgdm3rp325', 'TEAGUE', 'TX', 'tx', 'Freestone County', 'freestone-county', 'teague'),
    ('cm76wpxbd026rvrvgy4au7ewy', 'Wortham', 'TX', 'tx', 'Freestone County', 'freestone-county', 'wortham'),
    ('cm76wpxbd026uvrvg7dhves31', 'Fairfield', 'TX', 'tx', 'Freestone County', 'freestone-county', 'fairfield'),
    ('cm76wpxbd026xvrvg5nkhvzj0', 'Teague', 'TX', 'tx', 'Freestone County', 'freestone-county', 'teague'),
    ('cm76wpxbd0270vrvgzu6xzr7l', 'PEARSALL', 'TX', 'tx', 'Frio County', 'frio-county', 'pearsall'),
    ('cm76wpxbd0273vrvgqmd8ed1v', 'PEARSALL', 'TX', 'tx', 'Frio County', 'frio-county', 'pearsall'),
    ('cm76wpxbd0275vrvgav8ecixj', 'Pearsall', 'TX', 'tx', 'Frio County', 'frio-county', 'pearsall'),
    ('cm76wpxbd0278vrvg1k505wn6', 'Pearsall', 'TX', 'tx', 'Frio County', 'frio-county', 'pearsall'),
    ('cm76wpxbd027bvrvgu81vgk9p', 'DILLEY', 'TX', 'tx', 'Frio County', 'frio-county', 'dilley'),
    ('cm76wpxbd027evrvgs6yvbkvr', 'DILLEY', 'TX', 'tx', 'Frio County', 'frio-county', 'dilley'),
    ('cm76wpxbd027hvrvg6sgqjog9', 'PEARSALL', 'TX', 'tx', 'Frio County', 'frio-county', 'pearsall'),
    ('cm76wpxbd027kvrvgxalrbu5w', 'PEARSALL', 'TX', 'tx', 'Frio County', 'frio-county', 'pearsall'),
    ('cm76wpxbd027nvrvglc1mik62', 'Seminole', 'TX', 'tx', 'Gaines County', 'gaines-county', 'seminole'),
    ('cm76wpxbd027qvrvgpvkg7zos', 'SEMINOLE', 'TX', 'tx', 'Gaines County', 'gaines-county', 'seminole'),
    ('cm76wpxbd027tvrvgyld0h532', 'Seminole', 'TX', 'tx', 'Gaines County', 'gaines-county', 'seminole'),
    ('cm76wpxbd027wvrvg7h9cq5us', 'SEAGRAVES', 'TX', 'tx', 'Gaines County', 'gaines-county', 'seagraves'),
    ('cm76wpxbd027zvrvg380avp3j', 'SEMINOLE', 'TX', 'tx', 'Gaines County', 'gaines-county', 'seminole'),
    ('cm76wpxbd0282vrvgkigenxdm', 'TEXAS CITY', 'TX', 'tx', 'Galveston County', 'galveston-county', 'texas-city'),
    ('cm76wpxbd0285vrvguxb6vd10', 'GALVESTON', 'TX', 'tx', 'Galveston County', 'galveston-county', 'galveston'),
    ('cm76wpxbd0288vrvgln24ak29', 'GALVESTON', 'TX', 'tx', 'Galveston County', 'galveston-county', 'galveston'),
    ('cm7a0bgo50000ewvg24i3a1q7', 'Bacliff', 'TX', 'tx', 'Galveston County', 'galveston-county', 'bacliff'),
    ('cm7a0bgo50003ewvgix2rqfu4', 'GALVESTON', 'TX', 'tx', 'Galveston County', 'galveston-county', 'galveston'),
    ('cm7a0bgo50006ewvgyt5eh1xg', 'LA MARQUE', 'TX', 'tx', 'Galveston County', 'galveston-county', 'la-marque'),
    ('cm7a0bgo50009ewvgy781rcnr', 'League City', 'TX', 'tx', 'Galveston County', 'galveston-county', 'league-city'),
    ('cm7a0bgo5000cewvg31wzs233', 'GALVESTON', 'TX', 'tx', 'Galveston County', 'galveston-county', 'galveston'),
    ('cm7a0bgo5000fewvgj9o8z104', 'CLEAR LAKE SHORES', 'TX', 'tx', 'Galveston County', 'galveston-county', 'clear-lake-shores'),
    ('cm7a0bgo5000iewvggxqdsdu3', 'FRIENDSWOOD', 'TX', 'tx', 'Galveston County', 'galveston-county', 'friendswood'),
    ('cm7a0bgo5000lewvg6n4xe4s3', 'GALVESTON', 'TX', 'tx', 'Galveston County', 'galveston-county', 'galveston'),
    ('cm7a0bgo5000oewvglbah8fmi', 'HITCHCOCK', 'TX', 'tx', 'Galveston County', 'galveston-county', 'hitchcock'),
    ('cm7a0bgo5000rewvgmos756sz', 'KEMAH', 'TX', 'tx', 'Galveston County', 'galveston-county', 'kemah'),
    ('cm7a0bgo5000uewvgytfbuvae', 'LA MARQUE', 'TX', 'tx', 'Galveston County', 'galveston-county', 'la-marque'),
    ('cm7a0bgo5000xewvgubk0ucl0', 'LEAGUE CITY', 'TX', 'tx', 'Galveston County', 'galveston-county', 'league-city'),
    ('cm7a0bgo50010ewvgycgd68ii', 'TEXAS CITY', 'TX', 'tx', 'Galveston County', 'galveston-county', 'texas-city'),
    ('cm7a0bgo50013ewvg6vshnssh', 'Tiki Island', 'TX', 'tx', 'Galveston County', 'galveston-county', 'tiki-island'),
    ('cm7a0bgo50016ewvg5015h8vw', 'SANTA FE', 'TX', 'tx', 'Galveston County', 'galveston-county', 'santa-fe'),
    ('cm7a0bgo50019ewvgfqx8iamy', 'DICKINSON', 'TX', 'tx', 'Galveston County', 'galveston-county', 'dickinson'),
    ('cm7a0bgo5001cewvgxashi1n2', 'TIKI ISLAND', 'TX', 'tx', 'Galveston County', 'galveston-county', 'tiki-island'),
    ('cm7a0bgo5001fewvgs7u4izan', 'BAYOU VISTA', 'TX', 'tx', 'Galveston County', 'galveston-county', 'bayou-vista'),
    ('cm7a0bgo5001iewvgo7qzwnud', 'FRIENDSWOOD', 'TX', 'tx', 'Galveston County', 'galveston-county', 'friendswood'),
    ('cm7a0bgo5001lewvgkmz4qt0h', 'GALVESTON', 'TX', 'tx', 'Galveston County', 'galveston-county', 'galveston'),
    ('cm7a0bgo5001oewvgkxx37ubc', 'KEMAH', 'TX', 'tx', 'Galveston County', 'galveston-county', 'kemah'),
    ('cm7a0bgo5001rewvgfmvrdmws', 'LA MARQUE', 'TX', 'tx', 'Galveston County', 'galveston-county', 'la-marque'),
    ('cm7a0bgo5001uewvg18ycob8m', 'LEAGUE CITY', 'TX', 'tx', 'Galveston County', 'galveston-county', 'league-city'),
    ('cm7a0bgo5001xewvgbjsufuak', 'TEXAS CITY', 'TX', 'tx', 'Galveston County', 'galveston-county', 'texas-city'),
    ('cm7a0bgo50020ewvgehulu6hb', 'DICKINSON', 'TX', 'tx', 'Galveston County', 'galveston-county', 'dickinson'),
    ('cm7a0bgo50023ewvgmgctfhjn', 'GALVESTON', 'TX', 'tx', 'Galveston County', 'galveston-county', 'galveston'),
    ('cm7a0bgo50026ewvg8qz6pel8', 'LA MARQUE', 'TX', 'tx', 'Galveston County', 'galveston-county', 'la-marque'),
    ('cm7a0bgo50029ewvg2zosahko', 'GALVESTON', 'TX', 'tx', 'Galveston County', 'galveston-county', 'galveston'),
    ('cm7a0bgo5002cewvg1yhdqt3x', 'Texas City', 'TX', 'tx', 'Galveston County', 'galveston-county', 'texas-city'),
    ('cm7a0bgo5002fewvg2j09kpk9', 'GALVESTON', 'TX', 'tx', 'Galveston County', 'galveston-county', 'galveston'),
    ('cm7a0bgo5002iewvgg6pvv6re', 'SANTA FE', 'TX', 'tx', 'Galveston County', 'galveston-county', 'santa-fe'),
    ('cm7a0bgo5002lewvgqw2svjf7', 'GALVESTON', 'TX', 'tx', 'Galveston County', 'galveston-county', 'galveston'),
    ('cm7a0bgo5002oewvgkxzn1srr', 'Hitchcock', 'TX', 'tx', 'Galveston County', 'galveston-county', 'hitchcock'),
    ('cm7a0bgo5002rewvgo2hrr2lt', 'POST', 'TX', 'tx', 'Garza County', 'garza-county', 'post'),
    ('cm7a0bgo5002uewvgezj0eqvw', 'POST', 'TX', 'tx', 'Garza County', 'garza-county', 'post'),
    ('cm7a0bgo5002xewvgz2deahi5', 'POST', 'TX', 'tx', 'Garza County', 'garza-county', 'post'),
    ('cm7a0bgo50030ewvgua5wv5rz', 'POST', 'TX', 'tx', 'Garza County', 'garza-county', 'post'),
    ('cm7a0bgo50033ewvg9fg4moa1', 'FREDERICKSBURG', 'TX', 'tx', 'Gillespie County', 'gillespie-county', 'fredericksburg'),
    ('cm7a0bgo50036ewvgdd5ssy2p', 'FREDERICKSBURG', 'TX', 'tx', 'Gillespie County', 'gillespie-county', 'fredericksburg'),
    ('cm7a0bgo50039ewvg1fkf68o8', 'FREDERICKSBURG', 'TX', 'tx', 'Gillespie County', 'gillespie-county', 'fredericksburg'),
    ('cm7a0bgo5003cewvg9fmp6kgq', 'Fredericksburg', 'TX', 'tx', 'Gillespie County', 'gillespie-county', 'fredericksburg'),
    ('cm7a0bgo5003fewvgnyqem5vn', 'Fredericksburg', 'TX', 'tx', 'Gillespie County', 'gillespie-county', 'fredericksburg'),
    ('cm7a0bgo5003iewvgky57jz7z', 'Fredericksburg', 'TX', 'tx', 'Gillespie County', 'gillespie-county', 'fredericksburg'),
    ('cm7a0bgo5003lewvglwoym3r1', 'Fredericksburg', 'TX', 'tx', 'Gillespie County', 'gillespie-county', 'fredericksburg'),
    ('cm7a0bgo5003oewvgc3ick9be', 'FREDERICKSBURG', 'TX', 'tx', 'Gillespie County', 'gillespie-county', 'fredericksburg'),
    ('cm7a0bgo5003rewvgrr9gqpxm', 'Harper', 'TX', 'tx', 'Gillespie County', 'gillespie-county', 'harper'),
    ('cm7a0bgo5003uewvglp1nelqs', 'GARDEN CITY', 'TX', 'tx', 'Glasscock County', 'glasscock-county', 'garden-city'),
    ('cm7a0bgo5003xewvgtmpdnogt', 'GARDEN CITY', 'TX', 'tx', 'Glasscock County', 'glasscock-county', 'garden-city'),
    ('cm7a0bgo5003zewvgjb1vft14', 'GOLIAD', 'TX', 'tx', 'Goliad County', 'goliad-county', 'goliad'),
    ('cm7a0bgo50042ewvgwcsg49w8', 'Goliad', 'TX', 'tx', 'Goliad County', 'goliad-county', 'goliad'),
    ('cm7a0bgo50044ewvgh57qn9ht', 'Goliad', 'TX', 'tx', 'Goliad County', 'goliad-county', 'goliad'),
    ('cm7a0bgo50046ewvgemmirur3', 'GONZALES', 'TX', 'tx', 'Gonzales County', 'gonzales-county', 'gonzales'),
    ('cm7a0bgo50049ewvgrpliopob', 'Gonzales', 'TX', 'tx', 'Gonzales County', 'gonzales-county', 'gonzales'),
    ('cm7a0bgo5004cewvgzvvq4tc4', 'WAELDER', 'TX', 'tx', 'Gonzales County', 'gonzales-county', 'waelder'),
    ('cm7a0bgo5004fewvg7q4fs84c', 'Nixon', 'TX', 'tx', 'Gonzales County', 'gonzales-county', 'nixon'),
    ('cm7a0bgo5004iewvgnakskgal', 'GONZALES', 'TX', 'tx', 'Gonzales County', 'gonzales-county', 'gonzales'),
    ('cm7a0bgo5004lewvgx35a3v7m', 'GONZALES', 'TX', 'tx', 'Gonzales County', 'gonzales-county', 'gonzales'),
    ('cm7a0bgo5004oewvgl5ps554p', 'WAELDER', 'TX', 'tx', 'Gonzales County', 'gonzales-county', 'waelder'),
    ('cm7a0bgo5004rewvgpdg47g5i', 'NIXON', 'TX', 'tx', 'Gonzales County', 'gonzales-county', 'nixon'),
    ('cm7a0bgo5004uewvgwqtd2zez', 'SMILEY', 'TX', 'tx', 'Gonzales County', 'gonzales-county', 'smiley'),
    ('cm7a0bgo5004xewvgotfyzted', 'Gonzales', 'TX', 'tx', 'Gonzales County', 'gonzales-county', 'gonzales'),
    ('cm7a0bgo50050ewvgn41rnjpp', 'PAMPA', 'TX', 'tx', 'Gray County', 'gray-county', 'pampa'),
    ('cm7a0bgo50053ewvg9ormtfu0', 'PAMPA', 'TX', 'tx', 'Gray County', 'gray-county', 'pampa'),
    ('cm7a0bgo50056ewvg42i81duw', 'PAMPA', 'TX', 'tx', 'Gray County', 'gray-county', 'pampa'),
    ('cm7a0bgo50059ewvg8ng9q92b', 'PAMPA', 'TX', 'tx', 'Gray County', 'gray-county', 'pampa'),
    ('cm7a0bgo5005cewvgzysz7onf', 'LEFORS', 'TX', 'tx', 'Gray County', 'gray-county', 'lefors'),
    ('cm7a0bgo5005eewvghzeln1hj', 'PAMPA', 'TX', 'tx', 'Gray County', 'gray-county', 'pampa'),
    ('cm7a0bgo5005hewvge77wzzb8', 'PAMPA', 'TX', 'tx', 'Gray County', 'gray-county', 'pampa'),
    ('cm7a0bgo5005kewvgdi9l3i6e', 'SHERMAN', 'TX', 'tx', 'Grayson County', 'grayson-county', 'sherman'),
    ('cm7a0bgo5005newvg3qaouyog', 'DENISON', 'TX', 'tx', 'Grayson County', 'grayson-county', 'denison'),
    ('cm7a0bgo6005qewvgs6jh8j1s', 'SHERMAN', 'TX', 'tx', 'Grayson County', 'grayson-county', 'sherman'),
    ('cm7a0bgo6005tewvg4t2p9erq', 'SHERMAN', 'TX', 'tx', 'Grayson County', 'grayson-county', 'sherman'),
    ('cm7a0bgo6005wewvgmip6ooap', 'SHERMAN', 'TX', 'tx', 'Grayson County', 'grayson-county', 'sherman'),
    ('cm7a0bgo6005yewvg2ao61ayo', 'DENISON', 'TX', 'tx', 'Grayson County', 'grayson-county', 'denison'),
    ('cm7a0bgo60061ewvgo58v5kst', 'WHITESBORO', 'TX', 'tx', 'Grayson County', 'grayson-county', 'whitesboro'),
    ('cm7a0bgo60064ewvgzvrdc9ro', 'Van Alstyne', 'TX', 'tx', 'Grayson County', 'grayson-county', 'van-alstyne'),
    ('cm7a0bgo60067ewvg9qh3wfmu', 'SHERMAN', 'TX', 'tx', 'Grayson County', 'grayson-county', 'sherman'),
    ('cm7a0bgo6006aewvgaqbhtkyp', 'Sherman', 'TX', 'tx', 'Grayson County', 'grayson-county', 'sherman'),
    ('cm7a0bgo6006cewvglp42v008', 'BELLS', 'TX', 'tx', 'Grayson County', 'grayson-county', 'bells'),
    ('cm7a0bgo6006fewvgzat3shzo', 'COLLINSVILLE', 'TX', 'tx', 'Grayson County', 'grayson-county', 'collinsville'),
    ('cm7a0bgo6006iewvghwubzbwc', 'DENISON', 'TX', 'tx', 'Grayson County', 'grayson-county', 'denison'),
    ('cm7a0bgo6006lewvgmpjtzgni', 'GUNTER', 'TX', 'tx', 'Grayson County', 'grayson-county', 'gunter'),
    ('cm7a0bgo6006oewvg03bkj3ek', 'HOWE', 'TX', 'tx', 'Grayson County', 'grayson-county', 'howe'),
    ('cm7a0bgo6006rewvgiy1dbnmy', 'POTTSBORO', 'TX', 'tx', 'Grayson County', 'grayson-county', 'pottsboro'),
    ('cm7a0bgo6006uewvgej3lbh3f', 'SHERMAN', 'TX', 'tx', 'Grayson County', 'grayson-county', 'sherman'),
    ('cm7a0bgo6006xewvgdisjtmoa', 'Southmayd', 'TX', 'tx', 'Grayson County', 'grayson-county', 'southmayd'),
    ('cm7a0bgo60070ewvg7ulp09uk', 'TIOGA', 'TX', 'tx', 'Grayson County', 'grayson-county', 'tioga'),
    ('cm7a0bgo60073ewvg9ghlja3p', 'TOM BEAN', 'TX', 'tx', 'Grayson County', 'grayson-county', 'tom-bean'),
    ('cm7a0bgo60076ewvg1wfmdsip', 'VAN ALSTYNE', 'TX', 'tx', 'Grayson County', 'grayson-county', 'van-alstyne'),
    ('cm7a0bgo60079ewvg7zz22bg6', 'WHITESBORO', 'TX', 'tx', 'Grayson County', 'grayson-county', 'whitesboro'),
    ('cm7a0bgo6007cewvgp24impnl', 'WHITEWRIGHT', 'TX', 'tx', 'Grayson County', 'grayson-county', 'whitewright'),
    ('cm7a0bgo6007fewvgk7ilv1v1', 'SHERMAN', 'TX', 'tx', 'Grayson County', 'grayson-county', 'sherman'),
    ('cm7a0bgo6007iewvgdj5573qw', 'Denison', 'TX', 'tx', 'Grayson County', 'grayson-county', 'denison'),
    ('cm7a0bgo6007lewvg6gzcryjg', 'VAN ALSTYNE', 'TX', 'tx', 'Grayson County', 'grayson-county', 'van-alstyne'),
    ('cm7a0bgo6007oewvgh35i3pn0', 'Whitewright', 'TX', 'tx', 'Grayson County', 'grayson-county', 'whitewright'),
    ('cm7a0bgo6007rewvg0itkwa3u', 'Howe', 'TX', 'tx', 'Grayson County', 'grayson-county', 'howe'),
    ('cm7a0bgo6007uewvgdhgo6uql', 'BELLS', 'TX', 'tx', 'Grayson County', 'grayson-county', 'bells'),
    ('cm7a0bgo6007xewvgs3z8v01i', 'WHITESBORO', 'TX', 'tx', 'Grayson County', 'grayson-county', 'whitesboro'),
    ('cm7a0bgo60080ewvg6i8mmfsr', 'GUNTER', 'TX', 'tx', 'Grayson County', 'grayson-county', 'gunter'),
    ('cm7a0bgo60083ewvg0wrdihvq', 'Sherman', 'TX', 'tx', 'Grayson County', 'grayson-county', 'sherman'),
    ('cm7a0bgo60086ewvg1l2ay8ty', 'TOM BEAN', 'TX', 'tx', 'Grayson County', 'grayson-county', 'tom-bean'),
    ('cm7a0bgo60088ewvg9hc2bhnv', 'Denison', 'TX', 'tx', 'Grayson County', 'grayson-county', 'denison'),
    ('cm7a0bgo6008aewvg9m93fvsi', 'COLLINSVILLE', 'TX', 'tx', 'Grayson County', 'grayson-county', 'collinsville'),
    ('cm7a0bgo6008cewvgmesk7hvx', 'SADLER', 'TX', 'tx', 'Grayson County', 'grayson-county', 'sadler'),
    ('cm7a0bgo6008eewvg0i3ym6pw', 'KILGORE', 'TX', 'tx', 'Gregg County', 'gregg-county', 'kilgore'),
    ('cm7a0bgo6008hewvgx2i2466j', 'Longview', 'TX', 'tx', 'Gregg County', 'gregg-county', 'longview'),
    ('cm7a0bgo6008jewvgw4gydibz', 'LONGVIEW', 'TX', 'tx', 'Gregg County', 'gregg-county', 'longview'),
    ('cm7a0bgo6008mewvg8blqeex5', 'LONGVIEW', 'TX', 'tx', 'Gregg County', 'gregg-county', 'longview'),
    ('cm7a0bgo6008pewvggixw8f65', 'LONGVIEW', 'TX', 'tx', 'Gregg County', 'gregg-county', 'longview'),
    ('cm7a0bgo6008sewvgspl592t8', 'Kilgore', 'TX', 'tx', 'Gregg County', 'gregg-county', 'kilgore'),
    ('cm7a0bgo6008uewvgb5htl1un', 'LONGVIEW', 'TX', 'tx', 'Gregg County', 'gregg-county', 'longview'),
    ('cm7a0bgo6008xewvgabky9a7m', 'LONGVIEW', 'TX', 'tx', 'Gregg County', 'gregg-county', 'longview'),
    ('cm7a0bgo60090ewvg6cjlpok5', 'GLADEWATER', 'TX', 'tx', 'Gregg County', 'gregg-county', 'gladewater'),
    ('cm7a0bgo60093ewvgia8t024m', 'KILGORE', 'TX', 'tx', 'Gregg County', 'gregg-county', 'kilgore'),
    ('cm7a0bgo60096ewvgt4v659uk', 'LONGVIEW', 'TX', 'tx', 'Gregg County', 'gregg-county', 'longview'),
    ('cm7a0bgo60099ewvgxf0ccoj8', 'LONGVIEW', 'TX', 'tx', 'Gregg County', 'gregg-county', 'longview'),
    ('cm7a0bgo6009cewvgelm8118t', 'WHITE OAK', 'TX', 'tx', 'Gregg County', 'gregg-county', 'white-oak'),
    ('cm7a0bgo6009fewvgf8hpbduw', 'LONGVIEW', 'TX', 'tx', 'Gregg County', 'gregg-county', 'longview'),
    ('cm7a0bgo6009iewvg1bh2woaj', 'ANDERSON', 'TX', 'tx', 'Grimes County', 'grimes-county', 'anderson'),
    ('cm7a0bgo6009lewvgipfr9d0q', 'Iola', 'TX', 'tx', 'Grimes County', 'grimes-county', 'iola'),
    ('cm7a0bgo6009oewvgyy3bfpvn', 'ANDERSON', 'TX', 'tx', 'Grimes County', 'grimes-county', 'anderson'),
    ('cm7a0bgo6009rewvgvbme8ccq', 'NAVASOTA', 'TX', 'tx', 'Grimes County', 'grimes-county', 'navasota'),
    ('cm7a0bgo6009uewvgqzys1ayx', 'ANDERSON', 'TX', 'tx', 'Grimes County', 'grimes-county', 'anderson'),
    ('cm7a0bgo6009wewvgmck70vem', 'NAVASOTA', 'TX', 'tx', 'Grimes County', 'grimes-county', 'navasota'),
    ('cm7a0bgo6009zewvgved4p5q7', 'TODD MISSION', 'TX', 'tx', 'Grimes County', 'grimes-county', 'todd-mission'),
    ('cm7a0bgo600a2ewvg16xns46k', 'SEGUIN', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'seguin'),
    ('cm7a0bgo600a5ewvgi3qjqdxn', 'Seguin', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'seguin'),
    ('cm7a0bgo600a8ewvg4sh99exu', 'SEGUIN', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'seguin'),
    ('cm7a0bgo600abewvgj67m2859', 'Seguin', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'seguin'),
    ('cm7a0bgo600aeewvg4ecx57do', 'Seguin', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'seguin'),
    ('cm7a0bgo600ahewvgkdm4gx6k', 'SCHERTZ', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'schertz'),
    ('cm7a0bgo600akewvgqzumwfef', 'SEGUIN', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'seguin'),
    ('cm7a0bgo600anewvghje8k2v8', 'SEGUIN', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'seguin'),
    ('cm7a0bgo600aqewvg86l3refr', 'Seguin', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'seguin'),
    ('cm7a0bgo600atewvgd9sbrmw2', 'CIBOLO', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'cibolo'),
    ('cm7a0bgo600awewvgoe4eo13c', 'MARION', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'marion'),
    ('cm7a0bgo600azewvg4r3p21vr', 'SCHERTZ', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'schertz'),
    ('cm7a0bgo600b2ewvgx2ephm8b', 'SEGUIN', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'seguin'),
    ('cm7a0bgo600b5ewvg2kryxscz', 'Staples', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'staples'),
    ('cm7a0bgo600b8ewvge2onber6', 'SEGUIN', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'seguin'),
    ('cm7a0bgo600bbewvgy520mp9n', 'Marion', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'marion'),
    ('cm7a0bgo600bdewvg72sur2db', 'LA VERNIA', 'TX', 'tx', 'Guadalupe County', 'guadalupe-county', 'la-vernia'),
    ('cm7a0bgo600bfewvgm7lkywas', 'PLAINVIEW', 'TX', 'tx', 'Hale County', 'hale-county', 'plainview'),
    ('cm7a0bgo600biewvggl08xlbp', 'Plainview', 'TX', 'tx', 'Hale County', 'hale-county', 'plainview'),
    ('cm7a0bgo600blewvg7icrvr66', 'PLAINVIEW', 'TX', 'tx', 'Hale County', 'hale-county', 'plainview'),
    ('cm7a0bgo600boewvgqd3h2zcb', 'Plainview', 'TX', 'tx', 'Hale County', 'hale-county', 'plainview'),
    ('cm7a0bgo600brewvgp5meq3rr', 'Abernathy', 'TX', 'tx', 'Hale County', 'hale-county', 'abernathy'),
    ('cm7a0bgo600buewvg5mw1nvx4', 'PLAINVIEW', 'TX', 'tx', 'Hale County', 'hale-county', 'plainview'),
    ('cm7a0bgo600bxewvgg8h741zq', 'ABERNATHY', 'TX', 'tx', 'Hale County', 'hale-county', 'abernathy'),
    ('cm7a0bgo600c0ewvgx1re8zot', 'Hale Center', 'TX', 'tx', 'Hale County', 'hale-county', 'hale-center'),
    ('cm7a0bgo700c3ewvgss0kj63o', 'PETERSBURG', 'TX', 'tx', 'Hale County', 'hale-county', 'petersburg'),
    ('cm7a0bgo700c6ewvg2c5s6u11', 'PLAINVIEW', 'TX', 'tx', 'Hale County', 'hale-county', 'plainview'),
    ('cm7a0bgo700c9ewvgkefgl0sd', 'Plainview', 'TX', 'tx', 'Hale County', 'hale-county', 'plainview'),
    ('cm7a0bgo700ccewvg1dribh3j', 'MEMPHIS', 'TX', 'tx', 'Hall County', 'hall-county', 'memphis'),
    ('cm7a0bgo700cfewvgtlgp7m13', 'ESTELLINE', 'TX', 'tx', 'Hall County', 'hall-county', 'estelline'),
    ('cm7a0bgo700ciewvgx6sm54bi', 'MEMPHIS', 'TX', 'tx', 'Hall County', 'hall-county', 'memphis'),
    ('cm7a0bgo700clewvg7qsz4v71', 'HAMILTON', 'TX', 'tx', 'Hamilton County', 'hamilton-county', 'hamilton'),
    ('cm7a0bgo700coewvg68m4ietn', 'Hamilton', 'TX', 'tx', 'Hamilton County', 'hamilton-county', 'hamilton'),
    ('cm7a0bgo700crewvg2m5rw3j6', 'MERIDIAN', 'TX', 'tx', 'Bosque County', 'bosque-county', 'meridian'),
    ('cm7a0bgo700cuewvg69lk2ziu', 'HICO', 'TX', 'tx', 'Hamilton County', 'hamilton-county', 'hico'),
    ('cm7a0bgo700cxewvgc3pk0j0a', 'JONESBORO', 'TX', 'tx', 'Coryell County', 'coryell-county', 'jonesboro'),
    ('cm7a0bgo700d0ewvgu34x2xx7', 'SPEARMAN', 'TX', 'tx', 'Hansford County', 'hansford-county', 'spearman'),
    ('cm7a0bgo700d3ewvgs0hq92bg', 'SPEARMAN', 'TX', 'tx', 'Hansford County', 'hansford-county', 'spearman'),
    ('cm7a0bgo700d6ewvgy62kzsrk', 'QUANAH', 'TX', 'tx', 'Hardeman County', 'hardeman-county', 'quanah'),
    ('cm7a0bgo700d9ewvg8wem01qz', 'Quanah', 'TX', 'tx', 'Hardeman County', 'hardeman-county', 'quanah'),
    ('cm7a0bgo700dcewvg3ttplt8z', 'CHILLICOTHE', 'TX', 'tx', 'Hardeman County', 'hardeman-county', 'chillicothe'),
    ('cm7a0bgo700dfewvg44sudmvv', 'KOUNTZE', 'TX', 'tx', 'Hardin County', 'hardin-county', 'kountze'),
    ('cm7a0bgo700diewvg48pxvzfn', 'Silsbee', 'TX', 'tx', 'Hardin County', 'hardin-county', 'silsbee'),
    ('cm7a0bgo700dlewvgd3i0osm4', 'Silsbee', 'TX', 'tx', 'Hardin County', 'hardin-county', 'silsbee'),
    ('cm7a0bgo700doewvgrxqyydic', 'Kountze', 'TX', 'tx', 'Hardin County', 'hardin-county', 'kountze'),
    ('cm7a0bgo700drewvg53nikxy5', 'Sour Lake', 'TX', 'tx', 'Hardin County', 'hardin-county', 'sour-lake'),
    ('cm7a0bgo700duewvgzijly98o', 'LUMBERTON', 'TX', 'tx', 'Hardin County', 'hardin-county', 'lumberton'),
    ('cm7a0bgo700dxewvgeh7nqlen', 'BATSON', 'TX', 'tx', 'Hardin County', 'hardin-county', 'batson'),
    ('cm7a0bgo700dzewvgk8gcpy4p', 'KOUNTZE', 'TX', 'tx', 'Hardin County', 'hardin-county', 'kountze'),
    ('cm7a0bgo700e2ewvgejigvmcm', 'KOUNTZE', 'TX', 'tx', 'Hardin County', 'hardin-county', 'kountze'),
    ('cm7a0bgo700e5ewvgvlrevi2e', 'KOUNTZE', 'TX', 'tx', 'Hardin County', 'hardin-county', 'kountze'),
    ('cm7a0bgo700e8ewvgxr0v43zb', 'LUMBERTON', 'TX', 'tx', 'Hardin County', 'hardin-county', 'lumberton'),
    ('cm7a0bgo700eaewvgiblk3cs2', 'SILSBEE', 'TX', 'tx', 'Hardin County', 'hardin-county', 'silsbee'),
    ('cm7a0bgo700edewvgc1n9yeqn', 'Sour Lake', 'TX', 'tx', 'Hardin County', 'hardin-county', 'sour-lake'),
    ('cm7a0bgo700egewvgx17vb7so', 'LUMBERTON', 'TX', 'tx', 'Hardin County', 'hardin-county', 'lumberton'),
    ('cm7a0bgo700ejewvg3d3b1k9r', 'Silsbee', 'TX', 'tx', 'Hardin County', 'hardin-county', 'silsbee'),
    ('cm7a0bgo700emewvgmrpl1rwu', 'SARATOGA', 'TX', 'tx', 'Hardin County', 'hardin-county', 'saratoga'),
    ('cm7a0bgo700epewvgo3gnev52', 'Kountze', 'TX', 'tx', 'Hardin County', 'hardin-county', 'kountze'),
    ('cm7a0bgo700erewvgfylqwwn8', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700euewvgg0z6mo3z', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700exewvg9d6ebfi9', 'PASADENA', 'TX', 'tx', 'Harris County', 'harris-county', 'pasadena'),
    ('cm7a0bgo700f0ewvguuft506w', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700f3ewvgue0nyicy', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700f6ewvgxvrb6yht', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700f9ewvgw7n891k5', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700fcewvgtxphje5e', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700ffewvgtkxx9k28', 'Houston', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700fhewvgo80lcx1k', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700fkewvgata0pnd2', 'Houston', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700fnewvgz3zy9wwc', 'Austin', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgo700fqewvgted8mkzj', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700ftewvg64n8wd0e', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700fvewvg6zxi5sh1', 'PASADENA', 'TX', 'tx', 'Harris County', 'harris-county', 'pasadena'),
    ('cm7a0bgo700fyewvgxw9qvae5', 'BAYTOWN', 'TX', 'tx', 'Harris County', 'harris-county', 'baytown'),
    ('cm7a0bgo700g1ewvg7tcl2yt7', 'SPRING', 'TX', 'tx', 'Harris County', 'harris-county', 'spring'),
    ('cm7a0bgo700g4ewvg2iy7oqub', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700g7ewvgdskueemm', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700gaewvg20dpls3b', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700gdewvg7bud6idp', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700ggewvgdocvr1yo', 'Houston', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700gjewvgkannxj0j', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700gmewvg8zrq4o4t', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700gpewvgwqybm3n5', 'Houston', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700gsewvgd2oxhjwx', 'BAYTOWN', 'TX', 'tx', 'Harris County', 'harris-county', 'baytown'),
    ('cm7a0bgo700gvewvguq6uzukg', 'BELLAIRE', 'TX', 'tx', 'Harris County', 'harris-county', 'bellaire'),
    ('cm7a0bgo700gyewvgvhirtvnf', 'DEER PARK', 'TX', 'tx', 'Harris County', 'harris-county', 'deer-park'),
    ('cm7a0bgo700h1ewvg41dlimuw', 'EL LAGO', 'TX', 'tx', 'Harris County', 'harris-county', 'el-lago'),
    ('cm7a0bgo700h4ewvgd59mmsux', 'GALENA PARK', 'TX', 'tx', 'Harris County', 'harris-county', 'galena-park'),
    ('cm7a0bgo700h7ewvgu61v0ctv', 'CYPRESS', 'TX', 'tx', 'Harris County', 'harris-county', 'cypress'),
    ('cm7a0bgo700haewvg7ybcg851', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700hdewvgrj1a22yw', 'HUMBLE', 'TX', 'tx', 'Harris County', 'harris-county', 'humble'),
    ('cm7a0bgo700hgewvg752fb5ar', 'JACINTO CITY', 'TX', 'tx', 'Harris County', 'harris-county', 'jacinto-city'),
    ('cm7a0bgo700hjewvgkxrm1xra', 'JERSEY VILLAGE', 'TX', 'tx', 'Harris County', 'harris-county', 'jersey-village'),
    ('cm7a0bgo700hmewvgjspkbz1x', 'KATY', 'TX', 'tx', 'Harris County', 'harris-county', 'katy'),
    ('cm7a0bgo700hpewvgzmkzlydg', 'LA PORTE', 'TX', 'tx', 'Harris County', 'harris-county', 'la-porte'),
    ('cm7a0bgo700hsewvg9omp0g44', 'MISSOURI CITY', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'missouri-city'),
    ('cm7a0bgo700hvewvgrctve14o', 'LA PORTE', 'TX', 'tx', 'Harris County', 'harris-county', 'la-porte'),
    ('cm7a0bgo700hyewvgssdun684', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700i1ewvg75ufiej5', 'PASADENA', 'TX', 'tx', 'Harris County', 'harris-county', 'pasadena'),
    ('cm7a0bgo700i4ewvgi88sa5vs', 'SEABROOK', 'TX', 'tx', 'Harris County', 'harris-county', 'seabrook'),
    ('cm7a0bgo700i7ewvg6xf6zfsz', 'SHOREACRES', 'TX', 'tx', 'Harris County', 'harris-county', 'shoreacres'),
    ('cm7a0bgo700iaewvg517iaykf', 'SOUTH HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'south-houston'),
    ('cm7a0bgo700idewvgr1d8la5r', 'Houston', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700igewvg3d3xd1q7', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo700ijewvgs5q7dm1x', 'TOMBALL', 'TX', 'tx', 'Harris County', 'harris-county', 'tomball'),
    ('cm7a0bgo700imewvggunmo91d', 'WEBSTER', 'TX', 'tx', 'Harris County', 'harris-county', 'webster'),
    ('cm7a0bgo800ipewvg36rre5in', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo800isewvgegfpsqe3', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo800ivewvgy4dst70z', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo800iyewvgu24jfwzn', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo800j1ewvgg969zrag', 'BAYTOWN', 'TX', 'tx', 'Harris County', 'harris-county', 'baytown'),
    ('cm7a0bgo800j4ewvg3yfwsvy0', 'BELLAIRE', 'TX', 'tx', 'Harris County', 'harris-county', 'bellaire'),
    ('cm7a0bgo800j7ewvgu2vwn0ti', 'Seabrook', 'TX', 'tx', 'Harris County', 'harris-county', 'seabrook'),
    ('cm7a0bgo800jaewvgq3j3k0zh', 'DEER PARK', 'TX', 'tx', 'Harris County', 'harris-county', 'deer-park'),
    ('cm7a0bgo800jdewvgrn1errhg', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo800jgewvgr6wz69jp', 'HUMBLE', 'TX', 'tx', 'Harris County', 'harris-county', 'humble'),
    ('cm7a0bgo800jjewvgugp2e8vv', 'JERSEY VILLAGE', 'TX', 'tx', 'Harris County', 'harris-county', 'jersey-village'),
    ('cm7a0bgo800jmewvgaonyzmf4', 'LA PORTE', 'TX', 'tx', 'Harris County', 'harris-county', 'la-porte'),
    ('cm7a0bgo800jpewvgcrs5aazt', 'MISSOURI CITY', 'TX', 'tx', 'Fort Bend County', 'fort-bend-county', 'missouri-city'),
    ('cm7a0bgo800jsewvgenu3ns44', 'Nassau Bay', 'TX', 'tx', 'Harris County', 'harris-county', 'nassau-bay'),
    ('cm7a0bgo800jvewvgvmsrtgci', 'WEBSTER', 'TX', 'tx', 'Harris County', 'harris-county', 'webster'),
    ('cm7a0bgo800jyewvg11t2e17s', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo800k1ewvgm4xtspya', 'BAYTOWN', 'TX', 'tx', 'Harris County', 'harris-county', 'baytown'),
    ('cm7a0bgo800k4ewvg9cv5zrhd', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo800k7ewvg40tjy8zb', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo800kaewvgxeuhewrf', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo800kdewvg2880wrqg', 'Houston', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo800kgewvg9npyr804', 'BAYTOWN', 'TX', 'tx', 'Harris County', 'harris-county', 'baytown'),
    ('cm7a0bgo800kjewvgutpfgcsm', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo800kmewvg6bq1izrv', 'KATY', 'TX', 'tx', 'Harris County', 'harris-county', 'katy'),
    ('cm7a0bgo800kpewvgr9wg1f4r', 'PASADENA', 'TX', 'tx', 'Harris County', 'harris-county', 'pasadena'),
    ('cm7a0bgo800ksewvgqvprgzc8', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgo800kvewvgfq37i2aw', 'SPRING', 'TX', 'tx', 'Harris County', 'harris-county', 'spring'),
    ('cm7a0bgo800kyewvgs3bfb467', 'HUMBLE', 'TX', 'tx', 'Harris County', 'harris-county', 'humble'),
    ('cm7a0bgo800l1ewvg23w03i5y', 'ALIEF', 'TX', 'tx', 'Harris County', 'harris-county', 'alief'),
    ('cm7a0bgo800l4ewvgv2e577jm', 'Huffman', 'TX', 'tx', 'Harris County', 'harris-county', 'huffman'),
    ('cm7a0bgo800l7ewvgbpfrg9qo', 'Marshall', 'TX', 'tx', 'Harrison County', 'harrison-county', 'marshall'),
    ('cm7a0bgo800laewvgr1snhzq5', 'Marshall', 'TX', 'tx', 'Harrison County', 'harrison-county', 'marshall'),
    ('cm7a0bgo800ldewvg9mx2coqk', 'MARSHALL', 'TX', 'tx', 'Harrison County', 'harrison-county', 'marshall'),
    ('cm7a0bgo800lgewvg7yt1hw75', 'WASKOM', 'TX', 'tx', 'Harrison County', 'harrison-county', 'waskom'),
    ('cm7a0bgo800ljewvguxtbp8dd', 'MARSHALL', 'TX', 'tx', 'Harrison County', 'harrison-county', 'marshall'),
    ('cm7a0bgo800llewvgeimbv1ud', 'Hallsville', 'TX', 'tx', 'Harrison County', 'harrison-county', 'hallsville'),
    ('cm7a0bgo800loewvge47xwekm', 'MARSHALL', 'TX', 'tx', 'Harrison County', 'harrison-county', 'marshall'),
    ('cm7a0bgo800lrewvgzmt7xmqc', 'MARSHALL', 'TX', 'tx', 'Harrison County', 'harrison-county', 'marshall'),
    ('cm7a0bgo800luewvguqu3kpaa', 'HALLSVILLE', 'TX', 'tx', 'Harrison County', 'harrison-county', 'hallsville'),
    ('cm7a0bgo800lxewvg7uh7k5ly', 'MARSHALL', 'TX', 'tx', 'Harrison County', 'harrison-county', 'marshall'),
    ('cm7a0bgo800m0ewvg1lksm0gn', 'WASKOM', 'TX', 'tx', 'Harrison County', 'harrison-county', 'waskom'),
    ('cm7a0bgo800m3ewvglv7t11js', 'Hallsville', 'TX', 'tx', 'Harrison County', 'harrison-county', 'hallsville'),
    ('cm7a0bgo800m6ewvgi5qptlst', 'MARSHALL', 'TX', 'tx', 'Harrison County', 'harrison-county', 'marshall'),
    ('cm7a0bgo800m9ewvgnlvucmei', 'ELYSIAN FIELDS', 'TX', 'tx', 'Harrison County', 'harrison-county', 'elysian-fields'),
    ('cm7a0bgo800mbewvgk5z1cbyt', 'CHANNING', 'TX', 'tx', 'Hartley County', 'hartley-county', 'channing'),
    ('cm7a0bgo800meewvg9ikfolfj', 'Haskell', 'TX', 'tx', 'Haskell County', 'haskell-county', 'haskell'),
    ('cm7a0bgo800mhewvgajdlibe7', 'HASKELL', 'TX', 'tx', 'Haskell County', 'haskell-county', 'haskell'),
    ('cm7a0bgo800mkewvg992xtyhr', 'HASKELL', 'TX', 'tx', 'Haskell County', 'haskell-county', 'haskell'),
    ('cm7a0bgo800mnewvgjh3ijtos', 'HASKELL', 'TX', 'tx', 'Haskell County', 'haskell-county', 'haskell'),
    ('cm7a0bgo800mqewvguu7e9bfm', 'SAN MARCOS', 'TX', 'tx', 'Hays County', 'hays-county', 'san-marcos'),
    ('cm7a0bgo800mtewvggzt81a92', 'SAN MARCOS', 'TX', 'tx', 'Hays County', 'hays-county', 'san-marcos'),
    ('cm7a0bgo800mwewvg8a8zta35', 'SAN MARCOS', 'TX', 'tx', 'Hays County', 'hays-county', 'san-marcos'),
    ('cm7a0bgo800mzewvge6xhqthb', 'KYLE', 'TX', 'tx', 'Hays County', 'hays-county', 'kyle'),
    ('cm7a0bgo800n2ewvghnhk4tl3', 'WIMBERLEY', 'TX', 'tx', 'Hays County', 'hays-county', 'wimberley'),
    ('cm7a0bgo800n5ewvglodw0b2c', 'DRIPPING SPRINGS', 'TX', 'tx', 'Hays County', 'hays-county', 'dripping-springs'),
    ('cm7a0bgo800n8ewvgppt1kslt', 'BUDA', 'TX', 'tx', 'Travis County', 'travis-county', 'buda'),
    ('cm7a0bgo800nbewvgid11m25w', 'SAN MARCOS', 'TX', 'tx', 'Hays County', 'hays-county', 'san-marcos'),
    ('cm7a0bgo800neewvgys0m1z23', 'SAN MARCOS', 'TX', 'tx', 'Hays County', 'hays-county', 'san-marcos'),
    ('cm7a0bgo800nhewvgpzkn40mq', 'KYLE', 'TX', 'tx', 'Hays County', 'hays-county', 'kyle'),
    ('cm7a0bgo800nkewvg92mvmt9s', 'SAN MARCOS', 'TX', 'tx', 'Hays County', 'hays-county', 'san-marcos'),
    ('cm7a0bgo800nnewvgl168ani1', 'BUDA', 'TX', 'tx', 'Hays County', 'hays-county', 'buda'),
    ('cm7a0bgo800nqewvggzia74x6', 'SAN MARCOS', 'TX', 'tx', 'Hays County', 'hays-county', 'san-marcos'),
    ('cm7a0bgo800ntewvgxuvdoffq', 'WIMBERLEY', 'TX', 'tx', 'Hays County', 'hays-county', 'wimberley'),
    ('cm7a0bgo800nwewvgo918bwxg', 'CANADIAN', 'TX', 'tx', 'Hemphill County', 'hemphill-county', 'canadian'),
    ('cm7a0bgo800nzewvgxp6flfn8', 'ATHENS', 'TX', 'tx', 'Henderson County', 'henderson-county', 'athens'),
    ('cm7a0bgo800o2ewvg2vcgqmt7', 'ATHENS', 'TX', 'tx', 'Henderson County', 'henderson-county', 'athens'),
    ('cm7a0bgo800o5ewvgq8bcce43', 'Athens', 'TX', 'tx', 'Henderson County', 'henderson-county', 'athens'),
    ('cm7a0bgo800o8ewvgqdz5j6tk', 'SEVEN POINTS', 'TX', 'tx', 'Henderson County', 'henderson-county', 'seven-points'),
    ('cm7a0bgo800obewvg9zqmfd8r', 'Chandler', 'TX', 'tx', 'Henderson County', 'henderson-county', 'chandler'),
    ('cm7a0bgo800oeewvg8kgkdj5m', 'Larue', 'TX', 'tx', 'Henderson County', 'henderson-county', 'larue'),
    ('cm7a0bgo800ohewvg9z24rpze', 'MALAKOFF', 'TX', 'tx', 'Henderson County', 'henderson-county', 'malakoff'),
    ('cm7a0bgo900okewvg0s50cujm', 'ATHENS', 'TX', 'tx', 'Henderson County', 'henderson-county', 'athens'),
    ('cm7a0bgo900onewvg0nbe6hgw', 'Athens', 'TX', 'tx', 'Henderson County', 'henderson-county', 'athens'),
    ('cm7a0bgo900oqewvgzipgcuv2', 'ATHENS', 'TX', 'tx', 'Henderson County', 'henderson-county', 'athens'),
    ('cm7a0bgo900otewvgrt6gjp8i', 'BROWNSBORO', 'TX', 'tx', 'Henderson County', 'henderson-county', 'brownsboro'),
    ('cm7a0bgo900owewvgs3ab3pgi', 'MALAKOFF', 'TX', 'tx', 'Henderson County', 'henderson-county', 'malakoff'),
    ('cm7a0bgo900ozewvg4mbu49wn', 'CHANDLER', 'TX', 'tx', 'Henderson County', 'henderson-county', 'chandler'),
    ('cm7a0bgo900p2ewvgtczovla1', 'EUSTACE', 'TX', 'tx', 'Henderson County', 'henderson-county', 'eustace'),
    ('cm7a0bgo900p5ewvgb1vxxqqv', 'GUN BARREL CITY', 'TX', 'tx', 'Henderson County', 'henderson-county', 'gun-barrel-city'),
    ('cm7a0bgo900p8ewvgyq6nrkvc', 'MALAKOFF', 'TX', 'tx', 'Henderson County', 'henderson-county', 'malakoff'),
    ('cm7a0bgo900pbewvgbwbvjxdj', 'SEVEN POINTS', 'TX', 'tx', 'Henderson County', 'henderson-county', 'seven-points'),
    ('cm7a0bgo900peewvg9vns04kb', 'MALAKOFF', 'TX', 'tx', 'Henderson County', 'henderson-county', 'malakoff'),
    ('cm7a0bgo900phewvg5x8j66xa', 'TOOL', 'TX', 'tx', 'Henderson County', 'henderson-county', 'tool'),
    ('cm7a0bgo900pkewvgo226affi', 'TRINIDAD', 'TX', 'tx', 'Henderson County', 'henderson-county', 'trinidad'),
    ('cm7a0bgo900pnewvgxtm0g17y', 'MABANK', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'mabank'),
    ('cm7a0bgo900pqewvgto3s8ymo', 'LOG CABIN', 'TX', 'tx', 'Henderson County', 'henderson-county', 'log-cabin'),
    ('cm7a0bgo900ptewvgotxki0i1', 'MABANK', 'TX', 'tx', 'Henderson County', 'henderson-county', 'mabank'),
    ('cm7a0bgo900pwewvgw4qs2em0', 'GUN BARREL CITY', 'TX', 'tx', 'Henderson County', 'henderson-county', 'gun-barrel-city'),
    ('cm7a0bgo900pzewvguinei0wu', 'ATHENS', 'TX', 'tx', 'Henderson County', 'henderson-county', 'athens'),
    ('cm7a0bgo900q2ewvgxamhgm22', 'ATHENS', 'TX', 'tx', 'Henderson County', 'henderson-county', 'athens'),
    ('cm7a0bgo900q4ewvgykk6zru1', 'MALAKOFF', 'TX', 'tx', 'Henderson County', 'henderson-county', 'malakoff'),
    ('cm7a0bgo900q7ewvgih7drttr', 'BROWNSBORO', 'TX', 'tx', 'Henderson County', 'henderson-county', 'brownsboro'),
    ('cm7a0bgo900qaewvghgf8yyyy', 'EUSTACE', 'TX', 'tx', 'Henderson County', 'henderson-county', 'eustace'),
    ('cm7a0bgo900qdewvg7b41od9e', 'LaRue', 'TX', 'tx', 'Henderson County', 'henderson-county', 'larue'),
    ('cm7a0bgo900qgewvgyx2qqiym', 'MURCHISON', 'TX', 'tx', 'Henderson County', 'henderson-county', 'murchison'),
    ('cm7a0bgo900qiewvgvgyxcqqn', 'MCALLEN', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'mcallen'),
    ('cm7a0bgo900qlewvg54vig96q', 'Edinburg', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'edinburg'),
    ('cm7a0bgo900qoewvgc6ydt1zm', 'EDINBURG', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'edinburg'),
    ('cm7a0bgo900qrewvgu3s5tj0h', 'WESLACO', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'weslaco'),
    ('cm7a0bgo900quewvgm0cidzpv', 'PHARR', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'pharr'),
    ('cm7a0bgo900qxewvgy4zk74ml', 'MISSION', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'mission'),
    ('cm7a0bgo900r0ewvg3h4ih14e', 'EDINBURG', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'edinburg'),
    ('cm7a0bgo900r3ewvgptv5y9ra', 'ELSA', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'elsa'),
    ('cm7a0bgo900r6ewvgnybkzutl', 'Pharr', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'pharr'),
    ('cm7a0bgo900r9ewvgzu913734', 'EDINBURG', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'edinburg'),
    ('cm7a0bgo900rcewvgzw4d5yw7', 'ALAMO', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'alamo'),
    ('cm7a0bgo900rfewvg2zqrtovj', 'DONNA', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'donna'),
    ('cm7a0bgo900riewvg5zpzfwjn', 'EDCOUCH', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'edcouch'),
    ('cm7a0bgo900rlewvgpxze68l0', 'EDINBURG', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'edinburg'),
    ('cm7a0bgo900roewvgyjlegr4p', 'ELSA', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'elsa'),
    ('cm7a0bgo900rrewvgh2s11ejw', 'HIDALGO', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'hidalgo'),
    ('cm7a0bgo900ruewvgm0ssfvjd', 'LA JOYA', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'la-joya'),
    ('cm7a0bgo900rxewvgdkj0css5', 'La Villa', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'la-villa'),
    ('cm7a0bgo900s0ewvguj8tnosy', 'MCALLEN', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'mcallen'),
    ('cm7a0bgo900s3ewvgi7t7f44m', 'MERCEDES', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'mercedes'),
    ('cm7a0bgo900s6ewvgwap3gaze', 'MISSION', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'mission'),
    ('cm7a0bgo900s9ewvguc9h27ng', 'PALMHURST', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'palmhurst'),
    ('cm7a0bgo900scewvg7v5gzidr', 'PHARR', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'pharr'),
    ('cm7a0bgo900sfewvgz4nl7dvy', 'SAN JUAN', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'san-juan'),
    ('cm7a0bgo900siewvgdzcr27w2', 'WESLACO', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'weslaco'),
    ('cm7a0bgo900slewvgaulxk29y', 'ALTON', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'alton'),
    ('cm7a0bgo900soewvgxdvsrqn5', 'PALMVIEW', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'palmview'),
    ('cm7a0bgo900srewvgrq98uzi6', 'PROGRESO', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'progreso'),
    ('cm7a0bgo900suewvgmtdpb99z', 'PENITAS', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'penitas'),
    ('cm7a0bgo900sxewvgmuh3hqzg', 'Sullivan City', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'sullivan-city'),
    ('cm7a0bgo900t0ewvgdhf5i16k', 'ALAMO', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'alamo'),
    ('cm7a0bgo900t3ewvgobw98hjk', 'Edinburg', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'edinburg'),
    ('cm7a0bgo900t6ewvg49c4cyrc', 'EDINBURG', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'edinburg'),
    ('cm7a0bgo900t9ewvgenxzqwwp', 'McAllen', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'mcallen'),
    ('cm7a0bgo900tcewvgq0ymgljt', 'MISSION', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'mission'),
    ('cm7a0bgo900tfewvg5jl3mkue', 'PHARR', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'pharr'),
    ('cm7a0bgo900tiewvghxh1ic6i', 'WESLACO', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'weslaco'),
    ('cm7a0bgo900tlewvg7zk0l8c6', 'ALTON', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'alton'),
    ('cm7a0bgo900toewvg9wkntf25', 'Edinburg', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'edinburg'),
    ('cm7a0bgo900trewvgaw6agxlt', 'San Juan', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'san-juan'),
    ('cm7a0bgo900tuewvguobbouui', 'EDINBURG', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'edinburg'),
    ('cm7a0bgo900txewvgkvy30zel', 'MCALLEN', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'mcallen'),
    ('cm7a0bgo900u0ewvgo6qu1c1q', 'DONNA', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'donna'),
    ('cm7a0bgo900u2ewvgbiruu6tz', 'PALMVIEW', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'palmview'),
    ('cm7a0bgo900u5ewvgydo6dohk', 'ALAMO', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'alamo'),
    ('cm7a0bgo900u8ewvg9bgy506c', 'MERCEDES', 'TX', 'tx', 'Hidalgo County', 'hidalgo-county', 'mercedes'),
    ('cm7a0bgo900uaewvg6atto8w9', 'Hillsboro', 'TX', 'tx', 'Hill County', 'hill-county', 'hillsboro'),
    ('cm7a0bgo900udewvg90bainxw', 'HILLSBORO', 'TX', 'tx', 'Hill County', 'hill-county', 'hillsboro'),
    ('cm7a0bgo900ugewvglmvbvl55', 'HILLSBORO', 'TX', 'tx', 'Hill County', 'hill-county', 'hillsboro'),
    ('cm7a0bgo900ujewvgsd9lcvg0', 'Whitney', 'TX', 'tx', 'Hill County', 'hill-county', 'whitney'),
    ('cm7a0bgo900ulewvgpvzuynz7', 'Hillsboro', 'TX', 'tx', 'Hill County', 'hill-county', 'hillsboro'),
    ('cm7a0bgo900uoewvg0w87v61r', 'Hillsboro', 'TX', 'tx', 'Hill County', 'hill-county', 'hillsboro'),
    ('cm7a0bgo900uqewvg1y2hps95', 'Hillsboro', 'TX', 'tx', 'Hill County', 'hill-county', 'hillsboro'),
    ('cm7a0bgo900usewvgkzvdsujf', 'HILLSBORO', 'TX', 'tx', 'Hill County', 'hill-county', 'hillsboro'),
    ('cm7a0bgoa00uvewvg5krhhdhx', 'HILLSBORO', 'TX', 'tx', 'Hill County', 'hill-county', 'hillsboro'),
    ('cm7a0bgoa00uyewvgm5r90bja', 'HUBBARD', 'TX', 'tx', 'Hill County', 'hill-county', 'hubbard'),
    ('cm7a0bgoa00v1ewvg18ct168z', 'ITASCA', 'TX', 'tx', 'Hill County', 'hill-county', 'itasca'),
    ('cm7a0bgoa00v4ewvg66sbjsl0', 'WHITNEY', 'TX', 'tx', 'Hill County', 'hill-county', 'whitney'),
    ('cm7a0bgoa00v7ewvgpntn3dsx', 'HILLSBORO', 'TX', 'tx', 'Hill County', 'hill-county', 'hillsboro'),
    ('cm7a0bgoa00vaewvgvpqyikjk', 'MOUNT CALM', 'TX', 'tx', 'Hill County', 'hill-county', 'mount-calm'),
    ('cm7a0bgoa00vdewvgxrti4px4', 'BLUM', 'TX', 'tx', 'Hill County', 'hill-county', 'blum'),
    ('cm7a0bgoa00vfewvgqjhwg7py', 'Aquilla', 'TX', 'tx', 'Hill County', 'hill-county', 'aquilla'),
    ('cm7a0bgoa00vhewvgfl6q74pg', 'COVINGTON', 'TX', 'tx', 'Hill County', 'hill-county', 'covington'),
    ('cm7a0bgoa00vjewvgfw0fvcba', 'LEVELLAND', 'TX', 'tx', 'Hockley County', 'hockley-county', 'levelland'),
    ('cm7a0bgoa00vmewvgfx8h4rrk', 'Levelland', 'TX', 'tx', 'Hockley County', 'hockley-county', 'levelland'),
    ('cm7a0bgoa00vpewvg6t1apj67', 'Levelland', 'TX', 'tx', 'Hockley County', 'hockley-county', 'levelland'),
    ('cm7a0bgoa00vsewvghlqs6u74', 'Levelland', 'TX', 'tx', 'Hockley County', 'hockley-county', 'levelland'),
    ('cm7a0bgoa00vvewvg5o6np975', 'SUNDOWN', 'TX', 'tx', 'Hockley County', 'hockley-county', 'sundown'),
    ('cm7a0bgoa00vxewvgss65a1wd', 'WITHARRAL', 'TX', 'tx', 'Hockley County', 'hockley-county', 'witharral'),
    ('cm7a0bgoa00w0ewvgd5wmav5i', 'LEVELLAND', 'TX', 'tx', 'Hockley County', 'hockley-county', 'levelland'),
    ('cm7a0bgoa00w3ewvgs37x83a4', 'LEVELLAND', 'TX', 'tx', 'Hockley County', 'hockley-county', 'levelland'),
    ('cm7a0bgoa00w6ewvgayy631se', 'ANTON', 'TX', 'tx', 'Hockley County', 'hockley-county', 'anton'),
    ('cm7a0bgoa00w9ewvg9l1icsir', 'LEVELLAND', 'TX', 'tx', 'Hockley County', 'hockley-county', 'levelland'),
    ('cm7a0bgoa00wcewvg9aq53pqk', 'SUNDOWN', 'TX', 'tx', 'Hockley County', 'hockley-county', 'sundown'),
    ('cm7a0bgoa00wfewvgcpkpx54a', 'LEVELLAND', 'TX', 'tx', 'Hockley County', 'hockley-county', 'levelland'),
    ('cm7a0bgoa00wiewvgcllioctz', 'ROPESVILLE', 'TX', 'tx', 'Hockley County', 'hockley-county', 'ropesville'),
    ('cm7a0bgoa00wlewvgbd182rmb', 'GRANBURY', 'TX', 'tx', 'Hood County', 'hood-county', 'granbury'),
    ('cm7a0bgoa00woewvgq63xy382', 'GRANBURY', 'TX', 'tx', 'Hood County', 'hood-county', 'granbury'),
    ('cm7a0bgoa00wrewvgwpzpf2hb', 'GRANBURY', 'TX', 'tx', 'Hood County', 'hood-county', 'granbury'),
    ('cm7a0bgoa00wuewvggecu779h', 'Granbury', 'TX', 'tx', 'Hood County', 'hood-county', 'granbury'),
    ('cm7a0bgoa00wxewvgrpf77y9c', 'Granbury', 'TX', 'tx', 'Hood County', 'hood-county', 'granbury'),
    ('cm7a0bgoa00x0ewvgwtex8i56', 'GRANBURY', 'TX', 'tx', 'Hood County', 'hood-county', 'granbury'),
    ('cm7a0bgoa00x3ewvg8t2s9em5', 'GRANBURY', 'TX', 'tx', 'Hood County', 'hood-county', 'granbury'),
    ('cm7a0bgoa00x6ewvgr75oz7dh', 'GRANBURY', 'TX', 'tx', 'Hood County', 'hood-county', 'granbury'),
    ('cm7a0bgoa00x9ewvgrf0ndsz0', 'Tolar', 'TX', 'tx', 'Hood County', 'hood-county', 'tolar'),
    ('cm7a0bgoa00xcewvgs7xr5ywo', 'LIPAN', 'TX', 'tx', 'Hood County', 'hood-county', 'lipan'),
    ('cm7a0bgoa00xfewvg29qh1phd', 'SULPHUR SPRINGS', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'sulphur-springs'),
    ('cm7a0bgoa00xiewvgv5o6iueu', 'SULPHUR SPRINGS', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'sulphur-springs'),
    ('cm7a0bgoa00xlewvg8jtef91e', 'SULPHUR SPRINGS', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'sulphur-springs'),
    ('cm7a0bgoa00xoewvg2xh9fvla', 'SULPHUR SPRINGS', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'sulphur-springs'),
    ('cm7a0bgoa00xrewvg8hnez6a3', 'SULPHUR SPRINGS', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'sulphur-springs'),
    ('cm7a0bgoa00xuewvgz315un1i', 'CUMBY', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'cumby'),
    ('cm7a0bgoa00xxewvg4t0144a8', 'SULPHUR SPRINGS', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'sulphur-springs'),
    ('cm7a0bgoa00y0ewvg8q9aef4s', 'Sulphur Springs', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'sulphur-springs'),
    ('cm7a0bgoa00y2ewvg5gk9bccn', 'SALTILLO', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'saltillo'),
    ('cm7a0bgoa00y5ewvgq94ai6lf', 'COMO', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'como'),
    ('cm7a0bgoa00y8ewvgzgv3wb1w', 'Cumby', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'cumby'),
    ('cm7a0bgoa00ybewvgh649moei', 'Cumby', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'cumby'),
    ('cm7a0bgoa00yeewvgs3yw16ap', 'Sulphur Springs', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'sulphur-springs'),
    ('cm7a0bgoa00yhewvgu9z1vvtc', 'Sulphur Bluff', 'TX', 'tx', 'Hopkins County', 'hopkins-county', 'sulphur-bluff'),
    ('cm7a0bgoa00ykewvg56i2ckxh', 'CROCKETT', 'TX', 'tx', 'Houston County', 'houston-county', 'crockett'),
    ('cm7a0bgoa00ynewvgysux5i8f', 'CROCKETT', 'TX', 'tx', 'Houston County', 'houston-county', 'crockett'),
    ('cm7a0bgoa00yqewvgs2py842q', 'CROCKETT', 'TX', 'tx', 'Houston County', 'houston-county', 'crockett'),
    ('cm7a0bgoa00ytewvgszgbqkr3', 'CROCKETT', 'TX', 'tx', 'Houston County', 'houston-county', 'crockett'),
    ('cm7a0bgoa00ywewvg210krwpp', 'CROCKETT', 'TX', 'tx', 'Houston County', 'houston-county', 'crockett'),
    ('cm7a0bgoa00yzewvgjz9fcu4y', 'CROCKETT', 'TX', 'tx', 'Houston County', 'houston-county', 'crockett'),
    ('cm7a0bgoa00z2ewvgjvf11k43', 'GRAPELAND', 'TX', 'tx', 'Houston County', 'houston-county', 'grapeland'),
    ('cm7a0bgoa00z5ewvgguvm6yme', 'CROCKETT', 'TX', 'tx', 'Houston County', 'houston-county', 'crockett'),
    ('cm7a0bgoa00z8ewvgf4s6m1c1', 'CROCKETT', 'TX', 'tx', 'Houston County', 'houston-county', 'crockett'),
    ('cm7a0bgoa00zbewvg27qkrr7q', 'LATEXO', 'TX', 'tx', 'Houston County', 'houston-county', 'latexo'),
    ('cm7a0bgoa00zeewvgld1rm3na', 'Lovelady', 'TX', 'tx', 'Houston County', 'houston-county', 'lovelady'),
    ('cm7a0bgoa00zhewvg9jxzmgh9', 'Crockett', 'TX', 'tx', 'Houston County', 'houston-county', 'crockett'),
    ('cm7a0bgoa00zkewvg57h9jl7n', 'Kennard', 'TX', 'tx', 'Houston County', 'houston-county', 'kennard'),
    ('cm7a0bgoa00znewvg3v7amnga', 'Grapeland', 'TX', 'tx', 'Houston County', 'houston-county', 'grapeland'),
    ('cm7a0bgoa00zpewvg3ceuvneh', 'Big Spring', 'TX', 'tx', 'Howard County', 'howard-county', 'big-spring'),
    ('cm7a0bgoa00zsewvgzfv484kh', 'Big Spring', 'TX', 'tx', 'Howard County', 'howard-county', 'big-spring'),
    ('cm7a0bgoa00zvewvg97ebsm96', 'BIG SPRING', 'TX', 'tx', 'Howard County', 'howard-county', 'big-spring'),
    ('cm7a0bgoa00zyewvga2h5bfup', 'BIG SPRING', 'TX', 'tx', 'Howard County', 'howard-county', 'big-spring'),
    ('cm7a0bgoa0100ewvgfc0olp44', 'BIG SPRING', 'TX', 'tx', 'Howard County', 'howard-county', 'big-spring'),
    ('cm7a0bgoa0103ewvgmhnrt13n', 'BIG SPRING', 'TX', 'tx', 'Howard County', 'howard-county', 'big-spring'),
    ('cm7a0bgoa0106ewvgo79jrzi0', 'BIG SPRING', 'TX', 'tx', 'Howard County', 'howard-county', 'big-spring'),
    ('cm7a0bgoa0109ewvgsyy9pwqy', 'SIERRA BLANCA', 'TX', 'tx', 'Hudspeth County', 'hudspeth-county', 'sierra-blanca'),
    ('cm7a0bgoa010cewvgqv4ons7u', 'SIERRA BLANCA', 'TX', 'tx', 'Hudspeth County', 'hudspeth-county', 'sierra-blanca'),
    ('cm7a0bgoa010fewvgnsxn81vr', 'Fort Hancock', 'TX', 'tx', 'Hudspeth County', 'hudspeth-county', 'fort-hancock'),
    ('cm7a0bgoa010iewvga3c785vt', 'El PASO', 'TX', 'tx', 'El Paso County', 'el-paso-county', 'el-paso'),
    ('cm7a0bgoa010lewvgtzfy6b49', 'COMMERCE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'commerce'),
    ('cm7a0bgoa010oewvga18c62c0', 'GREENVILLE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'greenville'),
    ('cm7a0bgoa010rewvgese07bz4', 'GREENVILLE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'greenville'),
    ('cm7a0bgoa010uewvge72o6nf9', 'Commerce', 'TX', 'tx', 'Hunt County', 'hunt-county', 'commerce'),
    ('cm7a0bgoa010xewvgcthksa0w', 'Wolfe City', 'TX', 'tx', 'Hunt County', 'hunt-county', 'wolfe-city'),
    ('cm7a0bgoa0110ewvgx4nc9rwt', 'QUINLAN', 'TX', 'tx', 'Hunt County', 'hunt-county', 'quinlan'),
    ('cm7a0bgob0113ewvgpmc1ysbj', 'GREENVILLE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'greenville'),
    ('cm7a0bgob0116ewvgraduh67d', 'GREENVILLE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'greenville'),
    ('cm7a0bgob0119ewvglkmqv97p', 'CADDO MILLS', 'TX', 'tx', 'Hunt County', 'hunt-county', 'caddo-mills'),
    ('cm7a0bgob011cewvgnqflhdcp', 'CELESTE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'celeste'),
    ('cm7a0bgob011fewvg3yemcduq', 'COMMERCE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'commerce'),
    ('cm7a0bgob011iewvgk9lksii3', 'GREENVILLE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'greenville'),
    ('cm7a0bgob011lewvgi33rzl0c', 'LONE OAK', 'TX', 'tx', 'Hunt County', 'hunt-county', 'lone-oak'),
    ('cm7a0bgob011oewvgwledl5rp', 'QUINLAN', 'TX', 'tx', 'Hunt County', 'hunt-county', 'quinlan'),
    ('cm7a0bgob011rewvgvzv99kya', 'WEST TAWAKONI', 'TX', 'tx', 'Hunt County', 'hunt-county', 'west-tawakoni'),
    ('cm7a0bgob011uewvgrbfwdpbe', 'WOLFE CITY', 'TX', 'tx', 'Hunt County', 'hunt-county', 'wolfe-city'),
    ('cm7a0bgob011xewvggui0qk2g', 'HAWK COVE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'hawk-cove'),
    ('cm7a0bgob0120ewvgi52fl141', 'COMMERCE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'commerce'),
    ('cm7a0bgob0123ewvgjs9yz4s9', 'GREENVILLE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'greenville'),
    ('cm7a0bgob0125ewvgxmwqlq73', 'GREENVILLE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'greenville'),
    ('cm7a0bgob0128ewvguwgopmb9', 'QUINLAN', 'TX', 'tx', 'Hunt County', 'hunt-county', 'quinlan'),
    ('cm7a0bgob012bewvgj4x1e801', 'COMMERCE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'commerce'),
    ('cm7a0bgob012eewvgo80p7utu', 'GREENVILLE', 'TX', 'tx', 'Hunt County', 'hunt-county', 'greenville'),
    ('cm7a0bgob012hewvgnssusuyi', 'Merit', 'TX', 'tx', 'Hunt County', 'hunt-county', 'merit'),
    ('cm7a0bgob012kewvgjj3p3pzx', 'CADDO MILLS', 'TX', 'tx', 'Hunt County', 'hunt-county', 'caddo-mills'),
    ('cm7a0bgob012newvgocivlmez', 'LONE OAK', 'TX', 'tx', 'Hunt County', 'hunt-county', 'lone-oak'),
    ('cm7a0bgob012qewvgcmu4rwd3', 'Borger', 'TX', 'tx', 'Hutchinson County', 'hutchinson-county', 'borger'),
    ('cm7a0bgob012tewvgfdca5gkk', 'BORGER', 'TX', 'tx', 'Hutchinson County', 'hutchinson-county', 'borger'),
    ('cm7a0bgob012wewvg522148dx', 'BORGER', 'TX', 'tx', 'Hutchinson County', 'hutchinson-county', 'borger'),
    ('cm7a0bgob012zewvgftx3bijn', 'STINNETT', 'TX', 'tx', 'Hutchinson County', 'hutchinson-county', 'stinnett'),
    ('cm7a0bgob0132ewvgk59ltkuk', 'BORGER', 'TX', 'tx', 'Hutchinson County', 'hutchinson-county', 'borger'),
    ('cm7a0bgob0135ewvg5faxppfy', 'STINNETT', 'TX', 'tx', 'Hutchinson County', 'hutchinson-county', 'stinnett'),
    ('cm7a0bgob0138ewvg0g7t6t8h', 'Borger', 'TX', 'tx', 'Hutchinson County', 'hutchinson-county', 'borger'),
    ('cm7a0bgob013bewvgex40tj4n', 'BORGER', 'TX', 'tx', 'Hutchinson County', 'hutchinson-county', 'borger'),
    ('cm7a0bgob013eewvghdqcgads', 'FRITCH', 'TX', 'tx', 'Hutchinson County', 'hutchinson-county', 'fritch'),
    ('cm7a0bgob013hewvg0yeiysbj', 'STINNETT', 'TX', 'tx', 'Hutchinson County', 'hutchinson-county', 'stinnett'),
    ('cm7a0bgob013kewvgrmiqbal3', 'MERTZON', 'TX', 'tx', 'Irion County', 'irion-county', 'mertzon'),
    ('cm7a0bgob013newvgwtjmtp7t', 'JACKSBORO', 'TX', 'tx', 'Jack County', 'jack-county', 'jacksboro'),
    ('cm7a0bgob013qewvg7q95hlqi', 'JACKSBORO', 'TX', 'tx', 'Jack County', 'jack-county', 'jacksboro'),
    ('cm7a0bgob013tewvg907xdbru', 'Jacksboro', 'TX', 'tx', 'Jack County', 'jack-county', 'jacksboro'),
    ('cm7a0bgob013wewvg5pd0itx0', 'JACKSBORO', 'TX', 'tx', 'Jack County', 'jack-county', 'jacksboro'),
    ('cm7a0bgob013zewvgz2jz4tdu', 'JACKSBORO', 'TX', 'tx', 'Jack County', 'jack-county', 'jacksboro'),
    ('cm7a0bgob0142ewvgtahzsnex', 'EDNA', 'TX', 'tx', 'Jackson County', 'jackson-county', 'edna'),
    ('cm7a0bgob0145ewvgf5firrkv', 'EDNA', 'TX', 'tx', 'Jackson County', 'jackson-county', 'edna'),
    ('cm7a0bgob0148ewvgv618n28i', 'GANADO', 'TX', 'tx', 'Jackson County', 'jackson-county', 'ganado'),
    ('cm7a0bgob014aewvg372j1th2', 'EDNA', 'TX', 'tx', 'Jackson County', 'jackson-county', 'edna'),
    ('cm7a0bgob014dewvgiv81a4zu', 'GANADO', 'TX', 'tx', 'Jackson County', 'jackson-county', 'ganado'),
    ('cm7a0bgob014gewvgvj4l4nzu', 'EDNA', 'TX', 'tx', 'Jackson County', 'jackson-county', 'edna'),
    ('cm7a0bgob014jewvgigxcqr3h', 'Jasper', 'TX', 'tx', 'Jasper County', 'jasper-county', 'jasper'),
    ('cm7a0bgob014mewvgslq4b7o1', 'JASPER', 'TX', 'tx', 'Jasper County', 'jasper-county', 'jasper'),
    ('cm7a0bgob014oewvgps3gtlf9', 'JASPER', 'TX', 'tx', 'Jasper County', 'jasper-county', 'jasper'),
    ('cm7a0bgob014rewvgjl5gk4yf', 'KIRBYVILLE', 'TX', 'tx', 'Jasper County', 'jasper-county', 'kirbyville'),
    ('cm7a0bgob014uewvgcw7b0my9', 'Buna', 'TX', 'tx', 'Jasper County', 'jasper-county', 'buna'),
    ('cm7a0bgob014xewvgokx1jiob', 'BROOKELAND', 'TX', 'tx', 'Jasper County', 'jasper-county', 'brookeland'),
    ('cm7a0bgob0150ewvgotz8clw3', 'EVADALE', 'TX', 'tx', 'Jasper County', 'jasper-county', 'evadale'),
    ('cm7a0bgob0153ewvg8ctp7bc5', 'JASPER', 'TX', 'tx', 'Jasper County', 'jasper-county', 'jasper'),
    ('cm7a0bgob0156ewvgepblvwgl', 'JASPER', 'TX', 'tx', 'Jasper County', 'jasper-county', 'jasper'),
    ('cm7a0bgob0159ewvgiph22oxz', 'KIRBYVILLE', 'TX', 'tx', 'Jasper County', 'jasper-county', 'kirbyville'),
    ('cm7a0bgob015cewvgrfcn3q8x', 'JASPER', 'TX', 'tx', 'Jasper County', 'jasper-county', 'jasper'),
    ('cm7a0bgob015fewvgwpe9ekp8', 'BUNA', 'TX', 'tx', 'Jasper County', 'jasper-county', 'buna'),
    ('cm7a0bgob015iewvg99guropc', 'Evadale', 'TX', 'tx', 'Jasper County', 'jasper-county', 'evadale'),
    ('cm7a0bgob015lewvgv49h3pbp', 'FORT DAVIS', 'TX', 'tx', 'Jeff Davis County', 'jeff-davis-county', 'fort-davis'),
    ('cm7a0bgob015oewvgs9jaohrn', 'FORT DAVIS', 'TX', 'tx', 'Jeff Davis County', 'jeff-davis-county', 'fort-davis'),
    ('cm7a0bgob015rewvgfexsxvnx', 'BEAUMONT', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'beaumont'),
    ('cm7a0bgob015uewvg4sq5gf1h', 'BEAUMONT', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'beaumont'),
    ('cm7a0bgob015xewvg8aj6x81c', 'BEAUMONT', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'beaumont'),
    ('cm7a0bgob0160ewvg7snjs9iu', 'PORT ARTHUR', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'port-arthur'),
    ('cm7a0bgob0163ewvgfil0mrk0', 'BEAUMONT', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'beaumont'),
    ('cm7a0bgob0166ewvglbgno4ab', 'BEAUMONT', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'beaumont'),
    ('cm7a0bgob0169ewvg1oos61iy', 'BEAUMONT', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'beaumont'),
    ('cm7a0bgob016cewvg3sw7vcur', 'PORT ARTHUR', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'port-arthur'),
    ('cm7a0bgob016fewvghzaq95se', 'BEAUMONT', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'beaumont'),
    ('cm7a0bgob016iewvg5jzc0vk1', 'BEAUMONT', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'beaumont'),
    ('cm7a0bgob016lewvg5nqwjxcd', 'GROVES', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'groves'),
    ('cm7a0bgob016oewvgcs1xn0ig', 'NEDERLAND', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'nederland'),
    ('cm7a0bgob016rewvg5l04ci35', 'PORT ARTHUR', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'port-arthur'),
    ('cm7a0bgob016uewvgevsk745y', 'PORT NECHES', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'port-neches'),
    ('cm7a0bgob016xewvghbtokdak', 'BEAUMONT', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'beaumont'),
    ('cm7a0bgob0170ewvgcqeqv68m', 'NEDERLAND', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'nederland'),
    ('cm7a0bgob0173ewvgjmqsx39t', 'PORT ARTHUR', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'port-arthur'),
    ('cm7a0bgob0176ewvgrhf6deme', 'BEAUMONT', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'beaumont'),
    ('cm7a0bgob0179ewvgff2j0zft', 'BEAUMONT', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'beaumont'),
    ('cm7a0bgob017cewvgxuvjxc7n', 'BEAUMONT', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'beaumont'),
    ('cm7a0bgoc017fewvgipviplce', 'PORT ARTHUR', 'TX', 'tx', 'Jefferson County', 'jefferson-county', 'port-arthur'),
    ('cm7a0bgoc017iewvg06zaft5g', 'HEBBRONVILLE', 'TX', 'tx', 'Jim Hogg County', 'jim-hogg-county', 'hebbronville'),
    ('cm7a0bgoc017lewvg7yc1d0o1', 'HEBBRONVILLE', 'TX', 'tx', 'Jim Hogg County', 'jim-hogg-county', 'hebbronville'),
    ('cm7a0bgoc017oewvgm2gvtj23', 'HEBBRONVILLE', 'TX', 'tx', 'Jim Hogg County', 'jim-hogg-county', 'hebbronville'),
    ('cm7a0bgoc017rewvg30grbenz', 'HEBBRONVILLE', 'TX', 'tx', 'Jim Hogg County', 'jim-hogg-county', 'hebbronville'),
    ('cm7a0bgoc017uewvgx73mmh5m', 'HEBBRONVILLE', 'TX', 'tx', 'Jim Hogg County', 'jim-hogg-county', 'hebbronville'),
    ('cm7a0bgoc017xewvgq910mz9f', 'HEBBRONVILLE', 'TX', 'tx', 'Jim Hogg County', 'jim-hogg-county', 'hebbronville'),
    ('cm7a0bgoc0180ewvg294onl8t', 'Alice', 'TX', 'tx', 'Jim Wells County', 'jim-wells-county', 'alice'),
    ('cm7a0bgoc0183ewvgi35pzh1v', 'ALICE', 'TX', 'tx', 'Jim Wells County', 'jim-wells-county', 'alice'),
    ('cm7a0bgoc0186ewvgiintlwp0', 'ALICE', 'TX', 'tx', 'Jim Wells County', 'jim-wells-county', 'alice'),
    ('cm7a0bgoc0189ewvgz642a6hf', 'SANDIA', 'TX', 'tx', 'Jim Wells County', 'jim-wells-county', 'sandia'),
    ('cm7a0bgoc018cewvgjh2v8qud', 'PREMONT', 'TX', 'tx', 'Jim Wells County', 'jim-wells-county', 'premont'),
    ('cm7a0bgoc018fewvgl0f7whfq', 'ORANGE GROVE', 'TX', 'tx', 'Jim Wells County', 'jim-wells-county', 'orange-grove'),
    ('cm7a0bgoc018iewvgifiy8wga', 'ALICE', 'TX', 'tx', 'Jim Wells County', 'jim-wells-county', 'alice'),
    ('cm7a0bgoc018lewvg17b914ok', 'ALICE', 'TX', 'tx', 'Jim Wells County', 'jim-wells-county', 'alice'),
    ('cm7a0bgoc018oewvg7rbdbyai', 'ALICE', 'TX', 'tx', 'Jim Wells County', 'jim-wells-county', 'alice'),
    ('cm7a0bgoc018rewvgmjrwvq4e', 'ORANGE GROVE', 'TX', 'tx', 'Jim Wells County', 'jim-wells-county', 'orange-grove'),
    ('cm7a0bgoc018uewvgtt4k7rvu', 'PREMONT', 'TX', 'tx', 'Jim Wells County', 'jim-wells-county', 'premont'),
    ('cm7a0bgoc018xewvgpujrzqjb', 'CLEBURNE', 'TX', 'tx', 'Johnson County', 'johnson-county', 'cleburne'),
    ('cm7a0bgoc0190ewvgoxgfazd1', 'CLEBURNE', 'TX', 'tx', 'Johnson County', 'johnson-county', 'cleburne'),
    ('cm7a0bgoc0193ewvgy85r5icu', 'BURLESON', 'TX', 'tx', 'Johnson County', 'johnson-county', 'burleson'),
    ('cm7a0bgoc0196ewvghm7l9tvd', 'ALVARADO', 'TX', 'tx', 'Johnson County', 'johnson-county', 'alvarado'),
    ('cm7a0bgoc0198ewvgyjcn4iia', 'CLEBURNE', 'TX', 'tx', 'Johnson County', 'johnson-county', 'cleburne'),
    ('cm7a0bgoc019bewvgad7d02ji', 'Burleson', 'TX', 'tx', 'Johnson County', 'johnson-county', 'burleson'),
    ('cm7a0bgoc019eewvg08j8tht2', 'CLEBURNE', 'TX', 'tx', 'Johnson County', 'johnson-county', 'cleburne'),
    ('cm7a0bgoc019hewvgq6zgimr8', 'CLEBURNE', 'TX', 'tx', 'Johnson County', 'johnson-county', 'cleburne'),
    ('cm7a0bgoc019kewvgg5bklm6f', 'Cleburne', 'TX', 'tx', 'Johnson County', 'johnson-county', 'cleburne'),
    ('cm7a0bgoc019mewvg2g70cxfj', 'ALVARADO', 'TX', 'tx', 'Johnson County', 'johnson-county', 'alvarado'),
    ('cm7a0bgoc019pewvgu7wrt7vm', 'BURLESON', 'TX', 'tx', 'Johnson County', 'johnson-county', 'burleson'),
    ('cm7a0bgoc019sewvggmgdk37u', 'CLEBURNE', 'TX', 'tx', 'Johnson County', 'johnson-county', 'cleburne'),
    ('cm7a0bgoc019vewvgomoqau8g', 'GODLEY', 'TX', 'tx', 'Johnson County', 'johnson-county', 'godley'),
    ('cm7a0bgoc019yewvgvxn96lym', 'GRANDVIEW', 'TX', 'tx', 'Johnson County', 'johnson-county', 'grandview'),
    ('cm7a0bgoc01a1ewvgl85mn4sd', 'JOSHUA', 'TX', 'tx', 'Johnson County', 'johnson-county', 'joshua'),
    ('cm7a0bgoc01a4ewvgjncg692e', 'KEENE', 'TX', 'tx', 'Johnson County', 'johnson-county', 'keene'),
    ('cm7a0bgoc01a7ewvgdavzadfg', 'RIO VISTA', 'TX', 'tx', 'Johnson County', 'johnson-county', 'rio-vista'),
    ('cm7a0bgoc01aaewvg6jkeivdp', 'VENUS', 'TX', 'tx', 'Johnson County', 'johnson-county', 'venus'),
    ('cm7a0bgoc01adewvguse32nbj', 'BURLESON', 'TX', 'tx', 'Johnson County', 'johnson-county', 'burleson'),
    ('cm7a0bgoc01agewvg6l326tgn', 'CLEBURNE', 'TX', 'tx', 'Johnson County', 'johnson-county', 'cleburne'),
    ('cm7a0bgoc01ajewvg8z25dau6', 'Joshua', 'TX', 'tx', 'Johnson County', 'johnson-county', 'joshua'),
    ('cm7a0bgoc01amewvgbt12u1wb', 'VENUS', 'TX', 'tx', 'Johnson County', 'johnson-county', 'venus'),
    ('cm7a0bgoc01apewvg0qsfcyer', 'CLEBURNE', 'TX', 'tx', 'Johnson County', 'johnson-county', 'cleburne'),
    ('cm7a0bgoc01asewvgxa2212py', 'Alvarado', 'TX', 'tx', 'Johnson County', 'johnson-county', 'alvarado'),
    ('cm7a0bgoc01avewvgzz8wzgwg', 'RIO VISTA', 'TX', 'tx', 'Johnson County', 'johnson-county', 'rio-vista'),
    ('cm7a0bgoc01ayewvg132f99k9', 'KEENE', 'TX', 'tx', 'Johnson County', 'johnson-county', 'keene'),
    ('cm7a0bgoc01b1ewvgexi7pt4n', 'Burleson', 'TX', 'tx', 'Johnson County', 'johnson-county', 'burleson'),
    ('cm7a0bgoc01b4ewvgnnjrjk3b', 'JOSHUA', 'TX', 'tx', 'Johnson County', 'johnson-county', 'joshua'),
    ('cm7a0bgoc01b7ewvgzd35b3i2', 'ALVARADO', 'TX', 'tx', 'Johnson County', 'johnson-county', 'alvarado'),
    ('cm7a0bgoc01baewvgca2v664i', 'Venus', 'TX', 'tx', 'Johnson County', 'johnson-county', 'venus'),
    ('cm7a0bgoc01bdewvgbvs1rapv', 'Godley', 'TX', 'tx', 'Johnson County', 'johnson-county', 'godley'),
    ('cm7a0bgoc01bgewvgrbfs7bmt', 'ANSON', 'TX', 'tx', 'Jones County', 'jones-county', 'anson'),
    ('cm7a0bgoc01biewvgocct341c', 'ANSON', 'TX', 'tx', 'Jones County', 'jones-county', 'anson'),
    ('cm7a0bgoc01blewvghf2jzix0', 'Anson', 'TX', 'tx', 'Jones County', 'jones-county', 'anson'),
    ('cm7a0bgoc01boewvgv8gys7jo', 'ANSON', 'TX', 'tx', 'Jones County', 'jones-county', 'anson'),
    ('cm7a0bgoc01brewvgtv1x09x0', 'Stamford', 'TX', 'tx', 'Jones County', 'jones-county', 'stamford'),
    ('cm7a0bgoc01buewvgcn7z7wfp', 'ANSON', 'TX', 'tx', 'Jones County', 'jones-county', 'anson'),
    ('cm7a0bgoc01bxewvgxde37yx2', 'HAMLIN', 'TX', 'tx', 'Jones County', 'jones-county', 'hamlin'),
    ('cm7a0bgoc01c0ewvg57ck5os5', 'HAWLEY', 'TX', 'tx', 'Jones County', 'jones-county', 'hawley'),
    ('cm7a0bgoc01c3ewvgpylb1vev', 'KARNES CITY', 'TX', 'tx', 'Karnes County', 'karnes-county', 'karnes-city'),
    ('cm7a0bgoc01c6ewvga7bsokxm', 'KENEDY', 'TX', 'tx', 'Karnes County', 'karnes-county', 'kenedy'),
    ('cm7a0bgoc01c8ewvgmto52ll1', 'Falls City', 'TX', 'tx', 'Karnes County', 'karnes-county', 'falls-city'),
    ('cm7a0bgoc01caewvgnoqn3kw3', 'KARNES CITY', 'TX', 'tx', 'Karnes County', 'karnes-county', 'karnes-city'),
    ('cm7a0bgoc01ccewvgwr4oa0tm', 'RUNGE', 'TX', 'tx', 'Karnes County', 'karnes-county', 'runge'),
    ('cm7a0bgoc01cfewvgc1ea2gop', 'KARNES CITY', 'TX', 'tx', 'Karnes County', 'karnes-county', 'karnes-city'),
    ('cm7a0bgoc01ciewvg84ixesyz', 'KENEDY', 'TX', 'tx', 'Karnes County', 'karnes-county', 'kenedy'),
    ('cm7a0bgoc01clewvgp0t04a1o', 'KARNES CITY', 'TX', 'tx', 'Karnes County', 'karnes-county', 'karnes-city'),
    ('cm7a0bgoc01coewvgke2vlbal', 'Kaufman', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'kaufman'),
    ('cm7a0bgoc01crewvgq72qchmd', 'Terrell', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'terrell'),
    ('cm7a0bgoc01cuewvgutloqhnz', 'KAUFMAN', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'kaufman'),
    ('cm7a0bgoc01cxewvg32t0hrz0', 'Kaufman', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'kaufman'),
    ('cm7a0bgoc01d0ewvg1o4le4p6', 'FORNEY', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'forney'),
    ('cm7a0bgoc01d3ewvgxht0dqpw', 'TERRELL', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'terrell'),
    ('cm7a0bgoc01d6ewvgokaoinyv', 'Kaufman', 'TX', 'tx', 'Red River County', 'red-river-county', 'kaufman'),
    ('cm7a0bgoc01d9ewvged3kz17i', 'KAUFMAN', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'kaufman'),
    ('cm7a0bgoc01dcewvgp7qk9sol', 'COMBINE', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'combine'),
    ('cm7a0bgoc01dfewvglds0e16l', 'CRANDALL', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'crandall'),
    ('cm7a0bgoc01diewvgjn9ou82x', 'FORNEY', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'forney'),
    ('cm7a0bgoc01dlewvgca1hrkle', 'KAUFMAN', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'kaufman'),
    ('cm7a0bgoc01doewvgwdo09hp5', 'KEMP', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'kemp'),
    ('cm7a0bgoc01drewvg8nzksjo5', 'MABANK', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'mabank'),
    ('cm7a0bgoc01duewvgvmo7w15f', 'TERRELL', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'terrell'),
    ('cm7a0bgoc01dxewvggoadjmob', 'FORNEY', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'forney'),
    ('cm7a0bgoc01e0ewvgskxn2x5e', 'Oak Ridge', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'oak-ridge'),
    ('cm7a0bgod01e3ewvg93a1wdie', 'SCURRY', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'scurry'),
    ('cm7a0bgod01e5ewvgbx0kmauu', 'KAUFMAN', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'kaufman'),
    ('cm7a0bgod01e7ewvg90x0l7gg', 'TERRELL', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'terrell'),
    ('cm7a0bgod01eaewvgdyac6tij', 'KEMP', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'kemp'),
    ('cm7a0bgod01edewvg609oy5pm', 'KAUFMAN', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'kaufman'),
    ('cm7a0bgod01efewvgna5abr0e', 'CRANDALL', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'crandall'),
    ('cm7a0bgod01eiewvg2ct87930', 'Mabank', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'mabank'),
    ('cm7a0bgod01elewvgnbq8tm4z', 'Scurry', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'scurry'),
    ('cm7a0bgod01eoewvg6g3ztpqg', 'FORNEY', 'TX', 'tx', 'Kaufman County', 'kaufman-county', 'forney'),
    ('cm7a0bgod01erewvgiav5fqua', 'BOERNE', 'TX', 'tx', 'Kendall County', 'kendall-county', 'boerne'),
    ('cm7a0bgod01euewvgflkiqbl6', 'BOERNE', 'TX', 'tx', 'Kendall County', 'kendall-county', 'boerne'),
    ('cm7a0bgod01exewvg1qh4imci', 'BOERNE', 'TX', 'tx', 'Kendall County', 'kendall-county', 'boerne'),
    ('cm7a0bgod01ezewvg7gqb0s5g', 'BOERNE', 'TX', 'tx', 'Kendall County', 'kendall-county', 'boerne'),
    ('cm7a0bgod01f2ewvg4z02z8z8', 'BOERNE', 'TX', 'tx', 'Kendall County', 'kendall-county', 'boerne'),
    ('cm7a0bgod01f5ewvgah4nohr5', 'COMFORT', 'TX', 'tx', 'Kendall County', 'kendall-county', 'comfort'),
    ('cm7a0bgod01f8ewvgmcivo5i4', 'Boerne', 'TX', 'tx', 'Kendall County', 'kendall-county', 'boerne'),
    ('cm7a0bgod01fbewvgw1ld3itp', 'BOERNE', 'TX', 'tx', 'Kendall County', 'kendall-county', 'boerne'),
    ('cm7a0bgod01fdewvgcxk912da', 'BOERNE', 'TX', 'tx', 'Kendall County', 'kendall-county', 'boerne'),
    ('cm7a0bgod01fgewvgyiv4n3hd', 'BOERNE', 'TX', 'tx', 'Kendall County', 'kendall-county', 'boerne'),
    ('cm7a0bgod01fjewvg81i9fkkc', 'SARITA', 'TX', 'tx', 'Kenedy County', 'kenedy-county', 'sarita'),
    ('cm7a0bgod01fmewvgpjwkdqxk', 'Sarita', 'TX', 'tx', 'Kenedy County', 'kenedy-county', 'sarita'),
    ('cm7a0bgod01foewvgtdkqnh64', 'JAYTON', 'TX', 'tx', 'Kent County', 'kent-county', 'jayton'),
    ('cm7a0bgod01frewvglazvq8f3', 'Kerrville', 'TX', 'tx', 'Kerr County', 'kerr-county', 'kerrville'),
    ('cm7a0bgod01fuewvgh5n2tal7', 'Kerrville', 'TX', 'tx', 'Kerr County', 'kerr-county', 'kerrville'),
    ('cm7a0bgod01fxewvgvf8u1h3d', 'KERRVILLE', 'TX', 'tx', 'Kerr County', 'kerr-county', 'kerrville'),
    ('cm7a0bgod01g0ewvg1a0rl371', 'KERRVILLE', 'TX', 'tx', 'Kerr County', 'kerr-county', 'kerrville'),
    ('cm7a0bgod01g3ewvgbn8wqpw3', 'KERRVILLE', 'TX', 'tx', 'Kerr County', 'kerr-county', 'kerrville'),
    ('cm7a0bgod01g6ewvgsuxi0b1h', 'KERRVILLE', 'TX', 'tx', 'Kerr County', 'kerr-county', 'kerrville'),
    ('cm7a0bgod01g9ewvgt8lo5yhp', 'INGRAM', 'TX', 'tx', 'Kerr County', 'kerr-county', 'ingram'),
    ('cm7a0bgod01gcewvgc6br38a2', 'KERRVILLE', 'TX', 'tx', 'Kerr County', 'kerr-county', 'kerrville'),
    ('cm7a0bgod01gfewvgu0w0uc70', 'KERRVILLE', 'TX', 'tx', 'Kerr County', 'kerr-county', 'kerrville'),
    ('cm7a0bgod01giewvgoe42l9bm', 'KERRVILLE', 'TX', 'tx', 'Kerr County', 'kerr-county', 'kerrville'),
    ('cm7a0bgod01glewvg44fkq98d', 'INGRAM', 'TX', 'tx', 'Kerr County', 'kerr-county', 'ingram'),
    ('cm7a0bgod01goewvghyers7f8', 'KERRVILLE', 'TX', 'tx', 'Kerr County', 'kerr-county', 'kerrville'),
    ('cm7a0bgod01grewvg2xxijk71', 'CENTER POINT', 'TX', 'tx', 'Kerr County', 'kerr-county', 'center-point'),
    ('cm7a0bgod01guewvgtwg9qrrd', 'Ingram', 'TX', 'tx', 'Kerr County', 'kerr-county', 'ingram'),
    ('cm7a0bgod01gxewvgjyn8dqk7', 'JUNCTION', 'TX', 'tx', 'Kimble County', 'kimble-county', 'junction'),
    ('cm7a0bgod01h0ewvgf5cotads', 'KERRVILLE', 'TX', 'tx', 'Kerr County', 'kerr-county', 'kerrville'),
    ('cm7a0bgod01h3ewvgh56s93zl', 'JUNCTION', 'TX', 'tx', 'Kimble County', 'kimble-county', 'junction'),
    ('cm7a0bgod01h6ewvgdfbphrsz', 'GUTHRIE', 'TX', 'tx', 'King County', 'king-county', 'guthrie'),
    ('cm7a0bgod01h9ewvgwx13u204', 'BRACKETTVILLE', 'TX', 'tx', 'Kinney County', 'kinney-county', 'brackettville'),
    ('cm7a0bgod01hcewvgwy6ript9', 'BRACKETTVILLE', 'TX', 'tx', 'Kinney County', 'kinney-county', 'brackettville'),
    ('cm7a0bgod01hfewvgl98uej7w', 'KINGSVILLE', 'TX', 'tx', 'Kleberg County', 'kleberg-county', 'kingsville'),
    ('cm7a0bgod01hiewvgj3x2tle4', 'KINGSVILLE', 'TX', 'tx', 'Kleberg County', 'kleberg-county', 'kingsville'),
    ('cm7a0bgod01hlewvg1zdkgm82', 'KINGSVILLE', 'TX', 'tx', 'Kleberg County', 'kleberg-county', 'kingsville'),
    ('cm7a0bgod01hoewvg6dktdvpx', 'Kinsgville', 'TX', 'tx', 'Kleberg County', 'kleberg-county', 'kinsgville'),
    ('cm7a0bgod01hrewvgntxss0i6', 'RIVIERA', 'TX', 'tx', 'Kleberg County', 'kleberg-county', 'riviera'),
    ('cm7a0bgod01huewvgxz3lfwly', 'KINGSVILLE', 'TX', 'tx', 'Kleberg County', 'kleberg-county', 'kingsville'),
    ('cm7a0bgod01hxewvgzo1tqoud', 'KINGSVILLE', 'TX', 'tx', 'Kleberg County', 'kleberg-county', 'kingsville'),
    ('cm7a0bgod01i0ewvgdjmqnnyq', 'Kingsville', 'TX', 'tx', 'Kleberg County', 'kleberg-county', 'kingsville'),
    ('cm7a0bgod01i3ewvg678bly8f', 'KINGSVILLE', 'TX', 'tx', 'Kleberg County', 'kleberg-county', 'kingsville'),
    ('cm7a0bgod01i6ewvgqr7f634h', 'BENJAMIN', 'TX', 'tx', 'Knox County', 'knox-county', 'benjamin'),
    ('cm7a0bgod01i9ewvgc8rj76y5', 'KNOX CITY', 'TX', 'tx', 'Knox County', 'knox-county', 'knox-city'),
    ('cm7a0bgod01icewvg7r72lszp', 'Munday', 'TX', 'tx', 'Knox County', 'knox-county', 'munday'),
    ('cm7a0bgod01ifewvg96pxerc6', 'PARIS', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01ihewvg2wefnmcw', 'Paris', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01ikewvgls5kq1w5', 'PARIS', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01inewvgf32rkjnt', 'PARIS', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01iqewvgen23q8dv', 'PARIS', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01itewvg070krdr5', 'PARIS', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01iwewvgfi2i27i3', 'PARIS', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01iyewvgp370pc21', 'PARIS', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01j1ewvgxx1rqcpl', 'PARIS', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01j4ewvg3jial21a', 'PARIS', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01j7ewvgewqtdygo', 'RENO', 'TX', 'tx', 'Lamar County', 'lamar-county', 'reno'),
    ('cm7a0bgod01jaewvgfq47w6w8', 'PARIS', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01jdewvguhx25pqr', 'PARIS', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01jgewvgg0szyxbr', 'PARIS', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01jjewvgwehoygqy', 'Paris', 'TX', 'tx', 'Lamar County', 'lamar-county', 'paris'),
    ('cm7a0bgod01jmewvghujg3ai9', 'Pattonville', 'TX', 'tx', 'Lamar County', 'lamar-county', 'pattonville'),
    ('cm7a0bgod01jpewvgylwkipb4', 'Littlefield', 'TX', 'tx', 'Lamb County', 'lamb-county', 'littlefield'),
    ('cm7a0bgod01jsewvg3ve5q6bq', 'LITTLEFIELD', 'TX', 'tx', 'Lamb County', 'lamb-county', 'littlefield'),
    ('cm7a0bgod01jvewvgkp7cmt4l', 'LITTLEFIELD', 'TX', 'tx', 'Lamb County', 'lamb-county', 'littlefield'),
    ('cm7a0bgod01jyewvgh1rnegaw', 'OLTON', 'TX', 'tx', 'Lamb County', 'lamb-county', 'olton'),
    ('cm7a0bgoe01k1ewvg60bmoa0f', 'SUDAN', 'TX', 'tx', 'Lamb County', 'lamb-county', 'sudan'),
    ('cm7a0bgoe01k4ewvg7uyyvpdd', 'Earth', 'TX', 'tx', 'Lamb County', 'lamb-county', 'earth'),
    ('cm7a0bgoe01k7ewvgv0xkykb3', 'SUDAN', 'TX', 'tx', 'Lamb County', 'lamb-county', 'sudan'),
    ('cm7a0bgoe01k9ewvgr3gx962o', 'LAMPASAS', 'TX', 'tx', 'Lampasas County', 'lampasas-county', 'lampasas'),
    ('cm7a0bgoe01kcewvgi0mn0u8n', 'LAMPASAS', 'TX', 'tx', 'Lampasas County', 'lampasas-county', 'lampasas'),
    ('cm7a0bgoe01kfewvgxi0kvklb', 'LOMETA', 'TX', 'tx', 'Lampasas County', 'lampasas-county', 'lometa'),
    ('cm7a0bgoe01khewvgfjxwv9ae', 'Kempner', 'TX', 'tx', 'Lampasas County', 'lampasas-county', 'kempner'),
    ('cm7a0bgoe01kjewvgb37xpsmz', 'LAMPASAS', 'TX', 'tx', 'Lampasas County', 'lampasas-county', 'lampasas'),
    ('cm7a0bgoe01kmewvgygsopcm5', 'LAMPASAS', 'TX', 'tx', 'Lampasas County', 'lampasas-county', 'lampasas'),
    ('cm7a0bgoe01kpewvgqpr9nfy3', 'LOMETA', 'TX', 'tx', 'Lampasas County', 'lampasas-county', 'lometa'),
    ('cm7a0bgoe01ksewvgiczup6rp', 'KEMPNER', 'TX', 'tx', 'Lampasas County', 'lampasas-county', 'kempner'),
    ('cm7a0bgoe01kvewvgu9ffnuek', 'COTULLA', 'TX', 'tx', 'La Salle County', 'la-salle-county', 'cotulla'),
    ('cm7a0bgoe01kyewvgcfw95fqz', 'Cotulla', 'TX', 'tx', 'La Salle County', 'la-salle-county', 'cotulla'),
    ('cm7a0bgoe01l1ewvglkq2dand', 'Encinal', 'TX', 'tx', 'La Salle County', 'la-salle-county', 'encinal'),
    ('cm7a0bgoe01l4ewvgx3jx4cz2', 'Cotulla', 'TX', 'tx', 'La Salle County', 'la-salle-county', 'cotulla'),
    ('cm7a0bgoe01l6ewvg2kcujmtl', 'Fowlerton', 'TX', 'tx', 'La Salle County', 'la-salle-county', 'fowlerton'),
    ('cm7a0bgoe01l8ewvgcsm9idfh', 'ENCINAL', 'TX', 'tx', 'La Salle County', 'la-salle-county', 'encinal'),
    ('cm7a0bgoe01lbewvgs4ci6jhb', 'HALLETTSVILLE', 'TX', 'tx', 'Lavaca County', 'lavaca-county', 'hallettsville'),
    ('cm7a0bgoe01leewvgaaubn6lb', 'HALLETTSVILLE', 'TX', 'tx', 'Lavaca County', 'lavaca-county', 'hallettsville'),
    ('cm7a0bgoe01lhewvggwiqmehj', 'MOULTON', 'TX', 'tx', 'Lavaca County', 'lavaca-county', 'moulton'),
    ('cm7a0bgoe01ljewvgabniws74', 'SHINER', 'TX', 'tx', 'Lavaca County', 'lavaca-county', 'shiner'),
    ('cm7a0bgoe01lmewvg738u8f6f', 'Yoakum', 'TX', 'tx', 'Lavaca County', 'lavaca-county', 'yoakum'),
    ('cm7a0bgoe01loewvgrouk4n3v', 'HALLETTSVILLE', 'TX', 'tx', 'Lavaca County', 'lavaca-county', 'hallettsville'),
    ('cm7a0bgoe01lrewvgw03epl8e', 'HALLETTSVILLE', 'TX', 'tx', 'Lavaca County', 'lavaca-county', 'hallettsville'),
    ('cm7a0bgoe01luewvg1vuq6159', 'MOULTON', 'TX', 'tx', 'Lavaca County', 'lavaca-county', 'moulton'),
    ('cm7a0bgoe01lxewvgt470wkzq', 'SHINER', 'TX', 'tx', 'Lavaca County', 'lavaca-county', 'shiner'),
    ('cm7a0bgoe01m0ewvgnirvn256', 'YOAKUM', 'TX', 'tx', 'Lavaca County', 'lavaca-county', 'yoakum'),
    ('cm7a0bgoe01m3ewvgelgkl3lq', 'GIDDINGS', 'TX', 'tx', 'Lee County', 'lee-county', 'giddings'),
    ('cm7a0bgoe01m6ewvg3wkc4z52', 'GIDDINGS', 'TX', 'tx', 'Lee County', 'lee-county', 'giddings'),
    ('cm7a0bgoe01m9ewvgv2iccnze', 'LEXINGTON', 'TX', 'tx', 'Lee County', 'lee-county', 'lexington'),
    ('cm7a0bgoe01mcewvga030mewr', 'DIMEBOX', 'TX', 'tx', 'Lee County', 'lee-county', 'dimebox'),
    ('cm7a0bgoe01mfewvg2tezzp99', 'GIDDINGS', 'TX', 'tx', 'Lee County', 'lee-county', 'giddings'),
    ('cm7a0bgoe01miewvgcseybdcp', 'LEXINGTON', 'TX', 'tx', 'Lee County', 'lee-county', 'lexington'),
    ('cm7a0bgoe01mlewvgxghcgaev', 'CENTERVILLE', 'TX', 'tx', 'Leon County', 'leon-county', 'centerville'),
    ('cm7a0bgoe01moewvgzr3du4qj', 'Buffalo', 'TX', 'tx', 'Leon County', 'leon-county', 'buffalo'),
    ('cm7a0bgoe01mqewvgcaohyryz', 'CENTERVILLE', 'TX', 'tx', 'Leon County', 'leon-county', 'centerville'),
    ('cm7a0bgoe01mtewvgcoxelktd', 'Marquez', 'TX', 'tx', 'Leon County', 'leon-county', 'marquez'),
    ('cm7a0bgoe01mwewvg7ul5869y', 'CENTERVILLE', 'TX', 'tx', 'Leon County', 'leon-county', 'centerville'),
    ('cm7a0bgoe01mzewvg697mxnnx', 'BUFFALO', 'TX', 'tx', 'Leon County', 'leon-county', 'buffalo'),
    ('cm7a0bgoe01n2ewvg6mo7717t', 'JEWETT', 'TX', 'tx', 'Leon County', 'leon-county', 'jewett'),
    ('cm7a0bgoe01n5ewvgqpszsbyw', 'Normangee', 'TX', 'tx', 'Leon County', 'leon-county', 'normangee'),
    ('cm7a0bgoe01n8ewvgn6sqfp5d', 'OAKWOOD', 'TX', 'tx', 'Leon County', 'leon-county', 'oakwood'),
    ('cm7a0bgoe01naewvgy23lp3a3', 'JEWETT', 'TX', 'tx', 'Leon County', 'leon-county', 'jewett'),
    ('cm7a0bgoe01ncewvgrx0oy62n', 'Normangee', 'TX', 'tx', 'Leon County', 'leon-county', 'normangee'),
    ('cm7a0bgoe01nfewvgxon1ji8l', 'Buffalo', 'TX', 'tx', 'Leon County', 'leon-county', 'buffalo'),
    ('cm7a0bgoe01niewvg8luchkkg', 'CENTERVILLE', 'TX', 'tx', 'Leon County', 'leon-county', 'centerville'),
    ('cm7a0bgoe01nlewvg48lm7xu4', 'Oakwood', 'TX', 'tx', 'Leon County', 'leon-county', 'oakwood'),
    ('cm7a0bgoe01nnewvgcuwryhs3', 'LIBERTY', 'TX', 'tx', 'Liberty County', 'liberty-county', 'liberty'),
    ('cm7a0bgoe01nqewvg47q1366h', 'LIBERTY', 'TX', 'tx', 'Liberty County', 'liberty-county', 'liberty'),
    ('cm7a0bgoe01ntewvg5fcwrlop', 'Liberty', 'TX', 'tx', 'Liberty County', 'liberty-county', 'liberty'),
    ('cm7a0bgoe01nwewvgwpo23bvl', 'DAISETTA', 'TX', 'tx', 'Liberty County', 'liberty-county', 'daisetta'),
    ('cm7a0bgoe01nzewvg1ipkgiu1', 'Liberty', 'TX', 'tx', 'Liberty County', 'liberty-county', 'liberty'),
    ('cm7a0bgoe01o1ewvgoob7uphf', 'Dayton', 'TX', 'tx', 'Liberty County', 'liberty-county', 'dayton'),
    ('cm7a0bgoe01o4ewvgv43n9p32', 'CLEVELAND', 'TX', 'tx', 'Liberty County', 'liberty-county', 'cleveland'),
    ('cm7a0bgoe01o7ewvgvp5yochv', 'CLEVELAND', 'TX', 'tx', 'Liberty County', 'liberty-county', 'cleveland'),
    ('cm7a0bgoe01oaewvge5zhrtz5', 'LIBERTY', 'TX', 'tx', 'Liberty County', 'liberty-county', 'liberty'),
    ('cm7a0bgoe01odewvgxrq4qf4r', 'Liberty', 'TX', 'tx', 'Liberty County', 'liberty-county', 'liberty'),
    ('cm7a0bgoe01ogewvg7qptxrz7', 'CLEVELAND', 'TX', 'tx', 'Liberty County', 'liberty-county', 'cleveland'),
    ('cm7a0bgoe01ojewvg5x58oylo', 'DAISETTA', 'TX', 'tx', 'Liberty County', 'liberty-county', 'daisetta'),
    ('cm7a0bgoe01omewvgctjdboij', 'DAYTON', 'TX', 'tx', 'Liberty County', 'liberty-county', 'dayton'),
    ('cm7a0bgoe01opewvg649yidl3', 'LIBERTY', 'TX', 'tx', 'Liberty County', 'liberty-county', 'liberty'),
    ('cm7a0bgoe01osewvgz54bltd5', 'CLEVELAND', 'TX', 'tx', 'Liberty County', 'liberty-county', 'cleveland'),
    ('cm7a0bgoe01ovewvgm5nu3tb3', 'LIBERTY', 'TX', 'tx', 'Liberty County', 'liberty-county', 'liberty'),
    ('cm7a0bgoe01oxewvgt8vcjnl1', 'Cleveland', 'TX', 'tx', 'Liberty County', 'liberty-county', 'cleveland'),
    ('cm7a0bgoe01p0ewvgqkkp63ob', 'GROESBECK', 'TX', 'tx', 'Limestone County', 'limestone-county', 'groesbeck'),
    ('cm7a0bgoe01p3ewvgobxk3059', 'GROESBECK', 'TX', 'tx', 'Limestone County', 'limestone-county', 'groesbeck'),
    ('cm7a0bgoe01p6ewvg7867uamy', 'COOLIDGE', 'TX', 'tx', 'Limestone County', 'limestone-county', 'coolidge'),
    ('cm7a0bgoe01p9ewvgqg8j97v9', 'Groesbeck', 'TX', 'tx', 'Limestone County', 'limestone-county', 'groesbeck'),
    ('cm7a0bgoe01pcewvg9usppdra', 'MEXIA', 'TX', 'tx', 'Limestone County', 'limestone-county', 'mexia'),
    ('cm7a0bgoe01peewvghhvs8mfv', 'GROESBECK', 'TX', 'tx', 'Limestone County', 'limestone-county', 'groesbeck'),
    ('cm7a0bgoe01phewvgvyhpkmsx', 'GROESBECK', 'TX', 'tx', 'Limestone County', 'limestone-county', 'groesbeck'),
    ('cm7a0bgoe01pjewvgf5ye6zlu', 'COOLIDGE', 'TX', 'tx', 'Limestone County', 'limestone-county', 'coolidge'),
    ('cm7a0bgoe01pmewvglus4v5dc', 'Groesbeck', 'TX', 'tx', 'Limestone County', 'limestone-county', 'groesbeck'),
    ('cm7a0bgoe01ppewvg7jm66jep', 'KOSSE', 'TX', 'tx', 'Limestone County', 'limestone-county', 'kosse'),
    ('cm7a0bgoe01psewvggirlt44n', 'MEXIA', 'TX', 'tx', 'Limestone County', 'limestone-county', 'mexia'),
    ('cm7a0bgoe01pvewvgzd7lhrpj', 'THORNTON', 'TX', 'tx', 'Limestone County', 'limestone-county', 'thornton'),
    ('cm7a0bgoe01pyewvglgjnciwd', 'MEXIA', 'TX', 'tx', 'Limestone County', 'limestone-county', 'mexia'),
    ('cm7a0bgoe01q1ewvg14hgrrrc', 'LIPSCOMB', 'TX', 'tx', 'Lipscomb County', 'lipscomb-county', 'lipscomb'),
    ('cm7a0bgoe01q4ewvgu1a04cnp', 'BOOKER', 'TX', 'tx', 'Lipscomb County', 'lipscomb-county', 'booker'),
    ('cm7a0bgoe01q7ewvg0ci4iyr9', 'GEORGE WEST', 'TX', 'tx', 'Live Oak County', 'live-oak-county', 'george-west'),
    ('cm7a0bgof01qaewvgu1j3ixit', 'Sandia', 'TX', 'tx', 'Live Oak County', 'live-oak-county', 'sandia'),
    ('cm7a0bgof01qdewvg1ws2pfl3', 'THREE RIVERS', 'TX', 'tx', 'Live Oak County', 'live-oak-county', 'three-rivers'),
    ('cm7a0bgof01qfewvgtoj256wl', 'GEORGE WEST', 'TX', 'tx', 'Live Oak County', 'live-oak-county', 'george-west'),
    ('cm7a0bgof01qhewvgo6s86uda', 'George West', 'TX', 'tx', 'Live Oak County', 'live-oak-county', 'george-west'),
    ('cm7a0bgof01qjewvgi6s5v00s', 'GEORGE WEST', 'TX', 'tx', 'Live Oak County', 'live-oak-county', 'george-west'),
    ('cm7a0bgof01qmewvglticat1f', 'THREE RIVERS', 'TX', 'tx', 'Live Oak County', 'live-oak-county', 'three-rivers'),
    ('cm7a0bgof01qpewvgqs9xuros', 'LLANO', 'TX', 'tx', 'Llano County', 'llano-county', 'llano'),
    ('cm7a0bgof01qsewvgglxd0bvc', 'HORSESHOE BAY', 'TX', 'tx', 'Llano County', 'llano-county', 'horseshoe-bay'),
    ('cm7a0bgof01qvewvg0q4smh2c', 'Buchanan Dam', 'TX', 'tx', 'Llano County', 'llano-county', 'buchanan-dam'),
    ('cm7a0bgof01qyewvgxlwirqrm', 'Buchanan Dam', 'TX', 'tx', 'Llano County', 'llano-county', 'buchanan-dam'),
    ('cm7a0bgof01r1ewvgyktp9ncg', 'LLANO', 'TX', 'tx', 'Llano County', 'llano-county', 'llano'),
    ('cm7a0bgof01r4ewvguzf1rvs6', 'LLANO', 'TX', 'tx', 'Llano County', 'llano-county', 'llano'),
    ('cm7a0bgof01r7ewvg432km6uy', 'Burnet', 'TX', 'tx', 'Burnet County', 'burnet-county', 'burnet'),
    ('cm7a0bgof01raewvgj9aav54w', 'LLANO', 'TX', 'tx', 'Llano County', 'llano-county', 'llano'),
    ('cm7a0bgof01rdewvgb3pe5lk7', 'SUNRISE BEACH', 'TX', 'tx', 'Llano County', 'llano-county', 'sunrise-beach'),
    ('cm7a0bgof01rgewvggo7imbj7', 'HORSESHOE BAY', 'TX', 'tx', 'Llano County', 'llano-county', 'horseshoe-bay'),
    ('cm7a0bgof01rjewvg0soxgup1', 'Llano', 'TX', 'tx', 'Llano County', 'llano-county', 'llano'),
    ('cm7a0bgof01rmewvg45xxv49g', 'MENTONE', 'TX', 'tx', 'Loving County', 'loving-county', 'mentone'),
    ('cm7a0bgof01rpewvgpwzpc7om', 'MENTONE', 'TX', 'tx', 'Loving County', 'loving-county', 'mentone'),
    ('cm7a0bgof01rsewvgntmclnsu', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01rvewvgovdfdi3b', 'Lubbock', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01ryewvgaxca6d75', 'Lubbock', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01s1ewvg3d1urgpk', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01s4ewvg8xxdsacj', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01s7ewvg60ascmaj', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01saewvgrlkbr7zo', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01sdewvge2rzhgnx', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01sgewvgiu1fkywr', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01sjewvgq4tn6mu7', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01smewvgnz3mnzw5', 'Lubbock', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01spewvg25v0yzdl', 'IDALOU', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'idalou'),
    ('cm7a0bgof01ssewvgth3ywvkj', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01svewvghau6596n', 'NEW DEAL', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'new-deal'),
    ('cm7a0bgof01syewvgpn6ty8oc', 'SHALLOWATER', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'shallowater'),
    ('cm7a0bgof01t1ewvgfsgk80dc', 'SLATON', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'slaton'),
    ('cm7a0bgof01t4ewvghl04btbq', 'WOLFFORTH', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'wolfforth'),
    ('cm7a0bgof01t7ewvgbg7v7flu', 'RANSOM CANYON', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'ransom-canyon'),
    ('cm7a0bgof01taewvgf3m1u8n7', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01tdewvgqujsm3qc', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01tgewvgv1eqius8', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01tjewvgdtaidm17', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01tmewvg373w66do', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01toewvgvxesyx55', 'WOLFFORTH', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'wolfforth'),
    ('cm7a0bgof01trewvg37blrlb6', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01tuewvgzyprao8o', 'SHALLOWATER', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'shallowater'),
    ('cm7a0bgof01txewvgpgba2kd0', 'Lubbock', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01u0ewvgrweibfgh', 'Slaton', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'slaton'),
    ('cm7a0bgof01u3ewvgxxzykd8s', 'Idalou', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'idalou'),
    ('cm7a0bgof01u6ewvgogvzixa6', 'LUBBOCK', 'TX', 'tx', 'Lubbock County', 'lubbock-county', 'lubbock'),
    ('cm7a0bgof01u8ewvgnrshn592', 'Tahoka', 'TX', 'tx', 'Lynn County', 'lynn-county', 'tahoka'),
    ('cm7a0bgof01ubewvgk5tvqlgv', 'TAHOKA', 'TX', 'tx', 'Lynn County', 'lynn-county', 'tahoka'),
    ('cm7a0bgof01ueewvgc9a9xvwa', 'O''DONNELL', 'TX', 'tx', 'Lynn County', 'lynn-county', 'o-donnell'),
    ('cm7a0bgof01uhewvgiprbf94i', 'TAHOKA', 'TX', 'tx', 'Lynn County', 'lynn-county', 'tahoka'),
    ('cm7a0bgof01ukewvg6wps2wtz', 'TAHOKA', 'TX', 'tx', 'Lynn County', 'lynn-county', 'tahoka'),
    ('cm7a0bgof01unewvg9itwswjk', 'WILSON', 'TX', 'tx', 'Lynn County', 'lynn-county', 'wilson'),
    ('cm7a0bgof01uqewvg1v8j72ck', 'ODONNELL', 'TX', 'tx', 'Lynn County', 'lynn-county', 'odonnell'),
    ('cm7a0bgof01utewvg0njjmwds', 'WILSON', 'TX', 'tx', 'Lynn County', 'lynn-county', 'wilson'),
    ('cm7a0bgof01uvewvg8bwuswt8', 'BRADY', 'TX', 'tx', 'McCulloch County', 'mcculloch-county', 'brady'),
    ('cm7a0bgof01uyewvgb5i7mvtd', 'BRADY', 'TX', 'tx', 'McCulloch County', 'mcculloch-county', 'brady'),
    ('cm7a0bgof01v1ewvgl8e9x25n', 'BRADY', 'TX', 'tx', 'McCulloch County', 'mcculloch-county', 'brady'),
    ('cm7a0bgof01v4ewvgkqcwlrzb', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgof01v7ewvgzqlsapv7', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgof01vaewvgd4gs2v4l', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgof01vdewvglun6d5dt', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgof01vgewvgzdwq9ekd', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgof01vjewvgcpk1c2ln', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgof01vmewvg1vtce4dc', 'WEST', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'west'),
    ('cm7a0bgof01vpewvgtiwmeyna', 'McGregor', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'mcgregor'),
    ('cm7a0bgof01vsewvgjbuim4t1', 'Waco', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgof01vvewvgabf9bws7', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgof01vyewvgo894uvx9', 'BELLMEAD', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'bellmead'),
    ('cm7a0bgof01w1ewvguuyzkfbp', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgof01w4ewvgm4vlzrmc', 'CRAWFORD', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'crawford'),
    ('cm7a0bgof01w7ewvga8841m9f', 'HEWITT', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'hewitt'),
    ('cm7a0bgof01waewvgtpmrv812', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgof01wdewvgnqgbm4jb', 'LORENA', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'lorena'),
    ('cm7a0bgof01wgewvg2ilsqau2', 'MCGREGOR', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'mcgregor'),
    ('cm7a0bgof01wjewvgdkvz5ve0', 'MART', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'mart'),
    ('cm7a0bgog01wmewvgc9m33p6k', 'MOODY', 'TX', 'tx', 'Bell County', 'bell-county', 'moody'),
    ('cm7a0bgog01wpewvgj3u8wwb6', 'ROBINSON', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'robinson'),
    ('cm7a0bgog01wsewvg7bgs7lvs', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgog01wvewvgis6y9ly5', 'WEST', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'west'),
    ('cm7a0bgog01wyewvgxz8jaipm', 'WOODWAY', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'woodway'),
    ('cm7a0bgog01x1ewvgpb9i0xs2', 'EDDY', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'eddy'),
    ('cm7a0bgog01x4ewvgcraiz8et', 'RIESEL', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'riesel'),
    ('cm7a0bgog01x7ewvg2mruhi7b', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgog01xaewvglncxr7jp', 'Thornton', 'TX', 'tx', 'Limestone County', 'limestone-county', 'thornton'),
    ('cm7a0bgog01xdewvgwd6cdt0z', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgog01xgewvgu1apm4fm', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgog01xjewvgeuns4y4p', 'CHINA SPRING', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'china-spring'),
    ('cm7a0bgog01xmewvg0th5u2ft', 'Robinson', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'robinson'),
    ('cm7a0bgog01xpewvg44v6j712', 'WACO', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgog01xsewvg1uxvx1jk', 'Riesel', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'riesel'),
    ('cm7a0bgog01xvewvgo4ogsatl', 'WEST', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'west'),
    ('cm7a0bgog01xyewvggkaezuu1', 'Mart', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'mart'),
    ('cm7a0bgog01y1ewvgwmif73p6', 'Waco', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'waco'),
    ('cm7a0bgog01y4ewvgey4dsuxt', 'WOODWAY', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'woodway'),
    ('cm7a0bgog01y6ewvgk29umr61', 'Axtell', 'TX', 'tx', 'McLennan County', 'mclennan-county', 'axtell'),
    ('cm7a0bgog01y8ewvgmk2is9tx', 'TILDEN', 'TX', 'tx', 'McMullen County', 'mcmullen-county', 'tilden'),
    ('cm7a0bgog01ybewvguehnoju5', 'TILDEN', 'TX', 'tx', 'McMullen County', 'mcmullen-county', 'tilden'),
    ('cm7a0bgog01ydewvgw86657gd', 'MADISONVILLE', 'TX', 'tx', 'Madison County', 'madison-county', 'madisonville'),
    ('cm7a0bgog01ygewvgfd5749o1', 'MADISONVILLE', 'TX', 'tx', 'Madison County', 'madison-county', 'madisonville'),
    ('cm7a0bgog01yjewvgmdrkf4h8', 'MADISONVILLE', 'TX', 'tx', 'Madison County', 'madison-county', 'madisonville'),
    ('cm7a0bgog01ymewvgp2tu2kc2', 'MADISONVILLE', 'TX', 'tx', 'Madison County', 'madison-county', 'madisonville'),
    ('cm7a0bgog01ypewvgont4gnew', 'MADISONVILLE', 'TX', 'tx', 'Madison County', 'madison-county', 'madisonville'),
    ('cm7a0bgog01yrewvgj5tg867u', 'MADISONVILLE', 'TX', 'tx', 'Madison County', 'madison-county', 'madisonville'),
    ('cm7a0bgog01yuewvgzf2473e1', 'MADISONVILLE', 'TX', 'tx', 'Madison County', 'madison-county', 'madisonville'),
    ('cm7a0bgog01yxewvgi3yf737l', 'JEFFERSON', 'TX', 'tx', 'Marion County', 'marion-county', 'jefferson'),
    ('cm7a0bgog01z0ewvg7pygfte1', 'Jefferson', 'TX', 'tx', 'Marion County', 'marion-county', 'jefferson'),
    ('cm7a0bgog01z3ewvg14nch12n', 'JEFFERSON', 'TX', 'tx', 'Marion County', 'marion-county', 'jefferson'),
    ('cm7a0bgog01z5ewvg66twdj8n', 'Jefferson', 'TX', 'tx', 'Marion County', 'marion-county', 'jefferson'),
    ('cm7a0bgog01z7ewvgdd0l5ukm', 'JEFFERSON', 'TX', 'tx', 'Marion County', 'marion-county', 'jefferson'),
    ('cm7a0bgog01zaewvg05l1ssq6', 'JEFFERSON', 'TX', 'tx', 'Marion County', 'marion-county', 'jefferson'),
    ('cm7a0bgog01zdewvgibuacmx6', 'STANTON', 'TX', 'tx', 'Martin County', 'martin-county', 'stanton'),
    ('cm7a0bgog01zgewvg7dy1psug', 'STANTON', 'TX', 'tx', 'Martin County', 'martin-county', 'stanton'),
    ('cm7a0bgog01zjewvgviv9b1ch', 'MASON', 'TX', 'tx', 'Mason County', 'mason-county', 'mason'),
    ('cm7a0bgog01zmewvga7n4s61o', 'Mason', 'TX', 'tx', 'Runnels County', 'runnels-county', 'mason'),
    ('cm7a0bgog01zpewvgmfn5bbkw', 'BAY CITY', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'bay-city'),
    ('cm7a0bgog01zsewvghg5dxigw', 'BAY CITY', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'bay-city'),
    ('cm7a0bgog01zuewvgfze2nzim', 'BAY CITY', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'bay-city'),
    ('cm7a0bgog01zxewvgt7tnh72l', 'PALACIOS', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'palacios'),
    ('cm7a0bgog01zzewvgcp1ybgds', 'MARKHAM', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'markham'),
    ('cm7a0bgog0201ewvgsivpjf9y', 'BAY CITY', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'bay-city'),
    ('cm7a0bgog0203ewvgu3jyj92u', 'BAY CITY', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'bay-city'),
    ('cm7a0bgog0206ewvg5pm5u6jv', 'BAY CITY', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'bay-city'),
    ('cm7a0bgog0209ewvgi0m361pw', 'Palacios', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'palacios'),
    ('cm7a0bgog020cewvgk2ka1erw', 'BAY CITY', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'bay-city'),
    ('cm7a0bgog020fewvgbvebvew1', 'PALACIOS', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'palacios'),
    ('cm7a0bgog020iewvgr3y1tspm', 'EL MATON', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'el-maton'),
    ('cm7a0bgog020kewvge01ruvbo', 'Van Vleck', 'TX', 'tx', 'Matagorda County', 'matagorda-county', 'van-vleck'),
    ('cm7a0bgog020mewvg08ve6slp', 'EAGLE PASS', 'TX', 'tx', 'Maverick County', 'maverick-county', 'eagle-pass'),
    ('cm7a0bgog020oewvgukjg7hiq', 'EAGLE PASS', 'TX', 'tx', 'Maverick County', 'maverick-county', 'eagle-pass'),
    ('cm7a0bgog020rewvgsxw23sig', 'EAGLE PASS', 'TX', 'tx', 'Maverick County', 'maverick-county', 'eagle-pass'),
    ('cm7a0bgog020tewvgo0yvcznh', 'EAGLE PASS', 'TX', 'tx', 'Maverick County', 'maverick-county', 'eagle-pass'),
    ('cm7a0bgog020vewvgl1ilmpyb', 'EAGLE PASS', 'TX', 'tx', 'Maverick County', 'maverick-county', 'eagle-pass'),
    ('cm7a0bgog020xewvgotcpy2wc', 'Eagle Pass', 'TX', 'tx', 'Maverick County', 'maverick-county', 'eagle-pass'),
    ('cm7a0bgog020zewvg0kqjpwwl', 'Quemado', 'TX', 'tx', 'Maverick County', 'maverick-county', 'quemado'),
    ('cm7a0bgog0211ewvg9pcrnohy', 'EAGLE PASS', 'TX', 'tx', 'Maverick County', 'maverick-county', 'eagle-pass'),
    ('cm7a0bgog0213ewvgmv34xslp', 'EAGLE PASS', 'TX', 'tx', 'Maverick County', 'maverick-county', 'eagle-pass'),
    ('cm7a0bgog0216ewvg0pb2whep', 'EAGLE PASS', 'TX', 'tx', 'Maverick County', 'maverick-county', 'eagle-pass'),
    ('cm7a0bgog0219ewvggnmw23er', 'EAGLE PASS', 'TX', 'tx', 'Maverick County', 'maverick-county', 'eagle-pass'),
    ('cm7a0bgog021bewvgyv2ln2s2', 'EAGLE PASS', 'TX', 'tx', 'Maverick County', 'maverick-county', 'eagle-pass'),
    ('cm7a0bgog021eewvgsylhgtd1', 'EAGLE PASS', 'TX', 'tx', 'Maverick County', 'maverick-county', 'eagle-pass'),
    ('cm7a0bgog021hewvg2v6oja6z', 'Hondo', 'TX', 'tx', 'Medina County', 'medina-county', 'hondo'),
    ('cm7a0bgog021kewvgk3fucl89', 'HONDO', 'TX', 'tx', 'Medina County', 'medina-county', 'hondo'),
    ('cm7a0bgog021newvgtrlfefzn', 'HONDO', 'TX', 'tx', 'Medina County', 'medina-county', 'hondo'),
    ('cm7a0bgog021qewvgroinczzp', 'CASTROVILLE', 'TX', 'tx', 'Medina County', 'medina-county', 'castroville'),
    ('cm7a0bgog021tewvgiqp4v8jd', 'D''HANIS', 'TX', 'tx', 'Medina County', 'medina-county', 'd-hanis'),
    ('cm7a0bgog021vewvgmjkufmsk', 'DEVINE', 'TX', 'tx', 'Medina County', 'medina-county', 'devine'),
    ('cm7a0bgog021yewvgmhy495re', 'CASTROVILLE', 'TX', 'tx', 'Medina County', 'medina-county', 'castroville'),
    ('cm7a0bgog0221ewvgiuyduaay', 'DEVINE', 'TX', 'tx', 'Medina County', 'medina-county', 'devine'),
    ('cm7a0bgog0224ewvgeuoxhlir', 'HONDO', 'TX', 'tx', 'Medina County', 'medina-county', 'hondo'),
    ('cm7a0bgog0227ewvgcpg3zyuo', 'LA COSTE', 'TX', 'tx', 'Medina County', 'medina-county', 'la-coste'),
    ('cm7a0bgog0229ewvgbjlwhlxj', 'NATALIA', 'TX', 'tx', 'Medina County', 'medina-county', 'natalia'),
    ('cm7a0bgog022cewvgb12nt448', 'MENARD', 'TX', 'tx', 'Menard County', 'menard-county', 'menard'),
    ('cm7a0bgog022fewvg3jcrryh1', 'MENARD', 'TX', 'tx', 'Menard County', 'menard-county', 'menard'),
    ('cm7a0bgog022iewvgkecbwaam', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgog022lewvgzg3mrwtk', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgog022newvgnqy3loq1', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgog022qewvg9usryujh', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgoh022tewvg8smrdbbh', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgoh022wewvgics7t4s7', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgoh022zewvgfzc1oyt3', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgoh0232ewvg79qqdgtw', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgoh0235ewvg2bse26q8', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgoh0238ewvgfkxmyduq', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgoh023bewvggpg9bdvn', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgoh023eewvgczd5zg3b', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgoh023hewvgiia425rq', 'Midland', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgoh023kewvgv4cg4hxh', 'MIDLAND', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgoh023newvgqb6h7dve', 'Midland', 'TX', 'tx', 'Midland County', 'midland-county', 'midland'),
    ('cm7a0bgoh023qewvgmlmufo9t', 'CAMERON', 'TX', 'tx', 'Milam County', 'milam-county', 'cameron'),
    ('cm7a0bgoh023tewvgujdrlbvd', 'CAMERON', 'TX', 'tx', 'Milam County', 'milam-county', 'cameron'),
    ('cm7a0bgoh023vewvgb7oxai7m', 'CAMERON', 'TX', 'tx', 'Milam County', 'milam-county', 'cameron'),
    ('cm7a0bgoh023xewvgjd8hu2s8', 'Rockdale', 'TX', 'tx', 'Milam County', 'milam-county', 'rockdale'),
    ('cm7a0bgoh023zewvgny3494d3', 'THORNDALE', 'TX', 'tx', 'Milam County', 'milam-county', 'thorndale'),
    ('cm7a0bgoh0241ewvgva4920cj', 'CAMERON', 'TX', 'tx', 'Milam County', 'milam-county', 'cameron'),
    ('cm7a0bgoh0244ewvgf0fueevf', 'CAMERON', 'TX', 'tx', 'Milam County', 'milam-county', 'cameron'),
    ('cm7a0bgoh0247ewvgrl5rpngs', 'ROCKDALE', 'TX', 'tx', 'Milam County', 'milam-county', 'rockdale'),
    ('cm7a0bgoh024aewvgcgmigvox', 'THORNDALE', 'TX', 'tx', 'Milam County', 'milam-county', 'thorndale'),
    ('cm7a0bgoh024dewvg7bewko79', 'Buckholts', 'TX', 'tx', 'Milam County', 'milam-county', 'buckholts'),
    ('cm7a0bgoh024gewvgpe13ag6s', 'GOLDTHWAITE', 'TX', 'tx', 'Mills County', 'mills-county', 'goldthwaite'),
    ('cm7a0bgoh024jewvgyinkv3d2', 'COLORADO CITY', 'TX', 'tx', 'Mitchell County', 'mitchell-county', 'colorado-city'),
    ('cm7a0bgoh024mewvgx0781fyp', 'Colorado City', 'TX', 'tx', 'Mitchell County', 'mitchell-county', 'colorado-city'),
    ('cm7a0bgoh024oewvgsns4sp6z', 'COLORADO CITY', 'TX', 'tx', 'Mitchell County', 'mitchell-county', 'colorado-city'),
    ('cm7a0bgoh024rewvgdshkelgm', 'MONTAGUE', 'TX', 'tx', 'Montague County', 'montague-county', 'montague'),
    ('cm7a0bgoh024uewvg0syigefw', 'Montague', 'TX', 'tx', 'Montague County', 'montague-county', 'montague'),
    ('cm7a0bgoh024wewvg5owdii0i', 'Montague', 'TX', 'tx', 'Montague County', 'montague-county', 'montague'),
    ('cm7a0bgoh024yewvg4lh6y16t', 'MONTAGUE', 'TX', 'tx', 'Montague County', 'montague-county', 'montague'),
    ('cm7a0bgoh0251ewvgkenv4ebl', 'BOWIE', 'TX', 'tx', 'Montague County', 'montague-county', 'bowie'),
    ('cm7a0bgoh0254ewvg3ecq4d2z', 'NOCONA', 'TX', 'tx', 'Montague County', 'montague-county', 'nocona'),
    ('cm7a0bgoh0257ewvg69wf6mgc', 'SAINT JO', 'TX', 'tx', 'Montague County', 'montague-county', 'saint-jo'),
    ('cm7a0bgoh025aewvgp7bxdtfo', 'BOWIE', 'TX', 'tx', 'Montague County', 'montague-county', 'bowie'),
    ('cm7a0bgoh025dewvgbjvb0qdm', 'CONROE', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'conroe'),
    ('cm7a0bgoh025gewvgjrlj9va9', 'WILLIS', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'willis'),
    ('cm7a0bgoh025jewvgb8618gps', 'CONROE', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'conroe'),
    ('cm7a0bgoh025mewvg1cumgjm8', 'THE WOODLANDS', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'the-woodlands'),
    ('cm7a0bgoh025pewvgnszlr3hy', 'NEW CANEY', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'new-caney'),
    ('cm7a0bgoh025sewvg84o1bt6o', 'MAGNOLIA', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'magnolia'),
    ('cm7a0bgoh025vewvg2tmvegj9', 'CONROE', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'conroe'),
    ('cm7a0bgoh025yewvgku3xgx5m', 'CONROE', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'conroe'),
    ('cm7a0bgoh0261ewvgwmpoun4k', 'CONROE', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'conroe'),
    ('cm7a0bgoh0264ewvgtiiwn9sm', 'CONROE', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'conroe'),
    ('cm7a0bgoh0267ewvghrimghp7', 'CONROE', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'conroe'),
    ('cm7a0bgoh026aewvgjamplosz', 'MAGNOLIA', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'magnolia'),
    ('cm7a0bgoh026dewvgksdr1p3h', 'MONTGOMERY', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'montgomery'),
    ('cm7a0bgoh026gewvgqyddt1ci', 'PANORAMA', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'panorama'),
    ('cm7a0bgoh026jewvgjznlzoqt', 'SPLENDORA', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'splendora'),
    ('cm7a0bgoh026mewvgjrm3zs7m', 'SPLENDORA', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'splendora'),
    ('cm7a0bgoh026pewvgs45wqods', 'WILLIS', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'willis'),
    ('cm7a0bgoh026sewvgyryep8vh', 'NEW CANEY', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'new-caney'),
    ('cm7a0bgoh026vewvgd5cry6h4', 'Shenandoah', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'shenandoah'),
    ('cm7a0bgoh026yewvgugnawurb', 'ROMAN FOREST', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'roman-forest'),
    ('cm7a0bgoh0271ewvg9fd9118j', 'STAGECOACH', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'stagecoach'),
    ('cm7a0bgoh0274ewvgl0ci6txl', 'CONROE', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'conroe'),
    ('cm7a0bgoh0277ewvgvcbb7rvh', 'CONROE', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'conroe'),
    ('cm7a0bgoh027aewvg7qk3w6ej', 'CONROE', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'conroe'),
    ('cm7a0bgoh027dewvgprkhzl5r', 'NEW CANEY', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'new-caney'),
    ('cm7a0bgoh027gewvgftiysfnj', 'SPLENDORA', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'splendora'),
    ('cm7a0bgoh027jewvgw3p5xquc', 'MONTGOMERY', 'TX', 'tx', 'Montgomery County', 'montgomery-county', 'montgomery'),
    ('cm7a0bgoh027lewvgbd61xgfe', 'DUMAS', 'TX', 'tx', 'Moore County', 'moore-county', 'dumas'),
    ('cm7a0bgoh027oewvghi894uxl', 'DUMAS', 'TX', 'tx', 'Moore County', 'moore-county', 'dumas'),
    ('cm7a0bgoh027rewvgi742ad37', 'CACTUS', 'TX', 'tx', 'Moore County', 'moore-county', 'cactus'),
    ('cm7a0bgoh027uewvgkm18kv7x', 'DUMAS', 'TX', 'tx', 'Moore County', 'moore-county', 'dumas'),
    ('cm7a0bgoh027xewvgwu82r7lg', 'SUNRAY', 'TX', 'tx', 'Moore County', 'moore-county', 'sunray'),
    ('cm7a0bgoh0280ewvg4k6b94ui', 'Dumas', 'TX', 'tx', 'Moore County', 'moore-county', 'dumas'),
    ('cm7a0bgoh0283ewvg4kt7khlt', 'DUMAS', 'TX', 'tx', 'Moore County', 'moore-county', 'dumas'),
    ('cm7a0bgoh0286ewvg508qxfay', 'Daingerfield', 'TX', 'tx', 'Morris County', 'morris-county', 'daingerfield'),
    ('cm7a0bgoh0289ewvgug5ixkm2', 'DAINGERFIELD', 'TX', 'tx', 'Morris County', 'morris-county', 'daingerfield'),
    ('cm7a0bgoh028cewvg0ewsagxh', 'DAINGERFIELD', 'TX', 'tx', 'Morris County', 'morris-county', 'daingerfield'),
    ('cm7a0bgoh028eewvg04o8f5xy', 'DAINGERFIELD', 'TX', 'tx', 'Morris County', 'morris-county', 'daingerfield'),
    ('cm7a0bgoh028hewvgfqcg25xg', 'DAINGERFIELD', 'TX', 'tx', 'Morris County', 'morris-county', 'daingerfield'),
    ('cm7a0bgoh028kewvga738hp8f', 'LONE STAR', 'TX', 'tx', 'Morris County', 'morris-county', 'lone-star'),
    ('cm7a0bgoh028newvgfjuhk8cl', 'NAPLES', 'TX', 'tx', 'Morris County', 'morris-county', 'naples'),
    ('cm7a0bgoh028qewvgb35p7ivx', 'OMAHA', 'TX', 'tx', 'Morris County', 'morris-county', 'omaha'),
    ('cm7a0bgoh028tewvgeoi4tmns', 'DAINGERFIELD', 'TX', 'tx', 'Morris County', 'morris-county', 'daingerfield'),
    ('cm7a0bgoh028vewvgcdr05aqc', 'DAINGERFIELD', 'TX', 'tx', 'Morris County', 'morris-county', 'daingerfield'),
    ('cm7a0bgoh028yewvgh0hflfte', 'OMAHA', 'TX', 'tx', 'Morris County', 'morris-county', 'omaha'),
    ('cm7a0bgoh0291ewvgbcdq7ii5', 'MATADOR', 'TX', 'tx', 'Motley County', 'motley-county', 'matador'),
    ('cm7a0bgoi0294ewvgke9duc76', 'NACOGDOCHES', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi0297ewvg1nzuaao0', 'NACOGDOCHES', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi029aewvgl1g5vte1', 'NACOGDOCHES', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi029dewvgl029246a', 'NACOGDOCHES', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi029gewvg3loxz1l0', 'NACOGDOCHES', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi029jewvglw78nuue', 'Nacogdoches', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi029mewvgvepfoz5c', 'NACOGDOCHES', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi029pewvg22mfmegy', 'NACOGDOCHES', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi029sewvg9mow5xpf', 'GARRISON', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'garrison'),
    ('cm7a0bgoi029vewvg4zspfrei', 'NACOGDOCHES', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi029yewvgkpjy6bnq', 'NACOGDOCHES', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi02a1ewvgltxymnyr', 'NACOGDOCHES', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi02a3ewvg7d3wuwxx', 'GARRISON', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'garrison'),
    ('cm7a0bgoi02a6ewvg5592aug8', 'Cushing', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'cushing'),
    ('cm7a0bgoi02a9ewvgkbro2fze', 'Woden', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'woden'),
    ('cm7a0bgoi02acewvgqsfzrajg', 'NACOGDOCHES', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi02afewvgwtwxa0xe', 'Chireno', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'chireno'),
    ('cm7a0bgoi02aiewvg7p696cas', 'Nacogdoches', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'nacogdoches'),
    ('cm7a0bgoi02alewvgzbr3t6bv', 'Douglass', 'TX', 'tx', 'Nacogdoches County', 'nacogdoches-county', 'douglass'),
    ('cm7a0bgoi02anewvg76jko7ol', 'CORSICANA', 'TX', 'tx', 'Navarro County', 'navarro-county', 'corsicana'),
    ('cm7a0bgoi02aqewvguqlahna8', 'CORSICANA', 'TX', 'tx', 'Navarro County', 'navarro-county', 'corsicana'),
    ('cm7a0bgoi02atewvg8m93nxt4', 'CORSICANA', 'TX', 'tx', 'Navarro County', 'navarro-county', 'corsicana'),
    ('cm7a0bgoi02awewvguxhc7ivj', 'Corsicana', 'TX', 'tx', 'Navarro County', 'navarro-county', 'corsicana'),
    ('cm7a0bgoi02azewvg1x2u8dq9', 'Corsicana', 'TX', 'tx', 'Navarro County', 'navarro-county', 'corsicana'),
    ('cm7a0bgoi02b1ewvgsnxiavxn', 'Corsicana', 'TX', 'tx', 'Navarro County', 'navarro-county', 'corsicana'),
    ('cm7a0bgoi02b3ewvgbtq868jq', 'Barry', 'TX', 'tx', 'Navarro County', 'navarro-county', 'barry'),
    ('cm7a0bgoi02b5ewvgo1lgz5xx', 'CORSICANA', 'TX', 'tx', 'Navarro County', 'navarro-county', 'corsicana'),
    ('cm7a0bgoi02b8ewvg6c01u2wq', 'BLOOMING GROVE', 'TX', 'tx', 'Navarro County', 'navarro-county', 'blooming-grove'),
    ('cm7a0bgoi02bbewvgz5p32o5z', 'CORSICANA', 'TX', 'tx', 'Navarro County', 'navarro-county', 'corsicana'),
    ('cm7a0bgoi02beewvgc7kop5yi', 'DAWSON', 'TX', 'tx', 'Navarro County', 'navarro-county', 'dawson'),
    ('cm7a0bgoi02bhewvgg81xzm5w', 'FROST', 'TX', 'tx', 'Navarro County', 'navarro-county', 'frost'),
    ('cm7a0bgoi02bkewvg6z1qjp4j', 'KERENS', 'TX', 'tx', 'Navarro County', 'navarro-county', 'kerens'),
    ('cm7a0bgoi02bnewvgc656lrgv', 'RICHLAND', 'TX', 'tx', 'Navarro County', 'navarro-county', 'richland'),
    ('cm7a0bgoi02bqewvgab005r3w', 'RICE', 'TX', 'tx', 'Navarro County', 'navarro-county', 'rice'),
    ('cm7a0bgoi02btewvgoy2f1j6x', 'CORSICANA', 'TX', 'tx', 'Navarro County', 'navarro-county', 'corsicana'),
    ('cm7a0bgoi02bwewvggrcunw0v', 'CORSICANA', 'TX', 'tx', 'Navarro County', 'navarro-county', 'corsicana'),
    ('cm7a0bgoi02bzewvgn9qdfb9a', 'RICE', 'TX', 'tx', 'Navarro County', 'navarro-county', 'rice'),
    ('cm7a0bgoi02c2ewvgosqq1lb7', 'Blooming Grove', 'TX', 'tx', 'Navarro County', 'navarro-county', 'blooming-grove'),
    ('cm7a0bgoi02c5ewvgfy304f0n', 'Frost', 'TX', 'tx', 'Navarro County', 'navarro-county', 'frost'),
    ('cm7a0bgoi02c8ewvg0qvcc4uy', 'Corsicana', 'TX', 'tx', 'Navarro County', 'navarro-county', 'corsicana'),
    ('cm7a0bgoi02cbewvgpn3x7cxf', 'NEWTON', 'TX', 'tx', 'Newton County', 'newton-county', 'newton'),
    ('cm7a0bgoi02ceewvgihzmww9i', 'Newton', 'TX', 'tx', 'Newton County', 'newton-county', 'newton'),
    ('cm7a0bgoi02cgewvg5acmm37j', 'NEWTON', 'TX', 'tx', 'Newton County', 'newton-county', 'newton'),
    ('cm7a0bgoi02ciewvgq1euecin', 'Newton', 'TX', 'tx', 'Newton County', 'newton-county', 'newton'),
    ('cm7a0bgoi02ckewvgzjvbps8y', 'Deweyville', 'TX', 'tx', 'Newton County', 'newton-county', 'deweyville'),
    ('cm7a0bgoi02cnewvgorfmxt60', 'NEWTON', 'TX', 'tx', 'Newton County', 'newton-county', 'newton'),
    ('cm7a0bgoi02cqewvgxy52wpvu', 'NEWTON', 'TX', 'tx', 'Newton County', 'newton-county', 'newton'),
    ('cm7a0bgoi02ctewvg6rqb32v4', 'Newton', 'TX', 'tx', 'Newton County', 'newton-county', 'newton'),
    ('cm7a0bgoi02cwewvgp4g4daic', 'SWEETWATER', 'TX', 'tx', 'Nolan County', 'nolan-county', 'sweetwater'),
    ('cm7a0bgoi02czewvgkksyxizb', 'SWEETWATER', 'TX', 'tx', 'Nolan County', 'nolan-county', 'sweetwater'),
    ('cm7a0bgoi02d2ewvgwy1zmw6u', 'SWEETWATER', 'TX', 'tx', 'Nolan County', 'nolan-county', 'sweetwater'),
    ('cm7a0bgoi02d5ewvgrc5v35jd', 'ROSCOE', 'TX', 'tx', 'Nolan County', 'nolan-county', 'roscoe'),
    ('cm7a0bgoi02d7ewvg4r75ily9', 'SWEETWATER', 'TX', 'tx', 'Nolan County', 'nolan-county', 'sweetwater'),
    ('cm7a0bgoi02daewvg866tlwv7', 'SWEETWATER', 'TX', 'tx', 'Nolan County', 'nolan-county', 'sweetwater'),
    ('cm7a0bgoi02ddewvg17wpy1yj', 'CORPUS CHRISTI', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02dgewvgst2shzva', 'Corpus Christi', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02djewvgwwmbsh4i', 'Corpus Christi', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02dmewvguqqiwn9q', 'CORPUS CHRISTI', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02dpewvgmwdiyf9h', 'CORPUS CHRISTI', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02dsewvgretv84ob', 'CORPUS CHRISTI', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02dvewvgqxsyig7z', 'BISHOP', 'TX', 'tx', 'Nueces County', 'nueces-county', 'bishop'),
    ('cm7a0bgoi02dyewvgg0t30zu3', 'PORT ARANSAS', 'TX', 'tx', 'Nueces County', 'nueces-county', 'port-aransas'),
    ('cm7a0bgoi02e1ewvg129103sq', 'ROBSTOWN', 'TX', 'tx', 'Nueces County', 'nueces-county', 'robstown'),
    ('cm7a0bgoi02e3ewvgojx5m697', 'CORPUS CHRISTI', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02e5ewvg7o3dfw39', 'BISHOP', 'TX', 'tx', 'Nueces County', 'nueces-county', 'bishop'),
    ('cm7a0bgoi02e8ewvgamfh3qek', 'CORPUS CHRISTI', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02ebewvg92rqn00z', 'PORT ARANSAS', 'TX', 'tx', 'Nueces County', 'nueces-county', 'port-aransas'),
    ('cm7a0bgoi02eeewvgj7oc13vn', 'ROBSTOWN', 'TX', 'tx', 'Nueces County', 'nueces-county', 'robstown'),
    ('cm7a0bgoi02ehewvgxfh37rl0', 'CORPUS CHRISTI', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02ejewvgk8vp522r', 'Robstown', 'TX', 'tx', 'Nueces County', 'nueces-county', 'robstown'),
    ('cm7a0bgoi02emewvgmw1k34tm', 'CORPUS CHRISTI', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02epewvgd0eezju6', 'Agua Dulce', 'TX', 'tx', 'Nueces County', 'nueces-county', 'agua-dulce'),
    ('cm7a0bgoi02esewvgv6dw91ql', 'CORPUS CHRISTI', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02evewvg70vhcac0', 'CORPUS CHRISTI', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02eyewvgih6wsu3u', 'Corpus Christi', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02f1ewvgn1gznk4d', 'CORPUS CHRISTI', 'TX', 'tx', 'Nueces County', 'nueces-county', 'corpus-christi'),
    ('cm7a0bgoi02f3ewvgf6qn0qic', 'ROBSTOWN', 'TX', 'tx', 'Nueces County', 'nueces-county', 'robstown'),
    ('cm7a0bgoi02f6ewvggwwi28f9', 'Perryton', 'TX', 'tx', 'Ochiltree County', 'ochiltree-county', 'perryton'),
    ('cm7a0bgoi02f9ewvg6lhz5bck', 'PERRYTON', 'TX', 'tx', 'Ochiltree County', 'ochiltree-county', 'perryton'),
    ('cm7a0bgoi02fcewvg32w03azo', 'PERRYTON', 'TX', 'tx', 'Ochiltree County', 'ochiltree-county', 'perryton'),
    ('cm7a0bgoj02ffewvghiew3mo2', 'PERRYTON', 'TX', 'tx', 'Ochiltree County', 'ochiltree-county', 'perryton'),
    ('cm7a0bgoj02fiewvg31ogn3zc', 'VEGA', 'TX', 'tx', 'Oldham County', 'oldham-county', 'vega'),
    ('cm7a0bgoj02flewvg26js0bod', 'VEGA', 'TX', 'tx', 'Oldham County', 'oldham-county', 'vega'),
    ('cm7a0bgoj02foewvgs8roboe8', 'ORANGE', 'TX', 'tx', 'Orange County', 'orange-county', 'orange'),
    ('cm7a0bgoj02frewvgy5hev88e', 'ORANGE', 'TX', 'tx', 'Orange County', 'orange-county', 'orange'),
    ('cm7a0bgoj02fuewvgiurfv7g8', 'ORANGE', 'TX', 'tx', 'Orange County', 'orange-county', 'orange'),
    ('cm7a0bgoj02fxewvg3x35h8ne', 'ORANGE', 'TX', 'tx', 'Orange County', 'orange-county', 'orange'),
    ('cm7a0bgoj02fzewvgbi46jmvs', 'VIDOR', 'TX', 'tx', 'Orange County', 'orange-county', 'vidor'),
    ('cm7a0bgoj02g2ewvgbqx9o3a7', 'ORANGE', 'TX', 'tx', 'Orange County', 'orange-county', 'orange'),
    ('cm7a0bgoj02g5ewvg5obh1dxg', 'BRIDGE CITY', 'TX', 'tx', 'Orange County', 'orange-county', 'bridge-city'),
    ('cm7a0bgoj02g8ewvg7upzcc5p', 'ORANGE', 'TX', 'tx', 'Orange County', 'orange-county', 'orange'),
    ('cm7a0bgoj02gbewvg3qaytym4', 'VIDOR', 'TX', 'tx', 'Orange County', 'orange-county', 'vidor'),
    ('cm7a0bgoj02gdewvgh23sth69', 'ORANGE', 'TX', 'tx', 'Orange County', 'orange-county', 'orange'),
    ('cm7a0bgoj02ggewvg7tod8kfk', 'ROSE CITY', 'TX', 'tx', 'Orange County', 'orange-county', 'rose-city'),
    ('cm7a0bgoj02gjewvg0jrgn6st', 'VIDOR', 'TX', 'tx', 'Orange County', 'orange-county', 'vidor'),
    ('cm7a0bgoj02gmewvg9waizpqb', 'WEST ORANGE', 'TX', 'tx', 'Orange County', 'orange-county', 'west-orange'),
    ('cm7a0bgoj02gpewvga3imtx2r', 'ORANGE', 'TX', 'tx', 'Orange County', 'orange-county', 'orange'),
    ('cm7a0bgoj02gsewvg8pk5o25i', 'Bridge City', 'TX', 'tx', 'Orange County', 'orange-county', 'bridge-city'),
    ('cm7a0bgoj02gvewvgckyw3bbt', 'VIDOR', 'TX', 'tx', 'Orange County', 'orange-county', 'vidor'),
    ('cm7a0bgoj02gyewvgtfoq6lob', 'ORANGE', 'TX', 'tx', 'Orange County', 'orange-county', 'orange'),
    ('cm7a0bgoj02h1ewvgegnh9ko7', 'Orange', 'TX', 'tx', 'Orange County', 'orange-county', 'orange'),
    ('cm7a0bgoj02h3ewvgutvpqecg', 'PALO PINTO', 'TX', 'tx', 'Palo Pinto County', 'palo-pinto-county', 'palo-pinto'),
    ('cm7a0bgoj02h6ewvgbnhao1vu', 'SANTO', 'TX', 'tx', 'Palo Pinto County', 'palo-pinto-county', 'santo'),
    ('cm7a0bgoj02h8ewvg2fjp4yk2', 'GRAFORD', 'TX', 'tx', 'Palo Pinto County', 'palo-pinto-county', 'graford'),
    ('cm7a0bgoj02haewvgxdjm9r1f', 'GRAFORD', 'TX', 'tx', 'Palo Pinto County', 'palo-pinto-county', 'graford'),
    ('cm7a0bgoj02hdewvg8kjhdrrs', 'Strawn', 'TX', 'tx', 'Palo Pinto County', 'palo-pinto-county', 'strawn'),
    ('cm7a0bgoj02hgewvgw45wew72', 'MINERAL WELLS', 'TX', 'tx', 'Palo Pinto County', 'palo-pinto-county', 'mineral-wells'),
    ('cm7a0bgoj02hjewvgqpfk0tqh', 'PALO PINTO', 'TX', 'tx', 'Palo Pinto County', 'palo-pinto-county', 'palo-pinto'),
    ('cm7a0bgoj02hmewvg453v64g8', 'PALO PINTO', 'TX', 'tx', 'Palo Pinto County', 'palo-pinto-county', 'palo-pinto'),
    ('cm7a0bgoj02hpewvgvs7ctvui', 'PALO PINTO', 'TX', 'tx', 'Palo Pinto County', 'palo-pinto-county', 'palo-pinto'),
    ('cm7a0bgoj02hsewvgmgouwhmi', 'MINERAL WELLS', 'TX', 'tx', 'Palo Pinto County', 'palo-pinto-county', 'mineral-wells'),
    ('cm7a0bgoj02hvewvgaro6xktx', 'CARTHAGE', 'TX', 'tx', 'Panola County', 'panola-county', 'carthage'),
    ('cm7a0bgoj02hyewvgy28b0tao', 'CARTHAGE', 'TX', 'tx', 'Panola County', 'panola-county', 'carthage'),
    ('cm7a0bgoj02i0ewvg86w4hama', 'CARTHAGE', 'TX', 'tx', 'Panola County', 'panola-county', 'carthage'),
    ('cm7a0bgoj02i3ewvgs4x8rwm1', 'CARTHAGE', 'TX', 'tx', 'Panola County', 'panola-county', 'carthage'),
    ('cm7a0bgoj02i6ewvgme4q5ghd', 'CARTHAGE', 'TX', 'tx', 'Panola County', 'panola-county', 'carthage'),
    ('cm7a0bgoj02i9ewvgnu4onejk', 'CARTHAGE', 'TX', 'tx', 'Panola County', 'panola-county', 'carthage'),
    ('cm7a0bgoj02icewvggx1c0dx6', 'CARTHAGE', 'TX', 'tx', 'Panola County', 'panola-county', 'carthage'),
    ('cm7a0bgoj02ifewvgbikjyyf2', 'WEATHERFORD', 'TX', 'tx', 'Parker County', 'parker-county', 'weatherford'),
    ('cm7a0bgoj02iiewvgldksl8k7', 'Weatherford', 'TX', 'tx', 'Parker County', 'parker-county', 'weatherford'),
    ('cm7a0bgoj02ilewvgwv0habwx', 'WEATHERFORD', 'TX', 'tx', 'Parker County', 'parker-county', 'weatherford'),
    ('cm7a0bgoj02ioewvgse3i3q6w', 'SPRINGTOWN', 'TX', 'tx', 'Parker County', 'parker-county', 'springtown'),
    ('cm7a0bgoj02irewvgblrvpi7j', 'WEATHERFORD', 'TX', 'tx', 'Parker County', 'parker-county', 'weatherford'),
    ('cm7a0bgoj02iuewvgp9dbrwv6', 'WEATHERFORD', 'TX', 'tx', 'Parker County', 'parker-county', 'weatherford'),
    ('cm7a0bgoj02ixewvgw0afe2sz', 'Aledo', 'TX', 'tx', 'Parker County', 'parker-county', 'aledo'),
    ('cm7a0bgoj02j0ewvg6znfyn7m', 'WEATHERFORD', 'TX', 'tx', 'Parker County', 'parker-county', 'weatherford'),
    ('cm7a0bgoj02j3ewvg96xu9s64', 'WEATHERFORD', 'TX', 'tx', 'Parker County', 'parker-county', 'weatherford'),
    ('cm7a0bgoj02j6ewvgcwadwdvk', 'WEATHERFORD', 'TX', 'tx', 'Parker County', 'parker-county', 'weatherford'),
    ('cm7a0bgoj02j9ewvga563i7mo', 'WILLOW PARK', 'TX', 'tx', 'Parker County', 'parker-county', 'willow-park'),
    ('cm7a0bgoj02jcewvgczqsgrbh', 'AZLE', 'TX', 'tx', 'Parker County', 'parker-county', 'azle'),
    ('cm7a0bgoj02jfewvg93vpufy6', 'SPRINGTOWN', 'TX', 'tx', 'Parker County', 'parker-county', 'springtown'),
    ('cm7a0bgoj02jiewvgg8l2lqb8', 'WEATHERFORD', 'TX', 'tx', 'Parker County', 'parker-county', 'weatherford'),
    ('cm7a0bgoj02jlewvgggxb709n', 'HUDSON OAKS', 'TX', 'tx', 'Parker County', 'parker-county', 'hudson-oaks'),
    ('cm7a0bgoj02joewvgqrxrkfak', 'ALEDO', 'TX', 'tx', 'Parker County', 'parker-county', 'aledo'),
    ('cm7a0bgoj02jrewvgv1v2x0q2', 'FARWELL', 'TX', 'tx', 'Parmer County', 'parmer-county', 'farwell'),
    ('cm7a0bgoj02juewvgdyqilq2g', 'BOVINA', 'TX', 'tx', 'Parmer County', 'parmer-county', 'bovina'),
    ('cm7a0bgoj02jxewvg5moffxls', 'FARWELL', 'TX', 'tx', 'Parmer County', 'parmer-county', 'farwell'),
    ('cm7a0bgoj02k0ewvghg97g89z', 'FRIONA', 'TX', 'tx', 'Parmer County', 'parmer-county', 'friona'),
    ('cm7a0bgoj02k3ewvghpnwtxhf', 'FORT STOCKTON', 'TX', 'tx', 'Pecos County', 'pecos-county', 'fort-stockton'),
    ('cm7a0bgoj02k6ewvgixx6i2uu', 'FORT STOCKTON', 'TX', 'tx', 'Pecos County', 'pecos-county', 'fort-stockton'),
    ('cm7a0bgoj02k8ewvgesqld6x8', 'IRAAN', 'TX', 'tx', 'Pecos County', 'pecos-county', 'iraan'),
    ('cm7a0bgoj02kaewvgj84e4mze', 'SHEFFIELD', 'TX', 'tx', 'Pecos County', 'pecos-county', 'sheffield'),
    ('cm7a0bgoj02kdewvgti7copdq', 'FORT STOCKTON', 'TX', 'tx', 'Pecos County', 'pecos-county', 'fort-stockton'),
    ('cm7a0bgoj02kgewvgywh97nwx', 'FORT STOCKTON', 'TX', 'tx', 'Pecos County', 'pecos-county', 'fort-stockton'),
    ('cm7a0bgoj02kjewvgw2skp531', 'FORT STOCKTON', 'TX', 'tx', 'Pecos County', 'pecos-county', 'fort-stockton'),
    ('cm7a0bgoj02kmewvg1oyocctl', 'Livingston', 'TX', 'tx', 'Polk County', 'polk-county', 'livingston'),
    ('cm7a0bgoj02kpewvg1dznve0j', 'LIVINGSTON', 'TX', 'tx', 'Polk County', 'polk-county', 'livingston'),
    ('cm7a0bgoj02ksewvg57brss1p', 'Livingston', 'TX', 'tx', 'Polk County', 'polk-county', 'livingston'),
    ('cm7a0bgoj02kvewvgquuowtqe', 'ONALASKA', 'TX', 'tx', 'Polk County', 'polk-county', 'onalaska'),
    ('cm7a0bgoj02kxewvgslkxkei1', 'MOSCOW', 'TX', 'tx', 'Polk County', 'polk-county', 'moscow'),
    ('cm7a0bgoj02l0ewvg3kvmrich', 'LIVINGSTON', 'TX', 'tx', 'Polk County', 'polk-county', 'livingston'),
    ('cm7a0bgoj02l3ewvgfhmui7ue', 'LIVINGSTON', 'TX', 'tx', 'Polk County', 'polk-county', 'livingston'),
    ('cm7a0bgoj02l6ewvgnvw0gntf', 'LIVINGSTON', 'TX', 'tx', 'Polk County', 'polk-county', 'livingston'),
    ('cm7a0bgoj02l9ewvgchzpz6lk', 'Livingston', 'TX', 'tx', 'Polk County', 'polk-county', 'livingston'),
    ('cm7a0bgoj02lcewvgk0h3b595', 'CORRIGAN', 'TX', 'tx', 'Polk County', 'polk-county', 'corrigan'),
    ('cm7a0bgoj02lfewvgwryfhw2i', 'LIVINGSTON', 'TX', 'tx', 'Polk County', 'polk-county', 'livingston'),
    ('cm7a0bgoj02liewvgubrbwa77', 'ONALASKA', 'TX', 'tx', 'Polk County', 'polk-county', 'onalaska'),
    ('cm7a0bgok02llewvgl3n29lns', 'LIVINGSTON', 'TX', 'tx', 'Polk County', 'polk-county', 'livingston'),
    ('cm7a0bgok02lnewvgl2wr8r5t', 'Amarillo', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02lqewvgpsm6jbqh', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02ltewvgaizr95cx', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02lwewvgs9mx25ny', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02lyewvgnbzi6crj', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02m1ewvgv43o33nv', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02m3ewvg4nryzeja', 'Amarillo', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02m6ewvglivcmcvr', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02m8ewvggldqozzb', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02maewvg4slwf38s', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02mcewvg0zx6q40b', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02mfewvgdgbntczn', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02mhewvg8ubqu2j3', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02mjewvgtpq2cmde', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02mmewvgoko20evt', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02moewvgomzm5br7', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02mrewvgu7zyydgg', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02muewvghq9ssg3n', 'Amarillo', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02mxewvgfaxay6i9', 'Amarillo', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02mzewvg8ym1jqpp', 'AMARILLO', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02n2ewvg44wilywe', 'Amarillo', 'TX', 'tx', 'Potter County', 'potter-county', 'amarillo'),
    ('cm7a0bgok02n5ewvgcw9a0yvi', 'MARFA', 'TX', 'tx', 'Presidio County', 'presidio-county', 'marfa'),
    ('cm7a0bgok02n8ewvgmtubq5ni', 'MARFA', 'TX', 'tx', 'Presidio County', 'presidio-county', 'marfa'),
    ('cm7a0bgok02naewvg390c5zlp', 'Marfa', 'TX', 'tx', 'Presidio County', 'presidio-county', 'marfa'),
    ('cm7a0bgok02ncewvgucp1y48m', 'MARFA', 'TX', 'tx', 'Presidio County', 'presidio-county', 'marfa'),
    ('cm7a0bgok02nfewvg21278abt', 'PRESIDIO', 'TX', 'tx', 'Presidio County', 'presidio-county', 'presidio'),
    ('cm7a0bgok02niewvgmffjxdfk', 'PRESIDIO', 'TX', 'tx', 'Presidio County', 'presidio-county', 'presidio'),
    ('cm7a0bgok02nkewvgl8ir648l', 'EMORY', 'TX', 'tx', 'Rains County', 'rains-county', 'emory'),
    ('cm7a0bgok02nnewvgnvhy9d31', 'EMORY', 'TX', 'tx', 'Rains County', 'rains-county', 'emory'),
    ('cm7a0bgok02nqewvg3ow1ef63', 'EMORY', 'TX', 'tx', 'Rains County', 'rains-county', 'emory'),
    ('cm7a0bgok02ntewvg3cdisvn4', 'EAST TAWAKONI', 'TX', 'tx', 'Rains County', 'rains-county', 'east-tawakoni'),
    ('cm7a0bgok02nwewvgflokuan4', 'EMORY', 'TX', 'tx', 'Rains County', 'rains-county', 'emory'),
    ('cm7a0bgok02nzewvg89j96zf3', 'POINT', 'TX', 'tx', 'Rains County', 'rains-county', 'point'),
    ('cm7a0bgok02o2ewvghdhsa4to', 'EMORY', 'TX', 'tx', 'Rains County', 'rains-county', 'emory'),
    ('cm7a0bgok02o5ewvg6s1nip8p', 'CANYON', 'TX', 'tx', 'Randall County', 'randall-county', 'canyon'),
    ('cm7a0bgok02o8ewvg851xlmcu', 'Amarillo', 'TX', 'tx', 'Randall County', 'randall-county', 'amarillo'),
    ('cm7a0bgok02obewvgoqhv2bri', 'AMARILLO', 'TX', 'tx', 'Randall County', 'randall-county', 'amarillo'),
    ('cm7a0bgok02oeewvgzwufnk2i', 'CANYON', 'TX', 'tx', 'Randall County', 'randall-county', 'canyon'),
    ('cm7a0bgok02ohewvglvazrl61', 'AMARILLO', 'TX', 'tx', 'Randall County', 'randall-county', 'amarillo'),
    ('cm7a0bgok02ojewvgc996rb05', 'Canyon', 'TX', 'tx', 'Randall County', 'randall-county', 'canyon'),
    ('cm7a0bgok02omewvgijp7ls7h', 'CANYON', 'TX', 'tx', 'Randall County', 'randall-county', 'canyon'),
    ('cm7a0bgok02opewvgy1whlyhs', 'CANYON', 'TX', 'tx', 'Randall County', 'randall-county', 'canyon'),
    ('cm7a0bgok02osewvgpol7xoxg', 'CANYON', 'TX', 'tx', 'Randall County', 'randall-county', 'canyon'),
    ('cm7a0bgok02ovewvgbgy1xfjs', 'AMARILLO', 'TX', 'tx', 'Randall County', 'randall-county', 'amarillo'),
    ('cm7a0bgok02oyewvg745viklu', 'AMARILLO', 'TX', 'tx', 'Randall County', 'randall-county', 'amarillo'),
    ('cm7a0bgok02p0ewvgo19lpqkz', 'BIG LAKE', 'TX', 'tx', 'Reagan County', 'reagan-county', 'big-lake'),
    ('cm7a0bgok02p3ewvgurw0gmac', 'LEAKEY', 'TX', 'tx', 'Real County', 'real-county', 'leakey'),
    ('cm7a0bgok02p6ewvgyep84gi0', 'LEAKEY', 'TX', 'tx', 'Real County', 'real-county', 'leakey'),
    ('cm7a0bgok02p9ewvgl6taimve', 'LEAKEY', 'TX', 'tx', 'Real County', 'real-county', 'leakey'),
    ('cm7a0bgok02pcewvguz20x5kz', 'CLARKSVILLE', 'TX', 'tx', 'Red River County', 'red-river-county', 'clarksville'),
    ('cm7a0bgok02pfewvghks15m41', 'CLARKSVILLE', 'TX', 'tx', 'Red River County', 'red-river-county', 'clarksville'),
    ('cm7a0bgok02phewvgnvzabocv', 'CLARKSVILLE', 'TX', 'tx', 'Red River County', 'red-river-county', 'clarksville'),
    ('cm7a0bgok02pkewvgy2btngbi', 'BOGATA', 'TX', 'tx', 'Red River County', 'red-river-county', 'bogata'),
    ('cm7a0bgok02pnewvg4wzctcql', 'CLARKSVILLE', 'TX', 'tx', 'Red River County', 'red-river-county', 'clarksville'),
    ('cm7a0bgok02pqewvgfqbntkah', 'Bogata', 'TX', 'tx', 'Red River County', 'red-river-county', 'bogata'),
    ('cm7a0bgok02ptewvgbzlzsnjn', 'Avery', 'TX', 'tx', 'Red River County', 'red-river-county', 'avery'),
    ('cm7a0bgok02pwewvgr4wkoimz', 'Detroit', 'TX', 'tx', 'Red River County', 'red-river-county', 'detroit'),
    ('cm7a0bgok02pzewvgxxlnpxdv', 'Clarksville', 'TX', 'tx', 'Red River County', 'red-river-county', 'clarksville'),
    ('cm7a0bgok02q2ewvgri83ksuk', 'PECOS', 'TX', 'tx', 'Reeves County', 'reeves-county', 'pecos'),
    ('cm7a0bgok02q5ewvg820apnxk', 'PECOS', 'TX', 'tx', 'Reeves County', 'reeves-county', 'pecos'),
    ('cm7a0bgok02q7ewvgwcenrqtl', 'PECOS', 'TX', 'tx', 'Reeves County', 'reeves-county', 'pecos'),
    ('cm7a0bgok02q9ewvgnu8dw57j', 'Pecos', 'TX', 'tx', 'Reeves County', 'reeves-county', 'pecos'),
    ('cm7a0bgok02qbewvgj7wcuon0', 'PECOS', 'TX', 'tx', 'Reeves County', 'reeves-county', 'pecos'),
    ('cm7a0bgok02qdewvguljrtvhu', 'PECOS', 'TX', 'tx', 'Reeves County', 'reeves-county', 'pecos'),
    ('cm7a0bgok02qgewvgxbmkwbwy', 'PECOS', 'TX', 'tx', 'Reeves County', 'reeves-county', 'pecos'),
    ('cm7a0bgok02qjewvgzsvmkdke', 'Pecos', 'TX', 'tx', 'Reeves County', 'reeves-county', 'pecos'),
    ('cm7a0bgok02qmewvgdjby6j44', 'REFUGIO', 'TX', 'tx', 'Refugio County', 'refugio-county', 'refugio'),
    ('cm7a0bgok02qpewvgd7fnxgcx', 'Woodsboro', 'TX', 'tx', 'Refugio County', 'refugio-county', 'woodsboro'),
    ('cm7a0bgok02qsewvgvy7bsj5g', 'Refugio', 'TX', 'tx', 'Refugio County', 'refugio-county', 'refugio'),
    ('cm7a0bgok02quewvg95eyfk4u', 'REFUGIO', 'TX', 'tx', 'Refugio County', 'refugio-county', 'refugio'),
    ('cm7a0bgok02qxewvgm4rtdtr4', 'WOODSBORO', 'TX', 'tx', 'Refugio County', 'refugio-county', 'woodsboro'),
    ('cm7a0bgok02r0ewvgyej6hqxu', 'MIAMI', 'TX', 'tx', 'Roberts County', 'roberts-county', 'miami'),
    ('cm7a0bgok02r3ewvglwn9vwld', 'FRANKLIN', 'TX', 'tx', 'Robertson County', 'robertson-county', 'franklin'),
    ('cm7a0bgok02r6ewvg8bydm67d', 'FRANKLIN', 'TX', 'tx', 'Robertson County', 'robertson-county', 'franklin'),
    ('cm7a0bgok02r9ewvg8chvjr7o', 'Hearne', 'TX', 'tx', 'Robertson County', 'robertson-county', 'hearne'),
    ('cm7a0bgok02rcewvgyf5c3w5o', 'FRANKLIN', 'TX', 'tx', 'Robertson County', 'robertson-county', 'franklin'),
    ('cm7a0bgok02rfewvgotg51ixc', 'BREMOND', 'TX', 'tx', 'Robertson County', 'robertson-county', 'bremond'),
    ('cm7a0bgok02riewvgn4zn0uhw', 'FRANKLIN', 'TX', 'tx', 'Robertson County', 'robertson-county', 'franklin'),
    ('cm7a0bgol02rlewvgwj1t28lo', 'BREMOND', 'TX', 'tx', 'Robertson County', 'robertson-county', 'bremond'),
    ('cm7a0bgol02roewvg54xwornh', 'CALVERT', 'TX', 'tx', 'Robertson County', 'robertson-county', 'calvert'),
    ('cm7a0bgol02rrewvgwyzl70va', 'FRANKLIN', 'TX', 'tx', 'Robertson County', 'robertson-county', 'franklin'),
    ('cm7a0bgol02ruewvgh3noz1kj', 'HEARNE', 'TX', 'tx', 'Robertson County', 'robertson-county', 'hearne'),
    ('cm7a0bgol02rxewvg1hrvt3r4', 'Franklin', 'TX', 'tx', 'Robertson County', 'robertson-county', 'franklin'),
    ('cm7a0bgol02s0ewvghwv39ulx', 'ROCKWALL', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'rockwall'),
    ('cm7a0bgol02s3ewvg0wll61j1', 'ROCKWALL', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'rockwall'),
    ('cm7a0bgol02s5ewvgg4j3z2iq', 'Rockwall', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'rockwall'),
    ('cm7a0bgol02s7ewvg1geoksj2', 'ROCKWALL', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'rockwall'),
    ('cm7a0bgol02s9ewvgr12t9j98', 'ROCKWALL', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'rockwall'),
    ('cm7a0bgol02scewvgetjvedkm', 'Rockwall', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'rockwall'),
    ('cm7a0bgol02seewvgl2v90m7n', 'ROCKWALL', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'rockwall'),
    ('cm7a0bgol02shewvg63gejvv1', 'FATE', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'fate'),
    ('cm7a0bgol02skewvgtueuk5sg', 'ROYSE CITY', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'royse-city'),
    ('cm7a0bgol02snewvgxlnu0l40', 'ROCKWALL', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'rockwall'),
    ('cm7a0bgol02sqewvgco6fdljp', 'HEATH', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'heath'),
    ('cm7a0bgol02stewvgdbfosnd1', 'Fate', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'fate'),
    ('cm7a0bgol02swewvg2ul8bmaz', 'McLendon-Chisholm', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'mclendon-chisholm'),
    ('cm7a0bgol02szewvgzskuayso', 'ROCKWALL', 'TX', 'tx', 'Rockwall County', 'rockwall-county', 'rockwall'),
    ('cm7a0bgol02t2ewvgq42j0s1p', 'BALLINGER', 'TX', 'tx', 'Runnels County', 'runnels-county', 'ballinger'),
    ('cm7a0bgol02t5ewvg798mlode', 'BALLINGER', 'TX', 'tx', 'Runnels County', 'runnels-county', 'ballinger'),
    ('cm7a0bgol02t7ewvgccpyraap', 'WINTERS', 'TX', 'tx', 'Runnels County', 'runnels-county', 'winters'),
    ('cm7a0bgol02t9ewvgm0q0h2k8', 'BALLINGER', 'TX', 'tx', 'Runnels County', 'runnels-county', 'ballinger'),
    ('cm7a0bgol02tcewvg9fi3aoch', 'WINTERS', 'TX', 'tx', 'Runnels County', 'runnels-county', 'winters'),
    ('cm7a0bgol02tfewvgwuaflggc', 'MILES', 'TX', 'tx', 'Runnels County', 'runnels-county', 'miles'),
    ('cm7a0bgol02tiewvgbwz8m2b6', 'Henderson', 'TX', 'tx', 'Rusk County', 'rusk-county', 'henderson'),
    ('cm7a0bgol02tlewvg2q3v82wf', 'HENDERSON', 'TX', 'tx', 'Rusk County', 'rusk-county', 'henderson'),
    ('cm7a0bgol02toewvgpt71pggi', 'OVERTON', 'TX', 'tx', 'Rusk County', 'rusk-county', 'overton'),
    ('cm7a0bgol02trewvgvzdt84pv', 'TATUM', 'TX', 'tx', 'Rusk County', 'rusk-county', 'tatum'),
    ('cm7a0bgol02ttewvgsyr4sap1', 'MOUNT ENTERPRISE', 'TX', 'tx', 'Rusk County', 'rusk-county', 'mount-enterprise'),
    ('cm7a0bgol02twewvg07zg3rj7', 'Henderson', 'TX', 'tx', 'Rusk County', 'rusk-county', 'henderson'),
    ('cm7a0bgol02tyewvgmukd54y0', 'HENDERSON', 'TX', 'tx', 'Rusk County', 'rusk-county', 'henderson'),
    ('cm7a0bgol02u1ewvgc5g7e0vd', 'HENDERSON', 'TX', 'tx', 'Rusk County', 'rusk-county', 'henderson'),
    ('cm7a0bgol02u4ewvg88oo9klm', 'Tatum', 'TX', 'tx', 'Rusk County', 'rusk-county', 'tatum'),
    ('cm7a0bgol02u7ewvgvb350gxa', 'HENDERSON', 'TX', 'tx', 'Rusk County', 'rusk-county', 'henderson'),
    ('cm7a0bgol02uaewvgo2w2c58g', 'NEW LONDON', 'TX', 'tx', 'Rusk County', 'rusk-county', 'new-london'),
    ('cm7a0bgol02udewvgkvsf32wq', 'OVERTON', 'TX', 'tx', 'Rusk County', 'rusk-county', 'overton'),
    ('cm7a0bgol02ugewvgnceeahvy', 'MOUNT ENTERPRISE', 'TX', 'tx', 'Rusk County', 'rusk-county', 'mount-enterprise'),
    ('cm7a0bgol02ujewvgv12kesog', 'NEW LONDON', 'TX', 'tx', 'Rusk County', 'rusk-county', 'new-london'),
    ('cm7a0bgol02umewvgjv0gxube', 'MOUNT ENTERPRISE', 'TX', 'tx', 'Rusk County', 'rusk-county', 'mount-enterprise'),
    ('cm7a0bgol02upewvg5yrujw6a', 'Tatum', 'TX', 'tx', 'Rusk County', 'rusk-county', 'tatum'),
    ('cm7a0bgol02usewvgi9ox0r55', 'PINELAND', 'TX', 'tx', 'Sabine County', 'sabine-county', 'pineland'),
    ('cm7a0bgol02uuewvg8fp2x1ze', 'HEMPHILL', 'TX', 'tx', 'Sabine County', 'sabine-county', 'hemphill'),
    ('cm7a0bgol02uxewvgbjt0m23g', 'HEMPHILL', 'TX', 'tx', 'Sabine County', 'sabine-county', 'hemphill'),
    ('cm7a0bgol02uzewvg5k0gep6e', 'HEMPHILL', 'TX', 'tx', 'Sabine County', 'sabine-county', 'hemphill'),
    ('cm7a0bgol02v1ewvgbcs2j7ui', 'HEMPHILL', 'TX', 'tx', 'Sabine County', 'sabine-county', 'hemphill'),
    ('cm7a0bgol02v4ewvgng8pohtl', 'PINELAND', 'TX', 'tx', 'Sabine County', 'sabine-county', 'pineland'),
    ('cm7a0bgol02v7ewvg0ef5qwzi', 'Hemphill', 'TX', 'tx', 'Sabine County', 'sabine-county', 'hemphill'),
    ('cm7a0bgol02vaewvg2tyoz75b', 'SAN AUGUSTINE', 'TX', 'tx', 'San Augustine County', 'san-augustine-county', 'san-augustine'),
    ('cm7a0bgol02vdewvgkhox65jr', 'SAN AUGUSTINE', 'TX', 'tx', 'San Augustine County', 'san-augustine-county', 'san-augustine'),
    ('cm7a0bgol02vgewvghewilthc', 'SAN AUGUSTINE', 'TX', 'tx', 'San Augustine County', 'san-augustine-county', 'san-augustine'),
    ('cm7a0bgol02vjewvg8t07vgzd', 'San Augustine', 'TX', 'tx', 'San Augustine County', 'san-augustine-county', 'san-augustine'),
    ('cm7a0bgol02vlewvg7i11rt5k', 'SAN AUGUSTINE', 'TX', 'tx', 'San Augustine County', 'san-augustine-county', 'san-augustine'),
    ('cm7a0bgol02voewvgtdhj3fou', 'San Augustine', 'TX', 'tx', 'San Augustine County', 'san-augustine-county', 'san-augustine'),
    ('cm7a0bgol02vrewvgd0x747e1', 'SAN AUGUSTINE', 'TX', 'tx', 'San Augustine County', 'san-augustine-county', 'san-augustine'),
    ('cm7a0bgol02vuewvgl5ljo2h7', 'Broaddus', 'TX', 'tx', 'San Augustine County', 'san-augustine-county', 'broaddus'),
    ('cm7a0bgol02vxewvgrkju4mnz', 'SAN AUGUSTINE', 'TX', 'tx', 'San Augustine County', 'san-augustine-county', 'san-augustine'),
    ('cm7a0bgol02w0ewvgqreh8dem', 'COLDSPRING', 'TX', 'tx', 'San Jacinto County', 'san-jacinto-county', 'coldspring'),
    ('cm7a0bgol02w3ewvg91wdao6x', 'Coldspring', 'TX', 'tx', 'San Jacinto County', 'san-jacinto-county', 'coldspring'),
    ('cm7a0bgol02w6ewvg18tooffq', 'SHEPHERD', 'TX', 'tx', 'San Jacinto County', 'san-jacinto-county', 'shepherd'),
    ('cm7a0bgol02w8ewvgsa2s8313', 'Cleveland', 'TX', 'tx', 'San Jacinto County', 'san-jacinto-county', 'cleveland'),
    ('cm7a0bgol02wbewvgrsshglqm', 'POINTBLANK', 'TX', 'tx', 'San Jacinto County', 'san-jacinto-county', 'pointblank'),
    ('cm7a0bgol02weewvggu7nv46u', 'COLDSPRING', 'TX', 'tx', 'San Jacinto County', 'san-jacinto-county', 'coldspring'),
    ('cm7a0bgol02whewvgoz1ogm69', 'SHEPHERD', 'TX', 'tx', 'San Jacinto County', 'san-jacinto-county', 'shepherd'),
    ('cm7a0bgol02wkewvglyylwpsi', 'COLDSPRING', 'TX', 'tx', 'San Jacinto County', 'san-jacinto-county', 'coldspring'),
    ('cm7a0bgol02wnewvgwz3ldrc5', 'SHEPHERD', 'TX', 'tx', 'San Jacinto County', 'san-jacinto-county', 'shepherd'),
    ('cm7a0bgol02wqewvgu9444cih', 'SINTON', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'sinton'),
    ('cm7a0bgol02wtewvgk3ml55gv', 'SINTON', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'sinton'),
    ('cm7a0bgol02wwewvgpk99zlab', 'SINTON', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'sinton'),
    ('cm7a0bgol02wyewvgq65nyqq2', 'ODEM', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'odem'),
    ('cm7a0bgol02x1ewvglx0yuypi', 'PORTLAND', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'portland'),
    ('cm7a0bgol02x4ewvgrizobmi0', 'MATHIS', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'mathis'),
    ('cm7a0bgol02x6ewvgp48gmwch', 'ARANSAS PASS', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'aransas-pass'),
    ('cm7a0bgol02x8ewvg84tqy44s', 'TAFT', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'taft'),
    ('cm7a0bgol02xaewvgvp48z2cq', 'SINTON', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'sinton'),
    ('cm7a0bgol02xdewvgfminlvzx', 'SINTON', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'sinton'),
    ('cm7a0bgol02xgewvgtfja79dl', 'ARANSAS PASS', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'aransas-pass'),
    ('cm7a0bgol02xjewvgh3hrmh52', 'GREGORY', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'gregory'),
    ('cm7a0bgol02xmewvgvbevmt1t', 'INGLESIDE', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'ingleside'),
    ('cm7a0bgol02xpewvg269exnjo', 'MATHIS', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'mathis'),
    ('cm7a0bgol02xsewvg0zn2oqes', 'PORTLAND', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'portland'),
    ('cm7a0bgol02xvewvgsjqbkbfq', 'SINTON', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'sinton'),
    ('cm7a0bgom02xyewvgof6w91x2', 'TAFT', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'taft'),
    ('cm7a0bgom02y1ewvgqzj062z6', 'LAKE CITY', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'lake-city'),
    ('cm7a0bgom02y4ewvgp8ky1xol', 'TAFT', 'TX', 'tx', 'San Patricio County', 'san-patricio-county', 'taft'),
    ('cm7a0bgom02y7ewvg8zgongd7', 'SAN SABA', 'TX', 'tx', 'San Saba County', 'san-saba-county', 'san-saba'),
    ('cm7a0bgom02yaewvghpfje2oo', 'SAN SABA', 'TX', 'tx', 'San Saba County', 'san-saba-county', 'san-saba'),
    ('cm7a0bgom02ydewvgzu12nw4n', 'Richland Springs', 'TX', 'tx', 'San Saba County', 'san-saba-county', 'richland-springs'),
    ('cm7a0bgom02ygewvg60zv3ap1', 'ELDORADO', 'TX', 'tx', 'Schleicher County', 'schleicher-county', 'eldorado'),
    ('cm7a0bgom02yjewvgaz6mvbvy', 'SNYDER', 'TX', 'tx', 'Scurry County', 'scurry-county', 'snyder'),
    ('cm7a0bgom02ymewvgahf65opx', 'Snyder', 'TX', 'tx', 'Scurry County', 'scurry-county', 'snyder'),
    ('cm7a0bgom02ypewvglgi5wbee', 'SNYDER', 'TX', 'tx', 'Scurry County', 'scurry-county', 'snyder'),
    ('cm7a0bgom02ysewvg8locwo1c', 'SNYDER', 'TX', 'tx', 'Scurry County', 'scurry-county', 'snyder'),
    ('cm7a0bgom02yvewvg8ks2brm8', 'ALBANY', 'TX', 'tx', 'Shackelford County', 'shackelford-county', 'albany'),
    ('cm7a0bgom02yyewvgahzip01u', 'ALBANY', 'TX', 'tx', 'Shackelford County', 'shackelford-county', 'albany'),
    ('cm7a0bgom02z1ewvg37l3qvql', 'ALBANY', 'TX', 'tx', 'Shackelford County', 'shackelford-county', 'albany'),
    ('cm7a0bgom02z4ewvg9auo8o68', 'CENTER', 'TX', 'tx', 'Shelby County', 'shelby-county', 'center'),
    ('cm7a0bgom02z7ewvg9qk94hp4', 'Tenaha', 'TX', 'tx', 'Shelby County', 'shelby-county', 'tenaha'),
    ('cm7a0bgom02z9ewvg5162wqsp', 'Shelbyville', 'TX', 'tx', 'Shelby County', 'shelby-county', 'shelbyville'),
    ('cm7a0bgom02zcewvgh4bgsyfh', 'JOAQUIN', 'TX', 'tx', 'Shelby County', 'shelby-county', 'joaquin'),
    ('cm7a0bgom02zfewvgf1au2bgt', 'TENAHA', 'TX', 'tx', 'Shelby County', 'shelby-county', 'tenaha'),
    ('cm7a0bgom02ziewvgejc412ku', 'Timpson', 'TX', 'tx', 'Shelby County', 'shelby-county', 'timpson'),
    ('cm7a0bgom02zlewvg0oprgiy4', 'CENTER', 'TX', 'tx', 'Shelby County', 'shelby-county', 'center'),
    ('cm7a0bgom02znewvghudkirmh', 'CENTER', 'TX', 'tx', 'Shelby County', 'shelby-county', 'center'),
    ('cm7a0bgom02zqewvgqg9nf8gq', 'CENTER', 'TX', 'tx', 'Shelby County', 'shelby-county', 'center'),
    ('cm7a0bgom02ztewvg83t9zmat', 'Tenaha', 'TX', 'tx', 'Shelby County', 'shelby-county', 'tenaha'),
    ('cm7a0bgom02zwewvghu83ntnl', 'CENTER', 'TX', 'tx', 'Shelby County', 'shelby-county', 'center'),
    ('cm7a0bgom02zzewvgfbmwki7l', 'TIMPSON', 'TX', 'tx', 'Shelby County', 'shelby-county', 'timpson'),
    ('cm7a0bgom0302ewvgsqktb7wk', 'SHELBYVILLE', 'TX', 'tx', 'Shelby County', 'shelby-county', 'shelbyville'),
    ('cm7a0bgom0305ewvgpecb6tmd', 'Tenaha', 'TX', 'tx', 'Shelby County', 'shelby-county', 'tenaha'),
    ('cm7a0bgom0308ewvgu7algm3j', 'Joaquin', 'TX', 'tx', 'Shelby County', 'shelby-county', 'joaquin'),
    ('cm7a0bgom030bewvgyy2zbflk', 'STRATFORD', 'TX', 'tx', 'Sherman County', 'sherman-county', 'stratford'),
    ('cm7a0bgom030eewvg1sitke0p', 'STRATFORD', 'TX', 'tx', 'Sherman County', 'sherman-county', 'stratford'),
    ('cm7a0bgom030hewvg8s5ybm0c', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgom030kewvg46d79wk3', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgom030newvgivisukb2', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgom030qewvgl7qbv5cd', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgom030tewvg5y7jyni8', 'TROUP', 'TX', 'tx', 'Smith County', 'smith-county', 'troup'),
    ('cm7a0bgom030wewvge6c2zzim', 'WINONA', 'TX', 'tx', 'Smith County', 'smith-county', 'winona'),
    ('cm7a0bgom030zewvgvet6s9ht', 'LINDALE', 'TX', 'tx', 'Smith County', 'smith-county', 'lindale'),
    ('cm7a0bgom0312ewvg8ranqdhz', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgom0315ewvgcb4xxq3z', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgom0318ewvgo92g2xo2', 'BULLARD', 'TX', 'tx', 'Cherokee County', 'cherokee-county', 'bullard'),
    ('cm7a0bgom031bewvgkjmkmo9m', 'LINDALE', 'TX', 'tx', 'Smith County', 'smith-county', 'lindale'),
    ('cm7a0bgom031eewvgjy4nimgw', 'TROUP', 'TX', 'tx', 'Smith County', 'smith-county', 'troup'),
    ('cm7a0bgom031hewvgmj0yzped', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgom031kewvgm6pvndmi', 'Whitehouse', 'TX', 'tx', 'Smith County', 'smith-county', 'whitehouse'),
    ('cm7a0bgom031newvgx8i05w2i', 'ARP', 'TX', 'tx', 'Smith County', 'smith-county', 'arp'),
    ('cm7a0bgom031qewvgie5u9mmc', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgom031sewvg0lkcilyg', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgom031vewvgu6pbyfyv', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgom031yewvgybex4x64', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgom0321ewvg78m73m4l', 'LINDALE', 'TX', 'tx', 'Smith County', 'smith-county', 'lindale'),
    ('cm7a0bgom0324ewvgj3yql6jb', 'Winona', 'TX', 'tx', 'Smith County', 'smith-county', 'winona'),
    ('cm7a0bgom0327ewvgiszsk5pm', 'Arp', 'TX', 'tx', 'Smith County', 'smith-county', 'arp'),
    ('cm7a0bgom032aewvgucs0nusz', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgom032dewvgg2rzg39a', 'TROUP', 'TX', 'tx', 'Smith County', 'smith-county', 'troup'),
    ('cm7a0bgom032fewvgwlo9dl6h', 'GLEN ROSE', 'TX', 'tx', 'Somervell County', 'somervell-county', 'glen-rose'),
    ('cm7a0bgom032iewvgc6s3jjlt', 'GLEN ROSE', 'TX', 'tx', 'Somervell County', 'somervell-county', 'glen-rose'),
    ('cm7a0bgom032lewvg0kcnbzh4', 'GLEN ROSE', 'TX', 'tx', 'Somervell County', 'somervell-county', 'glen-rose'),
    ('cm7a0bgom032oewvgziatdhq6', 'Glen Rose', 'TX', 'tx', 'Somervell County', 'somervell-county', 'glen-rose'),
    ('cm7a0bgom032rewvg0dheqdu7', 'GLEN ROSE', 'TX', 'tx', 'Somervell County', 'somervell-county', 'glen-rose'),
    ('cm7a0bgom032uewvgeuqt5p95', 'Rio Grande City', 'TX', 'tx', 'Starr County', 'starr-county', 'rio-grande-city'),
    ('cm7a0bgom032xewvg14bu7hvu', 'RIO GRANDE CITY', 'TX', 'tx', 'Starr County', 'starr-county', 'rio-grande-city'),
    ('cm7a0bgom0330ewvgwxik43qd', 'RIO GRANDE CITY', 'TX', 'tx', 'Starr County', 'starr-county', 'rio-grande-city'),
    ('cm7a0bgom0332ewvgoc5w3961', 'ROMA', 'TX', 'tx', 'Starr County', 'starr-county', 'roma'),
    ('cm7a0bgom0334ewvge25w21t9', 'La Grulla', 'TX', 'tx', 'Starr County', 'starr-county', 'la-grulla'),
    ('cm7a0bgom0336ewvgyp0m482p', 'Rio Grande City', 'TX', 'tx', 'Starr County', 'starr-county', 'rio-grande-city'),
    ('cm7a0bgom0338ewvgc48hqb58', 'Delmita', 'TX', 'tx', 'Starr County', 'starr-county', 'delmita'),
    ('cm7a0bgom033aewvg7rvhnnuy', 'Garciasville', 'TX', 'tx', 'Starr County', 'starr-county', 'garciasville'),
    ('cm7a0bgom033dewvgtq4cnocv', 'ROMA', 'TX', 'tx', 'Starr County', 'starr-county', 'roma'),
    ('cm7a0bgom033gewvgzwsicsg3', 'ROMA', 'TX', 'tx', 'Starr County', 'starr-county', 'roma'),
    ('cm7a0bgom033iewvg1y9vkppg', 'RIO GRANDE CITY', 'TX', 'tx', 'Starr County', 'starr-county', 'rio-grande-city'),
    ('cm7a0bgom033lewvg9uevmv8p', 'RIO GRANDE CITY', 'TX', 'tx', 'Starr County', 'starr-county', 'rio-grande-city'),
    ('cm7a0bgom033oewvgqrfgn087', 'LA GRULLA', 'TX', 'tx', 'Starr County', 'starr-county', 'la-grulla'),
    ('cm7a0bgom033rewvgrec0cg7m', 'ROMA', 'TX', 'tx', 'Starr County', 'starr-county', 'roma'),
    ('cm7a0bgom033uewvgz96apnkz', 'RIO GRANDE CITY', 'TX', 'tx', 'Starr County', 'starr-county', 'rio-grande-city'),
    ('cm7a0bgom033xewvgkgcfbxo2', 'ROMA', 'TX', 'tx', 'Starr County', 'starr-county', 'roma'),
    ('cm7a0bgom0340ewvgb6o034zt', 'Roma', 'TX', 'tx', 'Starr County', 'starr-county', 'roma'),
    ('cm7a0bgom0342ewvgmiln0t72', 'RIO GRANDE CITY', 'TX', 'tx', 'Starr County', 'starr-county', 'rio-grande-city'),
    ('cm7a0bgom0345ewvgvikzsby9', 'ROMA', 'TX', 'tx', 'Starr County', 'starr-county', 'roma'),
    ('cm7a0bgon0348ewvgpu72m0mh', 'BRECKENRIDGE', 'TX', 'tx', 'Stephens County', 'stephens-county', 'breckenridge'),
    ('cm7a0bgon034bewvgo87xc494', 'BRECKENRIDGE', 'TX', 'tx', 'Stephens County', 'stephens-county', 'breckenridge'),
    ('cm7a0bgon034eewvg6ughp0w4', 'BRECKENRIDGE', 'TX', 'tx', 'Stephens County', 'stephens-county', 'breckenridge'),
    ('cm7a0bgon034hewvg449v4pf1', 'BRECKENRIDGE', 'TX', 'tx', 'Stephens County', 'stephens-county', 'breckenridge'),
    ('cm7a0bgon034jewvg9oi3sb78', 'STERLING CITY', 'TX', 'tx', 'Sterling County', 'sterling-county', 'sterling-city'),
    ('cm7a0bgon034mewvgw12x8ukc', 'ASPERMONT', 'TX', 'tx', 'Stonewall County', 'stonewall-county', 'aspermont'),
    ('cm7a0bgon034pewvg9cslpfvj', 'SONORA', 'TX', 'tx', 'Sutton County', 'sutton-county', 'sonora'),
    ('cm7a0bgon034sewvg9a6bl6yc', 'SONORA', 'TX', 'tx', 'Sutton County', 'sutton-county', 'sonora'),
    ('cm7a0bgon034vewvggi1778j3', 'TULIA', 'TX', 'tx', 'Swisher County', 'swisher-county', 'tulia'),
    ('cm7a0bgon034yewvgex2ht7lv', 'TULIA', 'TX', 'tx', 'Swisher County', 'swisher-county', 'tulia'),
    ('cm7a0bgon0350ewvg74j56hef', 'HAPPY', 'TX', 'tx', 'Swisher County', 'swisher-county', 'happy'),
    ('cm7a0bgon0353ewvg1zwu29ho', 'TULIA', 'TX', 'tx', 'Swisher County', 'swisher-county', 'tulia'),
    ('cm7a0bgon0356ewvgu64266tq', 'TULIA', 'TX', 'tx', 'Swisher County', 'swisher-county', 'tulia'),
    ('cm7a0bgon0359ewvg7iwijjuq', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon035cewvg52dxxedm', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon035fewvgho2qq9dt', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon035hewvgsej4yevg', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon035kewvgb6r48rgs', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon035newvg4u898o30', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon035qewvgvdso3hpo', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon035tewvgihxzx826', 'ARLINGTON', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'arlington'),
    ('cm7a0bgon035wewvgxfdz291u', 'HURST', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'hurst'),
    ('cm7a0bgon035zewvgt2krrc6u', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon0362ewvgbl60fn05', 'FORT  WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon0365ewvg4c1ey3ul', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon0367ewvgeloot308', 'MANSFIELD', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'mansfield'),
    ('cm7a0bgon036aewvglunko62q', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon036dewvgi7qv2yo2', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon036gewvg9tb96fzi', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon036jewvgmtrbkypq', 'ARLINGTON', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'arlington'),
    ('cm7a0bgon036mewvg9rlhers8', 'AZLE', 'TX', 'tx', 'Parker County', 'parker-county', 'azle'),
    ('cm7a0bgon036pewvgoc77q7sa', 'BEDFORD', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'bedford'),
    ('cm7a0bgon036sewvgrqrvymm2', 'BENBROOK', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'benbrook'),
    ('cm7a0bgon036vewvgs3j5qpoo', 'BLUE MOUND', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'blue-mound'),
    ('cm7a0bgon036yewvgg5k1n9cx', 'COLLEYVILLE', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'colleyville'),
    ('cm7a0bgon0371ewvgg6ahvvcy', 'CROWLEY', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'crowley'),
    ('cm7a0bgon0374ewvgw5kxx0xe', 'DALWORTHINGTON GARDENS', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'dalworthington-gardens'),
    ('cm7a0bgon0377ewvgirzq6axh', 'EULESS', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'euless'),
    ('cm7a0bgon037aewvg3a870v6y', 'EVERMAN', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'everman'),
    ('cm7a0bgon037dewvgzac7vyti', 'FOREST HILL', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'forest-hill'),
    ('cm7a0bgon037gewvgoqo5jqsu', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon037jewvg9kfj9ucf', 'SOUTHLAKE', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'southlake'),
    ('cm7a0bgon037mewvghooyayny', 'GRAPEVINE', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'grapevine'),
    ('cm7a0bgon037pewvgwkl6qxf9', 'HALTOM CITY', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'haltom-city'),
    ('cm7a0bgon037sewvg51robjpw', 'HURST', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'hurst'),
    ('cm7a0bgon037vewvgaxn1ix9c', 'KELLER', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'keller'),
    ('cm7a0bgon037yewvg190f311d', 'KENNEDALE', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'kennedale'),
    ('cm7a0bgon0381ewvgvc9lmwfg', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon0384ewvgwi1wyg3w', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon0387ewvg3xcxsuz1', 'MANSFIELD', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'mansfield'),
    ('cm7a0bgon038aewvgc84bep4k', 'NORTH RICHLAND HILLS', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'north-richland-hills'),
    ('cm7a0bgon038dewvg95b2gzhb', 'PANTEGO', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'pantego'),
    ('cm7a0bgon038gewvguofwqutu', 'RICHLAND HILLS', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'richland-hills'),
    ('cm7a0bgon038jewvgfl400fio', 'RIVER OAKS', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'river-oaks'),
    ('cm7a0bgon038mewvg6y0xvvzm', 'SAGINAW', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'saginaw'),
    ('cm7a0bgon038pewvgjajv3yqh', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon038sewvglp3nql2f', 'WATAUGA', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'watauga'),
    ('cm7a0bgon038vewvgq7opgbf7', 'WHITE SETTLEMENT', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'white-settlement'),
    ('cm7a0bgon038yewvgi3qmv7to', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon0391ewvgquvvswbt', 'WESTWORTH VILLAGE', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'westworth-village'),
    ('cm7a0bgon0394ewvgsbk9z4oo', 'AZLE', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'azle'),
    ('cm7a0bgon0397ewvgdpie8hnw', 'Arlington', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'arlington'),
    ('cm7a0bgon039aewvgjxxttrlw', 'AZLE', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'azle'),
    ('cm7a0bgon039dewvgutft4u3s', 'BEDFORD', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'bedford'),
    ('cm7a0bgon039gewvgqg3llfbd', 'COLLEYVILLE', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'colleyville'),
    ('cm7a0bgon039jewvgy9ayyi2y', 'CROWLEY', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'crowley'),
    ('cm7a0bgon039mewvgec383f6k', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon039pewvglbm7ulsw', 'GRAPEVINE', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'grapevine'),
    ('cm7a0bgon039sewvgsnhnsp0f', 'Keller', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'keller'),
    ('cm7a0bgon039vewvgc70epdba', 'north richland hills', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'north-richland-hills'),
    ('cm7a0bgon039yewvglsbn51bz', 'RIVER OAKS', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'river-oaks'),
    ('cm7a0bgon03a1ewvg7prmqcpr', 'WATAUGA', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'watauga'),
    ('cm7a0bgon03a4ewvg62z3zru0', 'WESTLAKE', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'westlake'),
    ('cm7a0bgon03a7ewvg6m2t9mib', 'Sansom Park', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'sansom-park'),
    ('cm7a0bgon03a9ewvg4qmyxphs', 'Watauga', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'watauga'),
    ('cm7a0bgon03acewvg7xf3va2x', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgon03afewvgvytclomf', 'Haltom City', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'haltom-city'),
    ('cm7a0bgoo03aiewvghdec398l', 'WHITE SETTLEMENT', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'white-settlement'),
    ('cm7a0bgoo03alewvg17wx4wuv', 'NORTH RICHLAND HILLS', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'north-richland-hills'),
    ('cm7a0bgoo03aoewvg8z6tmqto', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgoo03arewvgf31c3v2u', 'MANSFIELD', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'mansfield'),
    ('cm7a0bgoo03auewvg8og61pxx', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgoo03axewvg0brdjyho', 'FORT WORTH', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('cm7a0bgoo03b0ewvgq6rd6ecd', 'AZLE', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'azle'),
    ('cm7a0bgoo03b3ewvgwnntm0l6', 'CROWLEY', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'crowley'),
    ('cm7a0bgoo03b6ewvg0cwg6ign', 'SAGINAW', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'saginaw'),
    ('cm7a0bgoo03b9ewvga7m8613j', 'ABILENE', 'TX', 'tx', 'Taylor County', 'taylor-county', 'abilene'),
    ('cm7a0bgoo03bcewvgb9mdfqiz', 'ABILENE', 'TX', 'tx', 'Taylor County', 'taylor-county', 'abilene'),
    ('cm7a0bgoo03beewvg86fup6m8', 'ABILENE', 'TX', 'tx', 'Taylor County', 'taylor-county', 'abilene'),
    ('cm7a0bgoo03bhewvg8qb7b1dc', 'ABILENE', 'TX', 'tx', 'Taylor County', 'taylor-county', 'abilene'),
    ('cm7a0bgoo03bkewvgkbcw2qkn', 'MERKEL', 'TX', 'tx', 'Taylor County', 'taylor-county', 'merkel'),
    ('cm7a0bgoo03bmewvgo5cv6llp', 'TUSCOLA', 'TX', 'tx', 'Taylor County', 'taylor-county', 'tuscola'),
    ('cm7a0bgoo03bpewvgscx6eion', 'LAWN', 'TX', 'tx', 'Taylor County', 'taylor-county', 'lawn'),
    ('cm7a0bgoo03brewvgo92st3a4', 'Abilene', 'TX', 'tx', 'Taylor County', 'taylor-county', 'abilene'),
    ('cm7a0bgoo03btewvgtjyo4vfn', 'ABILENE', 'TX', 'tx', 'Taylor County', 'taylor-county', 'abilene'),
    ('cm7a0bgoo03bwewvgq96n11i8', 'MERKEL', 'TX', 'tx', 'Taylor County', 'taylor-county', 'merkel'),
    ('cm7a0bgoo03bzewvgfcxg2q78', 'TYE', 'TX', 'tx', 'Taylor County', 'taylor-county', 'tye'),
    ('cm7a0bgoo03c2ewvgo6je8qk0', 'ABILENE', 'TX', 'tx', 'Taylor County', 'taylor-county', 'abilene'),
    ('cm7a0bgoo03c5ewvgh1x787yl', 'ABILENE', 'TX', 'tx', 'Taylor County', 'taylor-county', 'abilene'),
    ('cm7a0bgoo03c8ewvgo8qe8sjo', 'SANDERSON', 'TX', 'tx', 'Terrell County', 'terrell-county', 'sanderson'),
    ('cm7a0bgoo03cbewvgq9e2w9h5', 'BROWNFIELD', 'TX', 'tx', 'Terry County', 'terry-county', 'brownfield'),
    ('cm7a0bgoo03ceewvganp4okdr', 'BROWNFIELD', 'TX', 'tx', 'Terry County', 'terry-county', 'brownfield'),
    ('cm7a0bgoo03chewvgtog14mh9', 'BROWNFIELD', 'TX', 'tx', 'Terry County', 'terry-county', 'brownfield'),
    ('cm7a0bgoo03ckewvgzt86x415', 'BROWNFIELD', 'TX', 'tx', 'Terry County', 'terry-county', 'brownfield'),
    ('cm7a0bgoo03cmewvggh39bi49', 'THROCKMORTON', 'TX', 'tx', 'Throckmorton County', 'throckmorton-county', 'throckmorton'),
    ('cm7a0bgoo03cpewvgdkis38o2', 'Mount Pleasant', 'TX', 'tx', 'Titus County', 'titus-county', 'mount-pleasant'),
    ('cm7a0bgoo03csewvgs8vdv1ss', 'MOUNT PLEASANT', 'TX', 'tx', 'Titus County', 'titus-county', 'mount-pleasant'),
    ('cm7a0bgoo03cvewvgudgra34h', 'MOUNT PLEASANT', 'TX', 'tx', 'Titus County', 'titus-county', 'mount-pleasant'),
    ('cm7a0bgoo03cyewvg4cgoftxi', 'MT. PLEASANT', 'TX', 'tx', 'Titus County', 'titus-county', 'mt-pleasant'),
    ('cm7a0bgoo03d1ewvgep9kh2i0', 'MT. PLEASANT', 'TX', 'tx', 'Titus County', 'titus-county', 'mt-pleasant'),
    ('cm7a0bgoo03d4ewvghvhy2jhw', 'MT. PLEASANT', 'TX', 'tx', 'Titus County', 'titus-county', 'mt-pleasant'),
    ('cm7a0bgoo03d7ewvgzmekjt2k', 'MOUNT PLEASANT', 'TX', 'tx', 'Titus County', 'titus-county', 'mount-pleasant'),
    ('cm7a0bgoo03daewvgnre5hhsx', 'MT. PLEASANT', 'TX', 'tx', 'Titus County', 'titus-county', 'mt-pleasant'),
    ('cm7a0bgoo03ddewvg3a0eyer8', 'MOUNT PLEASANT', 'TX', 'tx', 'Titus County', 'titus-county', 'mount-pleasant'),
    ('cm7a0bgoo03dgewvgii57xshp', 'MOUNT PLEASANT', 'TX', 'tx', 'Titus County', 'titus-county', 'mount-pleasant'),
    ('cm7a0bgoo03djewvgwrzslc8b', 'Mount Pleasant', 'TX', 'tx', 'Titus County', 'titus-county', 'mount-pleasant'),
    ('cm7a0bgoo03dmewvgvvbprpw5', 'SAN ANGELO', 'TX', 'tx', 'Tom Green County', 'tom-green-county', 'san-angelo'),
    ('cm7a0bgoo03dpewvgeh9q8ju0', 'SAN ANGELO', 'TX', 'tx', 'Tom Green County', 'tom-green-county', 'san-angelo'),
    ('cm7a0bgoo03dsewvgvlil7tsn', 'SAN ANGELO', 'TX', 'tx', 'Tom Green County', 'tom-green-county', 'san-angelo'),
    ('cm7a0bgoo03dvewvgtdjp9grz', 'SAN ANGELO', 'TX', 'tx', 'Tom Green County', 'tom-green-county', 'san-angelo'),
    ('cm7a0bgoo03dyewvgewgh546l', 'SAN ANGELO', 'TX', 'tx', 'Tom Green County', 'tom-green-county', 'san-angelo'),
    ('cm7a0bgoo03e1ewvgu4m4yk1n', 'SAN ANGELO', 'TX', 'tx', 'Tom Green County', 'tom-green-county', 'san-angelo'),
    ('cm7a0bgoo03e4ewvgraujgga2', 'SAN ANGELO', 'TX', 'tx', 'Tom Green County', 'tom-green-county', 'san-angelo'),
    ('cm7a0bgoo03e6ewvgbefeyezj', 'SAN ANGELO', 'TX', 'tx', 'Tom Green County', 'tom-green-county', 'san-angelo'),
    ('cm7a0bgoo03e8ewvgi16e0amj', 'SAN ANGELO', 'TX', 'tx', 'Tom Green County', 'tom-green-county', 'san-angelo'),
    ('cm7a0bgoo03ebewvg1vwbis53', 'SAN ANGELO', 'TX', 'tx', 'Tom Green County', 'tom-green-county', 'san-angelo'),
    ('cm7a0bgoo03eeewvgiq3l40jn', 'SAN ANGELO', 'TX', 'tx', 'Tom Green County', 'tom-green-county', 'san-angelo'),
    ('cm7a0bgoo03ehewvgvaf8ezho', 'SAN ANGELO', 'TX', 'tx', 'Tom Green County', 'tom-green-county', 'san-angelo'),
    ('cm7a0bgoo03ekewvgxw2elv24', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03enewvg8w5k9lvt', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03eqewvgyzq3enev', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03etewvgrf6yps2c', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03ewewvg21unxajx', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03ezewvg8h0pdvdu', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03f2ewvg7709rger', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03f5ewvglin9fqih', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03f8ewvgjodqei5l', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03fbewvg4p8lfml7', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03feewvg8ui7mh3d', 'HUNTSVILLE', 'TX', 'tx', 'Walker County', 'walker-county', 'huntsville'),
    ('cm7a0bgoo03fhewvg7tsno3n0', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03fkewvgoo627hm7', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03fmewvgcah5h8qp', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03fpewvgbzni6082', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03frewvg6dt18hlg', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03fuewvg56lq2k0b', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03fxewvg7d08rig2', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03g0ewvghffb5j80', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03g3ewvglhj97whw', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03g6ewvg58elkpke', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03g9ewvghrfxpg33', 'TYLER', 'TX', 'tx', 'Smith County', 'smith-county', 'tyler'),
    ('cm7a0bgoo03gcewvgnhzxq5ea', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03gfewvg6a82e5fu', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgoo03giewvg73ypal4o', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03glewvgykkt3km5', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03goewvgqf2w2ned', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03grewvg2enbnjr3', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03guewvgmgy7gxt6', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03gxewvgjzdtjtry', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03h0ewvg4x4y6cv0', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03h3ewvgvggbziiw', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03h6ewvgsyy5gda5', 'PFLUGERVILLE', 'TX', 'tx', 'Travis County', 'travis-county', 'pflugerville'),
    ('cm7a0bgop03h9ewvgi6qr0ud2', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03hcewvga1r4h6qh', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03heewvg1lq77snr', 'WEST LAKE HILLS', 'TX', 'tx', 'Travis County', 'travis-county', 'west-lake-hills'),
    ('cm7a0bgop03hhewvgt87mgv9w', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03hkewvgj4l6c4sa', 'JONESTOWN', 'TX', 'tx', 'Travis County', 'travis-county', 'jonestown'),
    ('cm7a0bgop03hnewvgrqoh7emy', 'LAGO VISTA', 'TX', 'tx', 'Travis County', 'travis-county', 'lago-vista'),
    ('cm7a0bgop03hqewvgctc06j4v', 'MANOR', 'TX', 'tx', 'Travis County', 'travis-county', 'manor'),
    ('cm7a0bgop03htewvgdkw5gc4a', 'MUSTANG RIDGE', 'TX', 'tx', 'Travis County', 'travis-county', 'mustang-ridge'),
    ('cm7a0bgop03hwewvgv9oa9oou', 'BEE CAVE', 'TX', 'tx', 'Travis County', 'travis-county', 'bee-cave'),
    ('cm7a0bgop03hzewvghigbtawx', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03i1ewvgkz5zwj9i', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03i4ewvgsw6czchd', 'Lago Vista', 'TX', 'tx', 'Travis County', 'travis-county', 'lago-vista'),
    ('cm7a0bgop03i7ewvgvldj35em', 'Lakeway', 'TX', 'tx', 'Travis County', 'travis-county', 'lakeway'),
    ('cm7a0bgop03iaewvgd6evtdsw', 'Austin', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03icewvgwrqse3sy', 'Manor', 'TX', 'tx', 'Travis County', 'travis-county', 'manor'),
    ('cm7a0bgop03ieewvg3dobqr9l', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03ihewvgeletue7d', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03ikewvghog74mqr', 'AUSTIN', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03inewvgfzdj6c3d', 'PFLUGERVILLE', 'TX', 'tx', 'Travis County', 'travis-county', 'pflugerville'),
    ('cm7a0bgop03iqewvgoqgyck20', 'MANOR', 'TX', 'tx', 'Travis County', 'travis-county', 'manor'),
    ('cm7a0bgop03itewvgnv2ydynb', 'DEL VALLE', 'TX', 'tx', 'Travis County', 'travis-county', 'del-valle'),
    ('cm7a0bgop03iwewvgwvd1lvka', 'Austin', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03izewvgr8f34dbh', 'Austin', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgop03j1ewvgmsuk97ml', 'GROVETON', 'TX', 'tx', 'Trinity County', 'trinity-county', 'groveton'),
    ('cm7a0bgop03j4ewvgumiacx45', 'Groveton', 'TX', 'tx', 'Trinity County', 'trinity-county', 'groveton'),
    ('cm7a0bgop03j7ewvg0gftrr43', 'Trinity', 'TX', 'tx', 'Trinity County', 'trinity-county', 'trinity'),
    ('cm7a0bgop03j9ewvgt9nllpwd', 'TRINITY', 'TX', 'tx', 'Trinity County', 'trinity-county', 'trinity'),
    ('cm7a0bgop03jbewvguoqaf5bi', 'Apple Springs', 'TX', 'tx', 'Trinity County', 'trinity-county', 'apple-springs'),
    ('cm7a0bgop03jeewvga5clh6vi', 'GROVETON', 'TX', 'tx', 'Trinity County', 'trinity-county', 'groveton'),
    ('cm7a0bgop03jhewvg6ygfamd6', 'TRINITY', 'TX', 'tx', 'Trinity County', 'trinity-county', 'trinity'),
    ('cm7a0bgop03jkewvgmraag0i8', 'TRINITY', 'TX', 'tx', 'Trinity County', 'trinity-county', 'trinity'),
    ('cm7a0bgop03jnewvg6lhafdbx', 'WOODVILLE', 'TX', 'tx', 'Tyler County', 'tyler-county', 'woodville'),
    ('cm7a0bgop03jqewvgs84za693', 'Woodville', 'TX', 'tx', 'Tyler County', 'tyler-county', 'woodville'),
    ('cm7a0bgop03jtewvg9xht01wl', 'Woodville', 'TX', 'tx', 'Tyler County', 'tyler-county', 'woodville'),
    ('cm7a0bgop03jvewvgwoqai6x8', 'COLMESNEIL', 'TX', 'tx', 'Tyler County', 'tyler-county', 'colmesneil'),
    ('cm7a0bgop03jxewvg4u2ixic2', 'Woodville', 'TX', 'tx', 'Tyler County', 'tyler-county', 'woodville'),
    ('cm7a0bgop03jzewvg5qe9563z', 'WOODVILLE', 'TX', 'tx', 'Tyler County', 'tyler-county', 'woodville'),
    ('cm7a0bgop03k2ewvgjyp5ii0l', 'WOODVILLE', 'TX', 'tx', 'Tyler County', 'tyler-county', 'woodville'),
    ('cm7a0bgop03k5ewvgcf1nptu5', 'WOODVILLE', 'TX', 'tx', 'Tyler County', 'tyler-county', 'woodville'),
    ('cm7a0bgop03k7ewvg35yj696c', 'Warren', 'TX', 'tx', 'Tyler County', 'tyler-county', 'warren'),
    ('cm7a0bgop03kaewvg0jcngo4e', 'GILMER', 'TX', 'tx', 'Upshur County', 'upshur-county', 'gilmer'),
    ('cm7a0bgop03kdewvgavgjl4vc', 'GILMER', 'TX', 'tx', 'Upshur County', 'upshur-county', 'gilmer'),
    ('cm7a0bgop03kgewvgrlheswb0', 'Gilmer', 'TX', 'tx', 'Upshur County', 'upshur-county', 'gilmer'),
    ('cm7a0bgop03kjewvgp01oijjn', 'Gladewater', 'TX', 'tx', 'Upshur County', 'upshur-county', 'gladewater'),
    ('cm7a0bgop03kmewvg2oryuao5', 'GILMER', 'TX', 'tx', 'Upshur County', 'upshur-county', 'gilmer'),
    ('cm7a0bgop03koewvgjo4595bt', 'GILMER', 'TX', 'tx', 'Upshur County', 'upshur-county', 'gilmer'),
    ('cm7a0bgop03krewvgbv3sl508', 'BIG SANDY', 'TX', 'tx', 'Upshur County', 'upshur-county', 'big-sandy'),
    ('cm7a0bgop03kuewvg3w571oh4', 'GILMER', 'TX', 'tx', 'Upshur County', 'upshur-county', 'gilmer'),
    ('cm7a0bgop03kxewvg9c8gntr0', 'ORE CITY', 'TX', 'tx', 'Upshur County', 'upshur-county', 'ore-city'),
    ('cm7a0bgop03l0ewvgo8gkcaaa', 'GILMER', 'TX', 'tx', 'Upshur County', 'upshur-county', 'gilmer'),
    ('cm7a0bgop03l3ewvgjleel17r', 'Rankin', 'TX', 'tx', 'Upton County', 'upton-county', 'rankin'),
    ('cm7a0bgop03l6ewvgcghzjvtt', 'RANKIN', 'TX', 'tx', 'Upton County', 'upton-county', 'rankin'),
    ('cm7a0bgop03l9ewvgebglraqi', 'Midkiff', 'TX', 'tx', 'Upton County', 'upton-county', 'midkiff'),
    ('cm7a0bgop03lbewvgj18oiki0', 'RANKIN', 'TX', 'tx', 'Upton County', 'upton-county', 'rankin'),
    ('cm7a0bgop03ldewvg9yuh9zou', 'UVALDE', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'uvalde'),
    ('cm7a0bgop03lfewvgrthynicl', 'UVALDE', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'uvalde'),
    ('cm7a0bgop03liewvg650z29ov', 'UVALDE', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'uvalde'),
    ('cm7a0bgop03llewvg2gz63tki', 'SABINAL', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'sabinal'),
    ('cm7a0bgop03loewvg93d8mirz', 'Concan', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'concan'),
    ('cm7a0bgop03lqewvg19cszexq', 'UVALDE', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'uvalde'),
    ('cm7a0bgop03lsewvgneuh2jdm', 'UVALDE', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'uvalde'),
    ('cm7a0bgop03luewvgsis7woch', 'UVALDE', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'uvalde'),
    ('cm7a0bgop03lxewvg70ytxh65', 'HONDO', 'TX', 'tx', 'Medina County', 'medina-county', 'hondo'),
    ('cm7a0bgop03m0ewvgujzary08', 'Uvalde', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'uvalde'),
    ('cm7a0bgop03m3ewvg0nt2eqon', 'SABINAL', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'sabinal'),
    ('cm7a0bgop03m6ewvgcsqm2f5s', 'UVALDE', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'uvalde'),
    ('cm7a0bgop03m9ewvgc10dqdrg', 'Uvalde', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'uvalde'),
    ('cm7a0bgop03mcewvgwwsx0lww', 'KNIPPA', 'TX', 'tx', 'Uvalde County', 'uvalde-county', 'knippa'),
    ('cm7a0bgop03meewvgxndeb5yd', 'Del RIo', 'TX', 'tx', 'Val Verde County', 'val-verde-county', 'del-rio'),
    ('cm7a0bgop03mhewvgzutjd2lc', 'DEL RIO', 'TX', 'tx', 'Val Verde County', 'val-verde-county', 'del-rio'),
    ('cm7a0bgop03mkewvganw3nnnw', 'DEL RIO', 'TX', 'tx', 'Val Verde County', 'val-verde-county', 'del-rio'),
    ('cm7a0bgop03mnewvg5rcv7g2u', 'DEL RIO', 'TX', 'tx', 'Val Verde County', 'val-verde-county', 'del-rio'),
    ('cm7a0bgoq03mqewvgkfkdmfr7', 'DEL RIO', 'TX', 'tx', 'Val Verde County', 'val-verde-county', 'del-rio'),
    ('cm7a0bgoq03mtewvg16q7asul', 'DEL RIO', 'TX', 'tx', 'Val Verde County', 'val-verde-county', 'del-rio'),
    ('cm7a0bgoq03mwewvgg1b888nq', 'DEL RIO', 'TX', 'tx', 'Val Verde County', 'val-verde-county', 'del-rio'),
    ('cm7a0bgoq03mzewvg5bt6re5w', 'DEL RIO', 'TX', 'tx', 'Val Verde County', 'val-verde-county', 'del-rio'),
    ('cm7a0bgoq03n2ewvgomg3nmdw', 'DEL RIO', 'TX', 'tx', 'Val Verde County', 'val-verde-county', 'del-rio'),
    ('cm7a0bgoq03n5ewvg267qxniq', 'CANTON', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'canton'),
    ('cm7a0bgoq03n8ewvgnu5f9z7k', 'CANTON', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'canton'),
    ('cm7a0bgoq03nbewvgne1g6kp5', 'GRAND SALINE', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'grand-saline'),
    ('cm7a0bgoq03neewvgdlsm7igd', 'Canton', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'canton'),
    ('cm7a0bgoq03ngewvgt6bl7ady', 'WILLS POINT', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'wills-point'),
    ('cm7a0bgoq03njewvgc7vcxgqp', 'BEN WHEELER', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'ben-wheeler'),
    ('cm7a0bgoq03nmewvgn1rezsz3', 'Canton', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'canton'),
    ('cm7a0bgoq03npewvgrv3x3deh', 'Canton', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'canton'),
    ('cm7a0bgoq03nsewvgfuo4pl6i', 'EDGEWOOD', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'edgewood'),
    ('cm7a0bgoq03nvewvgj2g5kxs7', 'GRAND SALINE', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'grand-saline'),
    ('cm7a0bgoq03nyewvgmrb8apa9', 'VAN', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'van'),
    ('cm7a0bgoq03o1ewvgco1qtgm3', 'WILLS POINT', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'wills-point'),
    ('cm7a0bgoq03o4ewvgkajwvkcx', 'Canton', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'canton'),
    ('cm7a0bgoq03o6ewvgsaot15xv', 'Grand Saline', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'grand-saline'),
    ('cm7a0bgoq03o9ewvgtqnd4gao', 'VAN', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'van'),
    ('cm7a0bgoq03ocewvgwhgbu08q', 'Canton', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'canton'),
    ('cm7a0bgoq03ofewvgsqsg31cx', 'FRUITVALE', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'fruitvale'),
    ('cm7a0bgoq03oiewvgjefsu7iq', 'Wills Point', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'wills-point'),
    ('cm7a0bgoq03okewvgpi4up2k7', 'Edgewood', 'TX', 'tx', 'Van Zandt County', 'van-zandt-county', 'edgewood'),
    ('cm7a0bgoq03onewvg7trdyjug', 'VICTORIA', 'TX', 'tx', 'Victoria County', 'victoria-county', 'victoria'),
    ('cm7a0bgoq03oqewvg97wj7jfi', 'Victoria', 'TX', 'tx', 'Victoria County', 'victoria-county', 'victoria'),
    ('cm7a0bgoq03otewvgx2u6qsd2', 'VICTORIA', 'TX', 'tx', 'Victoria County', 'victoria-county', 'victoria'),
    ('cm7a0bgoq03owewvgawhs990e', 'VICTORIA', 'TX', 'tx', 'Victoria County', 'victoria-county', 'victoria'),
    ('cm7a0bgoq03oyewvgsuwrgcja', 'VICTORIA', 'TX', 'tx', 'Victoria County', 'victoria-county', 'victoria'),
    ('cm7a0bgoq03p0ewvg1xxxwsot', 'VICTORIA', 'TX', 'tx', 'Victoria County', 'victoria-county', 'victoria'),
    ('cm7a0bgoq03p2ewvgdzj4yrqm', 'Victoria', 'TX', 'tx', 'Victoria County', 'victoria-county', 'victoria'),
    ('cm7a0bgoq03p4ewvgvhiye30x', 'VICTORIA', 'TX', 'tx', 'Victoria County', 'victoria-county', 'victoria'),
    ('cm7a0bgoq03p7ewvgkbq87pqr', 'VICTORIA', 'TX', 'tx', 'Victoria County', 'victoria-county', 'victoria'),
    ('cm7a0bgoq03paewvgbkjaszm1', 'VICTORIA', 'TX', 'tx', 'Victoria County', 'victoria-county', 'victoria'),
    ('cm7a0bgoq03pdewvge1z1al06', 'VICTORIA', 'TX', 'tx', 'Victoria County', 'victoria-county', 'victoria'),
    ('cm7a0bgoq03pgewvgsm4g3244', 'HUNTSVILLE', 'TX', 'tx', 'Walker County', 'walker-county', 'huntsville'),
    ('cm7a0bgoq03piewvgq7oqb340', 'HUNTSVILLE', 'TX', 'tx', 'Walker County', 'walker-county', 'huntsville'),
    ('cm7a0bgoq03plewvguqkyla3n', 'HUNTSVILLE', 'TX', 'tx', 'Walker County', 'walker-county', 'huntsville'),
    ('cm7a0bgoq03poewvgvbr08ytk', 'HUNTSVILLE', 'TX', 'tx', 'Walker County', 'walker-county', 'huntsville'),
    ('cm7a0bgoq03pqewvg5ddghp46', 'HUNTSVILLE', 'TX', 'tx', 'Walker County', 'walker-county', 'huntsville'),
    ('cm7a0bgoq03ptewvgisoyd7ai', 'HUNTSVILLE', 'TX', 'tx', 'Walker County', 'walker-county', 'huntsville'),
    ('cm7a0bgoq03pwewvg350qmfr4', 'NEW WAVERLY', 'TX', 'tx', 'Walker County', 'walker-county', 'new-waverly'),
    ('cm7a0bgoq03pzewvgs71jmxsy', 'HUNTSVILLE', 'TX', 'tx', 'Walker County', 'walker-county', 'huntsville'),
    ('cm7a0bgoq03q1ewvge8jy4wj1', 'HUNTSVILLE', 'TX', 'tx', 'Walker County', 'walker-county', 'huntsville'),
    ('cm7a0bgoq03q4ewvgtfb0qxrf', 'PRAIRIE VIEW', 'TX', 'tx', 'Waller County', 'waller-county', 'prairie-view'),
    ('cm7a0bgoq03q7ewvgqmha1g4h', 'HEMPSTEAD', 'TX', 'tx', 'Waller County', 'waller-county', 'hempstead'),
    ('cm7a0bgoq03qaewvga55mf08o', 'HEMPSTEAD', 'TX', 'tx', 'Waller County', 'waller-county', 'hempstead'),
    ('cm7a0bgoq03qdewvg4h88ihma', 'HEMPSTEAD', 'TX', 'tx', 'Waller County', 'waller-county', 'hempstead'),
    ('cm7a0bgoq03qgewvg2oc9xiw5', 'WALLER', 'TX', 'tx', 'Waller County', 'waller-county', 'waller'),
    ('cm7a0bgoq03qjewvguau9rteo', 'HEMPSTEAD', 'TX', 'tx', 'Waller County', 'waller-county', 'hempstead'),
    ('cm7a0bgoq03qmewvgvt4xhncu', 'PATTISON', 'TX', 'tx', 'Waller County', 'waller-county', 'pattison'),
    ('cm7a0bgoq03qoewvg2v9fzzhx', 'HEMPSTEAD', 'TX', 'tx', 'Waller County', 'waller-county', 'hempstead'),
    ('cm7a0bgoq03qrewvgn8fgmc68', 'Waller', 'TX', 'tx', 'Waller County', 'waller-county', 'waller'),
    ('cm7a0bgoq03quewvgtcmrzyow', 'BROOKSHIRE', 'TX', 'tx', 'Waller County', 'waller-county', 'brookshire'),
    ('cm7a0bgoq03qxewvgwnpgb9g7', 'HEMPSTEAD', 'TX', 'tx', 'Waller County', 'waller-county', 'hempstead'),
    ('cm7a0bgoq03r0ewvgz8je5t0a', 'PRAIRIE VIEW', 'TX', 'tx', 'Waller County', 'waller-county', 'prairie-view'),
    ('cm7a0bgoq03r3ewvgsjnbhzgm', 'WALLER', 'TX', 'tx', 'Waller County', 'waller-county', 'waller'),
    ('cm7a0bgoq03r6ewvg8xu9xhcz', 'HEMPSTEAD', 'TX', 'tx', 'Waller County', 'waller-county', 'hempstead'),
    ('cm7a0bgoq03r9ewvgai2uexgk', 'PATTISON', 'TX', 'tx', 'Waller County', 'waller-county', 'pattison'),
    ('cm7a0bgoq03rcewvgl5u5vh0v', 'MONAHANS', 'TX', 'tx', 'Ward County', 'ward-county', 'monahans'),
    ('cm7a0bgoq03rfewvgv5ulsng1', 'MONAHANS', 'TX', 'tx', 'Ward County', 'ward-county', 'monahans'),
    ('cm7a0bgoq03rhewvgz317xwxh', 'MONAHANS', 'TX', 'tx', 'Ward County', 'ward-county', 'monahans'),
    ('cm7a0bgoq03rjewvg1uzf8o96', 'PECOS', 'TX', 'tx', 'Reeves County', 'reeves-county', 'pecos'),
    ('cm7a0bgoq03rmewvgmrx54j9g', 'MONAHANS', 'TX', 'tx', 'Ward County', 'ward-county', 'monahans'),
    ('cm7a0bgoq03rpewvgn1a0legt', 'WICKETT', 'TX', 'tx', 'Ward County', 'ward-county', 'wickett'),
    ('cm7a0bgoq03rsewvgiwbxmtc4', 'MONAHANS', 'TX', 'tx', 'Ward County', 'ward-county', 'monahans'),
    ('cm7a0bgoq03rvewvgdnkywdij', 'BRENHAM', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm7a0bgoq03ryewvgb0ypr2zk', 'BRENHAM', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm7a0bgoq03s1ewvg4p3unax3', 'BRENHAM', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm7a0bgoq03s4ewvgyt4udt2w', 'BRENHAM', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm7a0bgoq03s6ewvghny0repb', 'Brenham', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm7a0bgoq03s8ewvg5sohi4n4', 'Brenham', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm7a0bgoq03saewvgznsh5679', 'BRENHAM', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm7a0bgoq03sdewvgulilgt92', 'Brenham', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm7a0bgoq03sgewvgv4jct3mu', 'Brenham', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm7a0bgoq03sjewvg8wir4yv1', 'BRENHAM', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm7a0bgoq03smewvg7hgnfq3r', 'BRENHAM', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm7a0bgoq03spewvgtfxvwq4c', 'BRENHAM', 'TX', 'tx', 'Washington County', 'washington-county', 'brenham'),
    ('cm7a0bgoq03ssewvgi0xih3a6', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgoq03svewvgnuv461b7', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03sxewvg8mvneyyu', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03t0ewvgz0w1ulib', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03t3ewvgbwvg2643', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03t6ewvgjnmzebd3', 'OILTON', 'TX', 'tx', 'Webb County', 'webb-county', 'oilton'),
    ('cm7a0bgor03t9ewvgi8w8tuwe', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03tcewvgekchp499', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03tfewvgcc2k4u2t', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03tiewvg0ef3ctqh', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03tkewvgl6lu7mbz', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03tnewvgnttysejh', 'RIO BRAVO', 'TX', 'tx', 'Webb County', 'webb-county', 'rio-bravo'),
    ('cm7a0bgor03tqewvgabi0kc4o', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03ttewvgqr9mt5oj', 'Laredo', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03tvewvgd8n5yeb0', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03tyewvg6ljtq81l', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03u1ewvg8l2yfqdf', 'BRUNI', 'TX', 'tx', 'Webb County', 'webb-county', 'bruni'),
    ('cm7a0bgor03u4ewvgs5udfdp8', 'LAREDO', 'TX', 'tx', 'Webb County', 'webb-county', 'laredo'),
    ('cm7a0bgor03u7ewvg0tc9cvdh', 'WHARTON', 'TX', 'tx', 'Wharton County', 'wharton-county', 'wharton'),
    ('cm7a0bgor03uaewvgo5s26ycp', 'WHARTON', 'TX', 'tx', 'Wharton County', 'wharton-county', 'wharton'),
    ('cm7a0bgor03udewvgtfv7yv3k', 'EAST BERNARD', 'TX', 'tx', 'Wharton County', 'wharton-county', 'east-bernard'),
    ('cm7a0bgor03ugewvgv5vw31t1', 'LOUISE', 'TX', 'tx', 'Wharton County', 'wharton-county', 'louise'),
    ('cm7a0bgor03ujewvg3203fsq7', 'EL CAMPO', 'TX', 'tx', 'Wharton County', 'wharton-county', 'el-campo'),
    ('cm7a0bgor03umewvgg647e7jm', 'WHARTON', 'TX', 'tx', 'Wharton County', 'wharton-county', 'wharton'),
    ('cm7a0bgor03upewvg7d3z6p5k', 'EL CAMPO', 'TX', 'tx', 'Wharton County', 'wharton-county', 'el-campo'),
    ('cm7a0bgor03usewvgj8gxrksi', 'WHARTON', 'TX', 'tx', 'Wharton County', 'wharton-county', 'wharton'),
    ('cm7a0bgor03uvewvg5d5clqja', 'WHARTON', 'TX', 'tx', 'Wharton County', 'wharton-county', 'wharton'),
    ('cm7a0bgor03uyewvgxs63t3o1', 'WHEELER', 'TX', 'tx', 'Wheeler County', 'wheeler-county', 'wheeler'),
    ('cm7a0bgor03v1ewvgs4ziut7l', 'WHEELER', 'TX', 'tx', 'Wheeler County', 'wheeler-county', 'wheeler'),
    ('cm7a0bgor03v3ewvg7ad2b1zz', 'SHAMROCK', 'TX', 'tx', 'Wheeler County', 'wheeler-county', 'shamrock'),
    ('cm7a0bgor03v6ewvgaj3wugrb', 'WICHITA FALLS', 'TX', 'tx', 'Wichita County', 'wichita-county', 'wichita-falls'),
    ('cm7a0bgor03v9ewvgdvfdgjy5', 'Wichita Falls', 'TX', 'tx', 'Wichita County', 'wichita-county', 'wichita-falls'),
    ('cm7a0bgor03vcewvgltyhy8mw', 'WICHITA FALLS', 'TX', 'tx', 'Wichita County', 'wichita-county', 'wichita-falls'),
    ('cm7a0bgor03vfewvgqjp54zg2', 'WICHITA FALLS', 'TX', 'tx', 'Wichita County', 'wichita-county', 'wichita-falls'),
    ('cm7a0bgor03viewvgheaoiznv', 'BURKBURNETT', 'TX', 'tx', 'Wichita County', 'wichita-county', 'burkburnett'),
    ('cm7a0bgor03vkewvgh067j9s0', 'IOWA PARK', 'TX', 'tx', 'Wichita County', 'wichita-county', 'iowa-park'),
    ('cm7a0bgor03vmewvgrmqnkcth', 'ELECTRA', 'TX', 'tx', 'Wichita County', 'wichita-county', 'electra'),
    ('cm7a0bgor03vpewvgk3nn5nly', 'WICHITA FALLS', 'TX', 'tx', 'Wichita County', 'wichita-county', 'wichita-falls'),
    ('cm7a0bgor03vrewvg5yai0i6x', 'BURKBURNETT', 'TX', 'tx', 'Wichita County', 'wichita-county', 'burkburnett'),
    ('cm7a0bgor03vuewvg6oblz0z5', 'ELECTRA', 'TX', 'tx', 'Wichita County', 'wichita-county', 'electra'),
    ('cm7a0bgor03vxewvgh8azyyeq', 'IOWA PARK', 'TX', 'tx', 'Wichita County', 'wichita-county', 'iowa-park'),
    ('cm7a0bgor03w0ewvgo7vb2c3r', 'WICHITA FALLS', 'TX', 'tx', 'Wichita County', 'wichita-county', 'wichita-falls'),
    ('cm7a0bgor03w3ewvgj3ndfwcw', 'WICHITA FALLS', 'TX', 'tx', 'Wichita County', 'wichita-county', 'wichita-falls'),
    ('cm7a0bgor03w5ewvgydmvsdl4', 'WICHITA FALLS', 'TX', 'tx', 'Wichita County', 'wichita-county', 'wichita-falls'),
    ('cm7a0bgor03w8ewvgwprdinxb', 'WICHITA FALLS', 'TX', 'tx', 'Wichita County', 'wichita-county', 'wichita-falls'),
    ('cm7a0bgor03wbewvgoaf6ti62', 'IOWA PARK', 'TX', 'tx', 'Wichita County', 'wichita-county', 'iowa-park'),
    ('cm7a0bgor03weewvgcgcpvibw', 'Burkburnett', 'TX', 'tx', 'Wichita County', 'wichita-county', 'burkburnett'),
    ('cm7a0bgor03whewvgjrgx9bir', 'Wichita Falls', 'TX', 'tx', 'Wichita County', 'wichita-county', 'wichita-falls'),
    ('cm7a0bgor03wkewvg49t0y1go', 'VERNON', 'TX', 'tx', 'Wilbarger County', 'wilbarger-county', 'vernon'),
    ('cm7a0bgor03wmewvg7ql0rffu', 'Vernon', 'TX', 'tx', 'Wilbarger County', 'wilbarger-county', 'vernon'),
    ('cm7a0bgor03wpewvgsq6qhjy9', 'Vernon', 'TX', 'tx', 'Wilbarger County', 'wilbarger-county', 'vernon'),
    ('cm7a0bgor03wsewvgxx5t9wnc', 'VERNON', 'TX', 'tx', 'Wilbarger County', 'wilbarger-county', 'vernon'),
    ('cm7a0bgor03wvewvggu8frhss', 'VERNON', 'TX', 'tx', 'Wilbarger County', 'wilbarger-county', 'vernon'),
    ('cm7a0bgor03wyewvgrld4ihe3', 'VERNON', 'TX', 'tx', 'Wilbarger County', 'wilbarger-county', 'vernon'),
    ('cm7a0bgor03x1ewvgh1gqat17', 'VERNON', 'TX', 'tx', 'Wilbarger County', 'wilbarger-county', 'vernon'),
    ('cm7a0bgor03x3ewvgcq6alhfh', 'VERNON', 'TX', 'tx', 'Wilbarger County', 'wilbarger-county', 'vernon'),
    ('cm7a0bgor03x6ewvgcc0h75ts', 'VERNON', 'TX', 'tx', 'Wilbarger County', 'wilbarger-county', 'vernon'),
    ('cm7a0bgor03x9ewvgvuzbqbxn', 'RAYMONDVILLE', 'TX', 'tx', 'Willacy County', 'willacy-county', 'raymondville'),
    ('cm7a0bgor03xcewvgqpe4judc', 'RAYMONDVILLE', 'TX', 'tx', 'Willacy County', 'willacy-county', 'raymondville'),
    ('cm7a0bgor03xfewvguwq5ihgw', 'Raymondville', 'TX', 'tx', 'Willacy County', 'willacy-county', 'raymondville'),
    ('cm7a0bgor03xhewvgtw5kesw0', 'RAYMONDVILLE', 'TX', 'tx', 'Willacy County', 'willacy-county', 'raymondville'),
    ('cm7a0bgor03xjewvgon14pnfm', 'Sebastian', 'TX', 'tx', 'Willacy County', 'willacy-county', 'sebastian'),
    ('cm7a0bgor03xmewvg428r8nnk', 'RAYMONDVILLE', 'TX', 'tx', 'Willacy County', 'willacy-county', 'raymondville'),
    ('cm7a0bgor03xpewvgrl4uiayn', 'RAYMONDVILLE', 'TX', 'tx', 'Willacy County', 'willacy-county', 'raymondville'),
    ('cm7a0bgor03xsewvgzowpk2nk', 'Lyford', 'TX', 'tx', 'Willacy County', 'willacy-county', 'lyford'),
    ('cm7a0bgor03xvewvgdenlu5bu', 'RAYMONDVILLE', 'TX', 'tx', 'Willacy County', 'willacy-county', 'raymondville'),
    ('cm7a0bgor03xyewvg3hw97ap0', 'Raymondville', 'TX', 'tx', 'Willacy County', 'willacy-county', 'raymondville'),
    ('cm7a0bgor03y1ewvg63iuasgn', 'Lyford', 'TX', 'tx', 'Willacy County', 'willacy-county', 'lyford'),
    ('cm7a0bgor03y4ewvg4p5umfdy', 'RAYMONDVILLE', 'TX', 'tx', 'Willacy County', 'willacy-county', 'raymondville'),
    ('cm7a0bgor03y7ewvgg8a1mad0', 'GEORGETOWN', 'TX', 'tx', 'Williamson County', 'williamson-county', 'georgetown'),
    ('cm7a0bgor03yaewvgbk1fij69', 'GEORGETOWN', 'TX', 'tx', 'Williamson County', 'williamson-county', 'georgetown'),
    ('cm7a0bgor03ydewvgs00cwfzo', 'ROUND ROCK', 'TX', 'tx', 'Williamson County', 'williamson-county', 'round-rock'),
    ('cm7a0bgor03ygewvgz25xkblz', 'CEDAR PARK', 'TX', 'tx', 'Williamson County', 'williamson-county', 'cedar-park'),
    ('cm7a0bgor03yjewvgja40nqkk', 'GEORGETOWN', 'TX', 'tx', 'Williamson County', 'williamson-county', 'georgetown'),
    ('cm7a0bgor03ymewvgpg049i7x', 'TAYLOR', 'TX', 'tx', 'Williamson County', 'williamson-county', 'taylor'),
    ('cm7a0bgor03ypewvgmaf5ljey', 'GEORGETOWN', 'TX', 'tx', 'Williamson County', 'williamson-county', 'georgetown'),
    ('cm7a0bgor03yrewvg5969cojg', 'GEORGETOWN', 'TX', 'tx', 'Williamson County', 'williamson-county', 'georgetown'),
    ('cm7a0bgor03yuewvgqfa7jnzw', 'GEORGETOWN', 'TX', 'tx', 'Williamson County', 'williamson-county', 'georgetown'),
    ('cm7a0bgor03yxewvgw297nlx3', 'Georgetown', 'TX', 'tx', 'Williamson County', 'williamson-county', 'georgetown'),
    ('cm7a0bgor03z0ewvg4pnwidgp', 'Liberty Hill', 'TX', 'tx', 'Williamson County', 'williamson-county', 'liberty-hill'),
    ('cm7a0bgor03z3ewvgezcl1zk9', 'BARTLETT', 'TX', 'tx', 'Bell County', 'bell-county', 'bartlett'),
    ('cm7a0bgos03z6ewvg0iukmbjz', 'CEDAR PARK', 'TX', 'tx', 'Williamson County', 'williamson-county', 'cedar-park'),
    ('cm7a0bgos03z9ewvgw533ggwx', 'FLORENCE', 'TX', 'tx', 'Williamson County', 'williamson-county', 'florence'),
    ('cm7a0bgos03zcewvgndb3irce', 'GEORGETOWN', 'TX', 'tx', 'Williamson County', 'williamson-county', 'georgetown'),
    ('cm7a0bgos03zfewvgc3xnoo4t', 'GRANGER', 'TX', 'tx', 'Williamson County', 'williamson-county', 'granger'),
    ('cm7a0bgos03ziewvgbkazehf1', 'HUTTO', 'TX', 'tx', 'Williamson County', 'williamson-county', 'hutto'),
    ('cm7a0bgos03zlewvg208gjgps', 'ROUND ROCK', 'TX', 'tx', 'Williamson County', 'williamson-county', 'round-rock'),
    ('cm7a0bgos03zoewvgbzaolqs4', 'TAYLOR', 'TX', 'tx', 'Williamson County', 'williamson-county', 'taylor'),
    ('cm7a0bgos03zrewvgs0008wd0', 'THRALL', 'TX', 'tx', 'Williamson County', 'williamson-county', 'thrall'),
    ('cm7a0bgos03zuewvgvp4cjcje', 'LEANDER', 'TX', 'tx', 'Williamson County', 'williamson-county', 'leander'),
    ('cm7a0bgos03zxewvge6xwm26s', 'JARRELL', 'TX', 'tx', 'Williamson County', 'williamson-county', 'jarrell'),
    ('cm7a0bgos0400ewvgseubfmii', 'LIBERTY HILL', 'TX', 'tx', 'Liberty County', 'liberty-county', 'liberty-hill'),
    ('cm7a0bgos0403ewvgumbvq2fc', 'ROUND ROCK', 'TX', 'tx', 'Williamson County', 'williamson-county', 'round-rock'),
    ('cm7a0bgos0406ewvgbhngrdba', 'LIBERTY HILL', 'TX', 'tx', 'Williamson County', 'williamson-county', 'liberty-hill'),
    ('cm7a0bgos0409ewvgwedc45dr', 'HUTTO', 'TX', 'tx', 'Williamson County', 'williamson-county', 'hutto'),
    ('cm7a0bgos040cewvg63z8uoyp', 'ROUND ROCK', 'TX', 'tx', 'Williamson County', 'williamson-county', 'round-rock'),
    ('cm7a0bgos040fewvg0pkvy8zo', 'JARRELL', 'TX', 'tx', 'Williamson County', 'williamson-county', 'jarrell'),
    ('cm7a0bgos040iewvgq6gpeprz', 'FLORESVILLE', 'TX', 'tx', 'Wilson County', 'wilson-county', 'floresville'),
    ('cm7a0bgos040lewvgpv5k5trh', 'FLORESVILLE', 'TX', 'tx', 'Wilson County', 'wilson-county', 'floresville'),
    ('cm7a0bgos040newvgzeg16lxk', 'FLORESVILLE', 'TX', 'tx', 'Wilson County', 'wilson-county', 'floresville'),
    ('cm7a0bgos040qewvg39pcycvu', 'Floresville', 'TX', 'tx', 'Wilson County', 'wilson-county', 'floresville'),
    ('cm7a0bgos040sewvgy2t833l6', 'Stockdale', 'TX', 'tx', 'Wilson County', 'wilson-county', 'stockdale'),
    ('cm7a0bgos040uewvgwxpoyqw0', 'Floresville', 'TX', 'tx', 'Wilson County', 'wilson-county', 'floresville'),
    ('cm7a0bgos040xewvgsrpaq2l7', 'FLORESVILLE', 'TX', 'tx', 'Wilson County', 'wilson-county', 'floresville'),
    ('cm7a0bgos0410ewvgexcolkn1', 'LA VERNIA', 'TX', 'tx', 'Wilson County', 'wilson-county', 'la-vernia'),
    ('cm7a0bgos0413ewvgkus0hayp', 'POTH', 'TX', 'tx', 'Wilson County', 'wilson-county', 'poth'),
    ('cm7a0bgos0416ewvgoapu6ud3', 'Stockdale', 'TX', 'tx', 'Wilson County', 'wilson-county', 'stockdale'),
    ('cm7a0bgos0419ewvguiug5kue', 'FLORESVILLE', 'TX', 'tx', 'Wilson County', 'wilson-county', 'floresville'),
    ('cm7a0bgos041cewvgp56liimj', 'KERMIT', 'TX', 'tx', 'Winkler County', 'winkler-county', 'kermit'),
    ('cm7a0bgos041fewvg77wmtfzt', 'KERMIT', 'TX', 'tx', 'Winkler County', 'winkler-county', 'kermit'),
    ('cm7a0bgos041iewvge6vu86uc', 'Wink', 'TX', 'tx', 'Winkler County', 'winkler-county', 'wink'),
    ('cm7a0bgos041lewvgva3ivj41', 'KERMIT', 'TX', 'tx', 'Winkler County', 'winkler-county', 'kermit'),
    ('cm7a0bgos041newvg7wjvmb37', 'Kermit', 'TX', 'tx', 'Winkler County', 'winkler-county', 'kermit'),
    ('cm7a0bgos041qewvgxbfo562s', 'KERMIT', 'TX', 'tx', 'Winkler County', 'winkler-county', 'kermit'),
    ('cm7a0bgos041tewvggfowusiy', 'Wink', 'TX', 'tx', 'Winkler County', 'winkler-county', 'wink'),
    ('cm7a0bgos041wewvg3m79rxfp', 'Wink', 'TX', 'tx', 'Winkler County', 'winkler-county', 'wink'),
    ('cm7a0bgos041zewvghekkd2vh', 'DECATUR', 'TX', 'tx', 'Wise County', 'wise-county', 'decatur'),
    ('cm7a0bgos0422ewvgxxojpyrd', 'DECATUR', 'TX', 'tx', 'Wise County', 'wise-county', 'decatur'),
    ('cm7a0bgos0425ewvgidbkc9ef', 'Decatur', 'TX', 'tx', 'Wise County', 'wise-county', 'decatur'),
    ('cm7a0bgos0427ewvguk3jxq51', 'BOYD', 'TX', 'tx', 'Wise County', 'wise-county', 'boyd'),
    ('cm7a0bgos042aewvgm55te9fv', 'BRIDGEPORT', 'TX', 'tx', 'Wise County', 'wise-county', 'bridgeport'),
    ('cm7a0bgos042dewvg5eneylit', 'DECATUR', 'TX', 'tx', 'Wise County', 'wise-county', 'decatur'),
    ('cm7a0bgos042gewvgwxcww0wg', 'DECATUR', 'TX', 'tx', 'Wise County', 'wise-county', 'decatur'),
    ('cm7a0bgos042jewvgdhdine9f', 'DECATUR', 'TX', 'tx', 'Wise County', 'wise-county', 'decatur'),
    ('cm7a0bgos042mewvgq4ac7eyf', 'BOYD', 'TX', 'tx', 'Wise County', 'wise-county', 'boyd'),
    ('cm7a0bgos042pewvg7z1d4jxl', 'BRIDGEPORT', 'TX', 'tx', 'Wise County', 'wise-county', 'bridgeport'),
    ('cm7a0bgos042sewvgfocbpz3m', 'CHICO', 'TX', 'tx', 'Wise County', 'wise-county', 'chico'),
    ('cm7a0bgos042vewvgljfalm33', 'DECATUR', 'TX', 'tx', 'Wise County', 'wise-county', 'decatur'),
    ('cm7a0bgos042yewvgyukzc19r', 'Rhome', 'TX', 'tx', 'Wise County', 'wise-county', 'rhome'),
    ('cm7a0bgos0431ewvgdqwky6gq', 'RUNAWAY BAY', 'TX', 'tx', 'Wise County', 'wise-county', 'runaway-bay'),
    ('cm7a0bgos0434ewvgbs6jyb8j', 'ALVORD', 'TX', 'tx', 'Wise County', 'wise-county', 'alvord'),
    ('cm7a0bgos0437ewvgkgji2k8r', 'QUITMAN', 'TX', 'tx', 'Wood County', 'wood-county', 'quitman'),
    ('cm7a0bgos043aewvgrsdvpsur', 'QUITMAN', 'TX', 'tx', 'Wood County', 'wood-county', 'quitman'),
    ('cm7a0bgos043cewvg2au6yghm', 'MINEOLA', 'TX', 'tx', 'Wood County', 'wood-county', 'mineola'),
    ('cm7a0bgos043fewvgsman6szd', 'HAWKINS', 'TX', 'tx', 'Wood County', 'wood-county', 'hawkins'),
    ('cm7a0bgos043iewvgvmkq3qth', 'WINNSBORO', 'TX', 'tx', 'Wood County', 'wood-county', 'winnsboro'),
    ('cm7a0bgos043lewvgykp7vd26', 'QUITMAN', 'TX', 'tx', 'Wood County', 'wood-county', 'quitman'),
    ('cm7a0bgos043oewvg9hky53mz', 'Quitman', 'TX', 'tx', 'Wood County', 'wood-county', 'quitman'),
    ('cm7a0bgos043rewvgfit01ovg', 'ALBA', 'TX', 'tx', 'Wood County', 'wood-county', 'alba'),
    ('cm7a0bgos043uewvga8v0ysaw', 'HAWKINS', 'TX', 'tx', 'Wood County', 'wood-county', 'hawkins'),
    ('cm7a0bgos043xewvg1hvjjgjg', 'MINEOLA', 'TX', 'tx', 'Wood County', 'wood-county', 'mineola'),
    ('cm7a0bgos0440ewvgcl5gx1uk', 'QUITMAN', 'TX', 'tx', 'Wood County', 'wood-county', 'quitman'),
    ('cm7a0bgos0443ewvgouij1nrg', 'WINNSBORO', 'TX', 'tx', 'Wood County', 'wood-county', 'winnsboro'),
    ('cm7a0bgos0446ewvgn49tiu1o', 'WINNSBORO', 'TX', 'tx', 'Wood County', 'wood-county', 'winnsboro'),
    ('cm7a0bgos0448ewvghta6wfp7', 'MINEOLA', 'TX', 'tx', 'Wood County', 'wood-county', 'mineola'),
    ('cm7a0bgos044bewvgdejhh62r', 'Yantis', 'TX', 'tx', 'Wood County', 'wood-county', 'yantis'),
    ('cm7a0bgos044eewvgrtq66zrq', 'PLAINS', 'TX', 'tx', 'Yoakum County', 'yoakum-county', 'plains'),
    ('cm7a0bgos044hewvgkcevxlmu', 'PLAINS', 'TX', 'tx', 'Yoakum County', 'yoakum-county', 'plains'),
    ('cm7a0bgos044kewvgurqtbmzz', 'DENVER CITY', 'TX', 'tx', 'Yoakum County', 'yoakum-county', 'denver-city'),
    ('cm7a0bgos044newvgynme3m5e', 'PLAINS', 'TX', 'tx', 'Yoakum County', 'yoakum-county', 'plains'),
    ('cm7a0bgos044pewvg442708lw', 'Graham', 'TX', 'tx', 'Young County', 'young-county', 'graham'),
    ('cm7a0bgos044sewvgvpfn0cfr', 'GRAHAM', 'TX', 'tx', 'Young County', 'young-county', 'graham'),
    ('cm7a0bgos044vewvgyci14z31', 'GRAHAM', 'TX', 'tx', 'Young County', 'young-county', 'graham'),
    ('cm7a0bgos044yewvgm7kudyo9', 'Olney', 'TX', 'tx', 'Young County', 'young-county', 'olney'),
    ('cm7a0bgos0450ewvgc36ww5rl', 'GRAHAM', 'TX', 'tx', 'Young County', 'young-county', 'graham'),
    ('cm7a0bgos0453ewvgt3qk87iz', 'Graham', 'TX', 'tx', 'Young County', 'young-county', 'graham'),
    ('cm7a0bgos0456ewvg7epwf6ko', 'GRAHAM', 'TX', 'tx', 'Young County', 'young-county', 'graham'),
    ('cm7a0bgos0459ewvg9a2hm34m', 'OLNEY', 'TX', 'tx', 'Young County', 'young-county', 'olney'),
    ('cm7a0bgos045cewvgsltdtbhq', 'Zapata', 'TX', 'tx', 'Zapata County', 'zapata-county', 'zapata'),
    ('cm7a0bgot045fewvgsrug0xvh', 'ZAPATA', 'TX', 'tx', 'Zapata County', 'zapata-county', 'zapata'),
    ('cm7a0bgot045iewvgoylt0d34', 'ZAPATA', 'TX', 'tx', 'Zapata County', 'zapata-county', 'zapata'),
    ('cm7a0bgot045lewvgapo91p40', 'San Ygnacio', 'TX', 'tx', 'Zapata County', 'zapata-county', 'san-ygnacio'),
    ('cm7a0bgot045oewvgp1pk48yi', 'ZAPATA', 'TX', 'tx', 'Zapata County', 'zapata-county', 'zapata'),
    ('cm7a0bgot045qewvg9y9orbzl', 'ZAPATA', 'TX', 'tx', 'Zapata County', 'zapata-county', 'zapata'),
    ('cm7a0bgot045sewvg7ezawk8v', 'ZAPATA', 'TX', 'tx', 'Zapata County', 'zapata-county', 'zapata'),
    ('cm7a0bgot045uewvga4cecw7q', 'ZAPATA', 'TX', 'tx', 'Zapata County', 'zapata-county', 'zapata'),
    ('cm7a0bgot045wewvgyny5gdms', 'Zapata', 'TX', 'tx', 'Zapata County', 'zapata-county', 'zapata'),
    ('cm7a0bgot045zewvgbbhk2g9t', 'CRYSTAL CITY', 'TX', 'tx', 'Zavala County', 'zavala-county', 'crystal-city'),
    ('cm7a0bgot0462ewvglr4zki1f', 'BATESVILLE', 'TX', 'tx', 'Zavala County', 'zavala-county', 'batesville'),
    ('cm7a0bgot0464ewvg8owq8gvx', 'Crystal City', 'TX', 'tx', 'Zavala County', 'zavala-county', 'crystal-city'),
    ('cm7a0bgot0466ewvg7i8ie35n', 'CRYSTAL CITY', 'TX', 'tx', 'Zavala County', 'zavala-county', 'crystal-city'),
    ('cm7a0bgot0468ewvginnn0mqy', 'LAPRYOR', 'TX', 'tx', 'Zavala County', 'zavala-county', 'lapryor'),
    ('cm7a0bgot046aewvgafaeqqwf', 'CRYSTAL CITY', 'TX', 'tx', 'Zavala County', 'zavala-county', 'crystal-city'),
    ('cm7a0bgot046dewvgvioeaafu', 'CRYSTAL CITY', 'TX', 'tx', 'Zavala County', 'zavala-county', 'crystal-city'),
    ('cm7a0bgot046gewvgtaafjyui', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot046iewvg5qs1f9cn', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot046kewvgkwwlie10', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot046mewvgs6xyqymp', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot046oewvgozeu75gj', 'Springfield', 'VA', 'va', 'Fairfax County', 'fairfax-county', 'springfield'),
    ('cm7a0bgot046qewvgdf7x72uh', 'Chicago', 'IL', 'il', 'Cook County', 'cook-county', 'chicago'),
    ('cm7a0bgot046sewvgaos4a556', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot046uewvgsjf5j9jw', 'Quantico', 'VA', 'va', 'Prince William County', 'prince-william-county', 'quantico'),
    ('cm7a0bgot046vewvgevecoygr', 'San Antonio', 'TX', 'tx', 'Bexar County', 'bexar-county', 'san-antonio'),
    ('cm7a0bgot046xewvgaaosroib', 'N.W., Washington', 'DC', 'dc', 'District of Columbia County', 'district-of-columbia-county', 'n-w-washington'),
    ('cm7a0bgot046zewvgw9muzy3w', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot0471ewvg4p3ymwe3', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot0473ewvg9v7lgxy4', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot0475ewvgp9eyc8w2', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot0477ewvgq4hzh87t', 'Arlington', 'VA', 'va', 'Arlington County', 'arlington-county', 'arlington'),
    ('cm7a0bgot0479ewvgjlhnpdzd', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot047bewvgj0mszhif', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot047dewvg9mgaog4n', 'Austin', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgot047fewvg018es16l', 'Washington', 'DC', 'federal', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot047iewvg6cxc40pt', 'Austin', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('cm7a0bgot047kewvgjymr1c78', 'HOUSTON', 'TX', 'tx', 'Harris County', 'harris-county', 'houston'),
    ('cm7a0bgot047newvgs3hny4rg', 'Montgomery', 'AL', 'al', 'Montgomery County', 'montgomery-county', 'montgomery'),
    ('cm7a0bgot047pewvg2z52wd3s', 'Juneau', 'AK', 'ak', 'Juneau City and Borough', 'juneau-city-and-borough', 'juneau'),
    ('cm7a0bgot047rewvg8lfaw2eh', 'Phoenix', 'AZ', 'az', 'Maricopa County', 'maricopa-county', 'phoenix'),
    ('cm7a0bgot047tewvgxffmwhc7', 'Little Rock', 'AR', 'ar', 'Pulaski County', 'pulaski-county', 'little-rock'),
    ('cm7a0bgot047vewvgphklrpev', 'Sacramento', 'CA', 'ca', 'Sacramento County', 'sacramento-county', 'sacramento'),
    ('cm7a0bgot047xewvg6z1pw7bm', 'Denver', 'CO', 'co', 'Denver County', 'denver-county', 'denver'),
    ('cm7a0bgot047zewvg2ciurb2p', 'Hartford', 'CT', 'ct', 'Hartford County', 'hartford-county', 'hartford'),
    ('cm7a0bgot0481ewvgteqfaldo', 'Dover', 'DE', 'de', 'Kent County', 'kent-county', 'dover'),
    ('cm7a0bgot0483ewvg2w2jhxm4', 'Tallahassee', 'FL', 'fl', 'Leon County', 'leon-county', 'tallahassee'),
    ('cm7a0bgot0485ewvg5sv5ol7v', 'Atlanta', 'GA', 'ga', 'Fulton County', 'fulton-county', 'atlanta'),
    ('cm7a0bgot0487ewvgdlewthlp', 'Honolulu', 'HI', 'hi', 'Honolulu County', 'honolulu-county', 'honolulu'),
    ('cm7a0bgot0489ewvgfnbl3tn6', 'Boise', 'ID', 'id', 'Ada County', 'ada-county', 'boise'),
    ('cm7a0bgot048bewvg7i3fhk4o', 'Springfield', 'IL', 'il', 'Sangamon County', 'sangamon-county', 'springfield'),
    ('cm7a0bgot048dewvgk2slgc20', 'Indianapolis', 'IN', 'in', 'Marion County', 'marion-county', 'indianapolis'),
    ('cm7a0bgot048fewvgry4m0tm0', 'Des Moines', 'IA', 'ia', 'Polk County', 'polk-county', 'des-moines'),
    ('cm7a0bgot048hewvg5c9j2c7d', 'Topeka', 'KS', 'ks', 'Shawnee County', 'shawnee-county', 'topeka'),
    ('cm7a0bgot048jewvgx1s3uuge', 'Frankfort', 'KY', 'ky', 'Franklin County', 'franklin-county', 'frankfort'),
    ('cm7a0bgot048lewvg89bgq2z7', 'Baton Rouge', 'LA', 'la', 'East Baton Rouge Parish', 'east-baton-rouge-parish', 'baton-rouge'),
    ('cm7a0bgot048newvgh3i1w9bm', 'Augusta', 'ME', 'me', 'Kennebec County', 'kennebec-county', 'augusta'),
    ('cm7a0bgot048pewvgqqz2uf0i', 'Annapolis', 'MD', 'md', 'Anne Arundel County', 'anne-arundel-county', 'annapolis'),
    ('cm7a0bgot048rewvg5lhr4sya', 'Boston', 'MA', 'ma', 'Suffolk County', 'suffolk-county', 'boston'),
    ('cm7a0bgot048tewvgsqafibhv', 'Lansing', 'MI', 'mi', 'Ingham County', 'ingham-county', 'lansing'),
    ('cm7a0bgot048vewvgv748afah', 'Saint Paul', 'MN', 'mn', 'Ramsey County', 'ramsey-county', 'saint-paul'),
    ('cm7a0bgot048xewvggza95u1n', 'Jackson', 'MS', 'ms', 'Hinds County', 'hinds-county', 'jackson'),
    ('cm7a0bgot048zewvgvxkqzo1u', 'Jefferson City', 'MO', 'mo', 'Cole County', 'cole-county', 'jefferson-city'),
    ('cm7a0bgot0491ewvgv0noht1a', 'Helena', 'MT', 'mt', 'Lewis and Clark County', 'lewis-and-clark-county', 'helena'),
    ('cm7a0bgot0493ewvghaec1cbb', 'Lincoln', 'NE', 'ne', 'Lancaster County', 'lancaster-county', 'lincoln'),
    ('cm7a0bgot0495ewvgh632yqor', 'Carson City', 'NV', 'nv', 'Carson City', 'carson-city', 'carson-city'),
    ('cm7a0bgot0497ewvg2fylpd0e', 'Concord', 'NH', 'nh', 'Merrimack County', 'merrimack-county', 'concord'),
    ('cm7a0bgot0499ewvgb5e80xbk', 'Trenton', 'NJ', 'nj', 'Mercer County', 'mercer-county', 'trenton'),
    ('cm7a0bgot049bewvg3y3i8c9h', 'Santa Fe', 'NM', 'nm', 'Santa Fe County', 'santa-fe-county', 'santa-fe'),
    ('cm7a0bgot049dewvgefz9jy1a', 'Albany', 'NY', 'ny', 'Albany County', 'albany-county', 'albany'),
    ('cm7a0bgot049fewvgm3vwhmgx', 'Raleigh', 'NC', 'nc', 'Wake County', 'wake-county', 'raleigh'),
    ('cm7a0bgot049hewvgzqaa5n58', 'Bismarck', 'ND', 'nd', 'Burleigh County', 'burleigh-county', 'bismarck'),
    ('cm7a0bgot049jewvgrlm7wspr', 'Columbus', 'OH', 'oh', 'Franklin County', 'franklin-county', 'columbus'),
    ('cm7a0bgot049lewvgw5pmy259', 'Oklahoma City', 'OK', 'ok', 'Oklahoma County', 'oklahoma-county', 'oklahoma-city'),
    ('cm7a0bgot049newvgeaztypoz', 'Salem', 'OR', 'or', 'Marion County', 'marion-county', 'salem'),
    ('cm7a0bgot049pewvg59g4nvsx', 'Harrisburg', 'PA', 'pa', 'Dauphin County', 'dauphin-county', 'harrisburg'),
    ('cm7a0bgot049rewvgqxmh07j4', 'Providence', 'RI', 'ri', 'Providence County', 'providence-county', 'providence'),
    ('cm7a0bgot049tewvg90kv6ana', 'Columbia', 'SC', 'sc', 'Richland County', 'richland-county', 'columbia'),
    ('cm7a0bgot049vewvgl5ryuh1g', 'Pierre', 'SD', 'sd', 'Hughes County', 'hughes-county', 'pierre'),
    ('cm7a0bgot049xewvg7zcy2a2p', 'Nashville', 'TN', 'tn', 'Davidson County', 'davidson-county', 'nashville'),
    ('cm7a0bgot049zewvg7bniltu3', 'Salt Lake City', 'UT', 'ut', 'Salt Lake County', 'salt-lake-county', 'salt-lake-city'),
    ('cm7a0bgot04a1ewvglgp2wq2l', 'Montpelier', 'VT', 'vt', 'Washington County', 'washington-county', 'montpelier'),
    ('cm7a0bgot04a3ewvgkre7g0la', 'Richmond', 'VA', 'va', 'Richmond City', 'richmond-city', 'richmond'),
    ('cm7a0bgot04a5ewvgel055yyd', 'Olympia', 'WA', 'wa', 'Thurston County', 'thurston-county', 'olympia'),
    ('cm7a0bgot04a7ewvg7qvtteyh', 'Madison', 'WI', 'wi', 'Dane County', 'dane-county', 'madison'),
    ('cm7a0bgot04a9ewvg684b599m', 'Charleston', 'WV', 'wv', 'Kanawha County', 'kanawha-county', 'charleston'),
    ('cm7a0bgot04abewvgcb21gljp', 'Cheyenne', 'WY', 'wy', 'Laramie County', 'laramie-county', 'cheyenne'),
    ('cm7a0bgot04adewvgnlu2fy0c', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm7a0bgot04afewvgjh28pftq', 'Abbott', 'TX', 'tx', 'Travis County', 'travis-county', 'abbott'),
    ('cm7a0bgot04agewvgqmjcff12', 'Austin', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('czyyk2hqe9ke2kq3cg9nodb4', 'Washington', 'DC', 'dc', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cm90a1b2c3d4e5f6g7h8i9j1l', 'Saint Paul', 'MN', 'mn', 'Ramsey County', 'ramsey-county', 'saint-paul'),
    ('g3b6b4dhlyzj3n35qt21t10a', 'Los Angeles', 'CA', 'ca', 'Los Angeles County', 'los-angeles-county', 'los-angeles'),
    ('hlr62wwtuau5r4vhu8d9sfrs', 'Pottsville', 'AR', 'ar', 'Pope County', 'pope-county', 'pottsville'),
    ('i563abos94wf0x1mrp3fvr4typgp', 'Brooklyn Center', 'MN', 'mn', 'Hennepin County', 'hennepin-county', 'brooklyn-center'),
    ('izmed0kohy7941ipfv03zixshlfv', 'New Haven', 'CT', 'ct', 'New Haven County', 'new-haven-county', 'new-haven'),
    ('j0i9huuuvzlj4nef3g3ba2pq0gks', 'Louisville', 'KY', 'ky', 'Jefferson County', 'jefferson-county', 'louisville'),
    ('j7can3zghy4vvuo0r87lbt1gtbh3', 'St. Anthony', 'MN', 'mn', 'Hennepin County', 'hennepin-county', 'st-anthony'),
    ('koi4o8xq7hz3wdr8aso0g81b', 'Tacoma', 'WA', 'wa', 'Pierce County', 'pierce-county', 'tacoma'),
    ('lc8rsueslffjaaphjs4pehgl9ewm', 'Aurora', 'CO', 'co', 'Arapahoe County', 'arapahoe-county', 'aurora'),
    ('luj2pelwy4hdav8jz2w04fjzx7hw', 'Rochester', 'NY', 'ny', 'Monroe County', 'monroe-county', 'rochester'),
    ('m05rpmksaas6kv5e9oaljtdd', 'Baton Rouge', 'LA', 'la', 'East Baton Rouge Parish', 'east-baton-rouge-parish', 'baton-rouge'),
    ('mvowoigz9vxnudol7iop7l3i', 'Melvindale', 'MI', 'mi', 'Wayne County', 'wayne-county', 'melvindale'),
    ('pt2evbzfhq10febipi11ex77', 'Denver', 'CO', 'co', 'Denver County', 'denver-county', 'denver'),
    ('qfe922dy22imlqcwqybixsl4qyf3', 'Reform', 'AL', 'al', 'Pickens County', 'pickens-county', 'reform'),
    ('qlm9uhigs55xtt4zvwuhun30', 'Buffalo', 'NY', 'ny', 'Erie County', 'erie-county', 'buffalo'),
    ('r507dgfhk5ej3ue7b35dyu60', 'Tacoma', 'WA', 'wa', 'Pierce County', 'pierce-county', 'tacoma'),
    ('rgbzsij2kk77y24ni8tnypo3cfi9', 'North Charleston', 'SC', 'sc', 'Charleston County', 'charleston-county', 'north-charleston'),
    ('rlkhpf3obwcrjss5f1jxzu4cldvw', 'Columbus', 'OH', 'oh', 'Franklin County', 'franklin-county', 'columbus'),
    ('s0wp2j4e7gn2eo0ize7shemmzr7w', 'Baltimore', 'MD', 'md', 'Baltimore city', 'baltimore-city', 'baltimore'),
    ('sowb2g5u49vwskylaz0sjpqu', 'Phoenix', 'AZ', 'az', 'Maricopa County', 'maricopa-county', 'phoenix'),
    ('sucfakpc35yk2lg8zj5f1dpkdbog', 'Highland', 'NY', 'ny', 'Ulster County', 'ulster-county', 'highland'),
    ('ttpnq49omn5y5qz779dffc8a9xpv', 'West Union', 'OH', 'oh', 'Adams County', 'adams-county', 'west-union'),
    ('utdkxsvpwey98o9pqs53x30r', 'Antioch', 'CA', 'ca', 'Contra Costa County', 'contra-costa-county', 'antioch'),
    ('v173560gvfavjmagkrvqrucwo44v', 'Atlanta', 'GA', 'ga', 'Fulton County', 'fulton-county', 'atlanta'),
    ('v6mlf2eqiikokbgrcklwlenmo71r', 'Torrance', 'CA', 'ca', 'Los Angeles County', 'los-angeles-county', 'torrance'),
    ('vcmu39hurl1iravvkivl5q2an6rd', 'Minneapolis', 'MN', 'mn', 'Hennepin County', 'hennepin-county', 'minneapolis'),
    ('vt2zc6c6hi4k2665vm30h4ltpy90', 'Fort Worth', 'TX', 'tx', 'Tarrant County', 'tarrant-county', 'fort-worth'),
    ('vxvk51wclfh4urgbdwxt46bf28dj', 'Austin', 'TX', 'tx', 'Travis County', 'travis-county', 'austin'),
    ('w0aibkf4fi0om79gsx3w6g7i1nsq', 'Springfield', 'IL', 'il', 'Sangamon County', 'sangamon-county', 'springfield'),
    ('whielyxoyjzyjs8toimz3lxdy4b9', 'Bartow', 'FL', 'fl', 'Polk County', 'polk-county', 'bartow'),
    ('x948b4thk9p1epyfdyvhz48vmkf6', 'Grand Rapids', 'MI', 'mi', 'Kent County', 'kent-county', 'grand-rapids'),
    ('yvd5zl5f9ojtwmb3f4b0789r', 'Newton', 'IA', 'ia', 'Jasper County', 'jasper-county', 'newton'),
    ('zadxj7xit0wiyyja3jqet2ajhges', 'New York', 'NY', 'ny', 'New York County', 'new-york-county', 'new-york')
)
update public.agency
set
  city = agency_location_seed.city,
  state = agency_location_seed.state,
  category = agency_location_seed.category,
  administrative_area = agency_location_seed.administrative_area,
  administrative_area_slug = agency_location_seed.administrative_area_slug,
  place_slug = agency_location_seed.place_slug,
  canonical_url = '/' || agency_location_seed.category || '/' || agency_location_seed.administrative_area_slug || '/' || agency_location_seed.place_slug || '/' || public.agency.slug || '/'
from agency_location_seed
where public.agency.id = agency_location_seed.id;

-- Federal agency IDs are explicit cuid2-style IDs from 20250820133000.
with federal_agency_location_seed(id, city, state, category, administrative_area, administrative_area_slug, place_slug) as (
  values
    ('cgsmkptihlupk5bjwyvdgtcq', 'Washington', 'DC', 'federal', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cv04crq73alq62kp5v0s3fx3', 'Washington', 'DC', 'federal', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cjtbmujxlur44dvljhfprrx1', 'Washington', 'DC', 'federal', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cs2sz1y65zqybhahepchwol6', 'Washington', 'DC', 'federal', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('czyyk2hqe9ke2kq3cg9nodb4', 'Washington', 'DC', 'federal', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cufdb3i3jzsr5kkfuto7huqk', 'Washington', 'DC', 'federal', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('cato8mt9eyb6zrazpvbis0hz', 'Washington', 'DC', 'federal', 'District of Columbia', 'district-of-columbia', 'washington'),
    ('chvdwkxp1cjwertwzt6ll9b0', 'Springfield', 'VA', 'federal', 'Fairfax County', 'fairfax-county', 'springfield'),
    ('c887sm2ibjg8c2yp4e4f4es5', 'Washington', 'DC', 'federal', 'District of Columbia', 'district-of-columbia', 'washington')
)
update public.agency
set
  city = federal_agency_location_seed.city,
  state = federal_agency_location_seed.state,
  category = federal_agency_location_seed.category,
  administrative_area = federal_agency_location_seed.administrative_area,
  administrative_area_slug = federal_agency_location_seed.administrative_area_slug,
  place_slug = federal_agency_location_seed.place_slug,
  canonical_url = '/' || federal_agency_location_seed.category || '/' || federal_agency_location_seed.administrative_area_slug || '/' || federal_agency_location_seed.place_slug || '/' || public.agency.slug || '/'
from federal_agency_location_seed
where public.agency.id = federal_agency_location_seed.id;

do $$
begin
  if exists (
    select 1 from public.agency
    where coalesce(nullif(btrim(city), ''), '') = ''
      or coalesce(nullif(btrim(state), ''), '') = ''
      or coalesce(nullif(btrim(category), ''), '') = ''
      or coalesce(nullif(btrim(administrative_area), ''), '') = ''
      or coalesce(nullif(btrim(administrative_area_slug), ''), '') = ''
      or coalesce(nullif(btrim(place_slug), ''), '') = ''
      or coalesce(nullif(btrim(canonical_url), ''), '') = ''
  ) then
    raise exception 'Agency location enrichment left required location fields empty';
  end if;
end $$;

create index if not exists agency_location_state_admin_idx
  on public.agency (category, administrative_area_slug);

create index if not exists agency_location_place_idx
  on public.agency (category, administrative_area_slug, place_slug);

create unique index if not exists agency_canonical_url_unique_idx
  on public.agency (canonical_url);

-- Collapsed from 20260510120000_add_location_build_projections.sql

create table if not exists public.location_path (
  location_path_id text primary key,
  path text not null unique,
  level text not null check (level in ('state', 'administrative_area', 'place')),
  state_or_territory_slug text not null,
  administrative_area_slug text,
  place_slug text,
  state_or_territory_name text not null,
  administrative_area_name text,
  place_name text,
  parent_location_path_id text references public.location_path(location_path_id),
  latitude double precision,
  longitude double precision,
  map_min_lat double precision,
  map_min_lng double precision,
  map_max_lat double precision,
  map_max_lng double precision,
  map_position_source text check (map_position_source in ('geocoded', 'derived_from_children')),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.location_path_closure (
  ancestor_location_path_id text not null references public.location_path(location_path_id) on delete cascade,
  descendant_location_path_id text not null references public.location_path(location_path_id) on delete cascade,
  depth integer not null check (depth >= 0),
  primary key (ancestor_location_path_id, descendant_location_path_id)
);

create table if not exists public.build_page_payload (
  path text primary key,
  page_type text not null,
  entity_id text,
  payload jsonb not null,
  content_hash text not null,
  content_updated_at timestamp with time zone,
  generated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.agency_zip_index (
  postal_code text not null,
  agency_id text not null references public.agency(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('official_address')),
  primary key (postal_code, agency_id, relationship_type)
);

alter table public.agency
  add column if not exists location_path_id text references public.location_path(location_path_id) on delete set null,
  add column if not exists agency_slug text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

update public.agency
set agency_slug = slug
where agency_slug is null
  and slug is not null;

create unique index if not exists agency_location_path_slug_unique_idx
  on public.agency (location_path_id, agency_slug)
  where location_path_id is not null
    and agency_slug is not null;

create index if not exists location_path_parent_idx
  on public.location_path (parent_location_path_id);

create index if not exists location_path_closure_descendant_idx
  on public.location_path_closure (descendant_location_path_id);

create index if not exists build_page_payload_page_type_idx
  on public.build_page_payload (page_type);

drop index if exists public.agency_canonical_url_unique_idx;

alter table public.agency
  drop column if exists canonical_url;

-- Collapsed from 20260510130000_add_federal_agency_branches.sql

create table if not exists public.federal_agency (
  id text primary key,
  name text not null,
  slug text not null unique,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.federal_agency_branch (
  federal_agency_id text not null references public.federal_agency(id) on delete cascade,
  agency_id text not null references public.agency(id) on delete cascade,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  primary key (federal_agency_id, agency_id),
  unique (agency_id)
);

create index if not exists federal_agency_branch_federal_agency_idx
  on public.federal_agency_branch (federal_agency_id);

-- Collapsed from 20260510140000_remove_agency_category.sql

drop trigger if exists agency_set_category on public.agency;
drop function if exists public.set_agency_category();

alter table public.agency
  drop column if exists category;

-- Collapsed from 20260510141000_add_record_location_paths.sql

alter table public.reviews
  add column if not exists location_path_id text references public.location_path(location_path_id) on delete set null;

alter table public.civil_cases
  add column if not exists location_path_id text references public.location_path(location_path_id) on delete set null;

create index if not exists reviews_location_path_id_idx
  on public.reviews(location_path_id);

create index if not exists civil_cases_location_path_id_idx
  on public.civil_cases(location_path_id);

alter table public.reviews
  drop column if exists category;

alter table public.civil_cases
  drop column if exists category;

-- Collapsed from 20260510142000_add_review_coordinates.sql

alter table public.reviews
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

create index if not exists reviews_location_coordinates_idx
  on public.reviews(latitude, longitude)
  where latitude is not null and longitude is not null;

-- Collapsed from 20260514153500_require_civil_cases_filed_date.sql

do $$
begin
  if exists (select 1 from public.civil_cases where filed_date is null) then
    raise exception 'civil_cases.filed_date must be populated for every civil case before enforcing NOT NULL';
  end if;
end $$;

alter table public.civil_cases
  alter column filed_date set not null;
