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
  if not exists (
    select 1
    from pg_extension
    where extname = 'postgis'
  ) then
    create schema if not exists extensions;
    create extension postgis with schema extensions;
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
  add column if not exists primary_source_url text,
  add column if not exists date_terminated date;

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
  centroid geography(Point, 4326),
  bbox geometry(Polygon, 4326),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.location_path_geometry (
  location_path_id text primary key references public.location_path(location_path_id) on delete cascade,
  boundary geometry(Geometry, 4326) not null
);

create index if not exists location_path_geometry_boundary_gist
  on public.location_path_geometry using gist (boundary);

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
  add column if not exists location_path_id text not null references public.location_path(location_path_id) on delete restrict,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

create index if not exists location_path_parent_idx
  on public.location_path (parent_location_path_id);

create index if not exists location_path_closure_descendant_idx
  on public.location_path_closure (descendant_location_path_id);

create index if not exists build_page_payload_page_type_idx
  on public.build_page_payload (page_type);

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
  add column if not exists location_path_id text not null references public.location_path(location_path_id) on delete restrict;

alter table public.civil_cases
  add column if not exists location_path_id text not null references public.location_path(location_path_id) on delete restrict;

alter table public.reviews
  alter column location_path_id set not null;

alter table public.civil_cases
  alter column location_path_id set not null;

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
