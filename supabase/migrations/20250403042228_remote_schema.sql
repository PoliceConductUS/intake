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

