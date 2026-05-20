-- Collapsed from 20250303232529_remote_schema.sql

SET
statement_timeout = 0;
SET
lock_timeout = 0;
SET
idle_in_transaction_session_timeout = 0;
SET
client_encoding = 'UTF8';
SET
standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET
check_function_bodies = false;
SET
xmloption = content;
SET
client_min_messages = warning;
SET
row_security = off;


CREATE
EXTENSION IF NOT EXISTS "pgsodium";






COMMENT
ON SCHEMA "public" IS 'standard public schema';



CREATE
EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE
EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE
EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE
EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE
EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE
EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";



CREATE TYPE "public"."rating_label" AS ENUM (
    'Outstanding',
    'Good',
    'Adequate',
    'Needs Improvement',
    'Unacceptable'
);

ALTER TYPE "public"."rating_label" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_trigger_func"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    IF
TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (table_name, record_id, action, new_values, created_by)
        VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', row_to_json(NEW), auth.uid());
    ELSIF
TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, created_by)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', row_to_json(OLD), row_to_json(NEW), auth.uid());
    ELSIF
TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (table_name, record_id, action, old_values, created_by)
        VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', row_to_json(OLD), auth.uid());
END IF;
RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."audit_trigger_func"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_agency_officer_stats"("agency_officer_id" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
ao record;
    stats
jsonb;
    overall_rating
numeric;
BEGIN
    -- Get the agency officer record
SELECT *
INTO ao
FROM agency_officers
WHERE id = agency_officer_id;

-- Calculate stats for reviews within the employment period
WITH review_ratings AS (SELECT ror.*,
                               r.incident_date,
                               rb.label as rubric_label
                        FROM review_officers ro
                                 JOIN reviews r ON r.id = ro.review_id
                                 JOIN review_officers_ratings ror ON ror.review_officer_id = ro.id
                                 JOIN rubrics rb ON rb.id = ror.rubric_id
                        WHERE ro.officer_id = ao.officer_id
                          AND (r.incident_date >= ao.start_date)
                          AND (ao.end_date IS NULL OR r.incident_date <= ao.end_date))
SELECT calculate_rating_stats(jsonb_agg(to_jsonb(review_ratings)))
INTO stats
FROM review_ratings;

-- Calculate overall rating as weighted average
SELECT ROUND(AVG(rv.value)::numeric, 1)
INTO overall_rating
FROM review_ratings rr
         JOIN rating_values rv ON rv.label = rr.rubric_label;

-- Update the agency_officer record
UPDATE agency_officers
SET review_stats   = COALESCE(stats, '{}'::jsonb),
    rating_overall = COALESCE(overall_rating, 0),
    updated_at     = now()
WHERE id = agency_officer_id;
END;
$$;


ALTER FUNCTION "public"."calculate_agency_officer_stats"("agency_officer_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_overall_rating_stats"("rating_stats" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
overall_stats jsonb;
  stat
record;
  total_count
integer := 0;
  weighted_sum
numeric := 0;
BEGIN
  -- Initialize counts for each rating level
  overall_stats
:= jsonb_build_object(
    'outstanding', jsonb_build_object('count', 0, 'average', 0, 'weighted_average', 0),
    'good', jsonb_build_object('count', 0, 'average', 0, 'weighted_average', 0),
    'adequate', jsonb_build_object('count', 0, 'average', 0, 'weighted_average', 0),
    'needs_improvement', jsonb_build_object('count', 0, 'average', 0, 'weighted_average', 0),
    'unacceptable', jsonb_build_object('count', 0, 'average', 0, 'weighted_average', 0)
  );

  -- Calculate totals and classify ratings
FOR stat IN
SELECT *
FROM jsonb_each(rating_stats) LOOP
     -- Skip the 'overall' key if it exists
    IF stat.key != 'overall' THEN
-- Extract values from the stat
SELECT (stat.value ->>'count')::integer, (stat.value ->>'average')::numeric, (stat.value ->>'weighted_average') ::numeric
INTO total_count, weighted_sum;

-- Classify the rating and update the corresponding count
IF
(stat.value->>'average')::numeric >= 4.5 THEN
        overall_stats := jsonb_set(
          overall_stats,
          '{outstanding,count}',
          (((overall_stats->'outstanding'->>'count')::integer + total_count)::text)::jsonb
        );
      ELSIF
(stat.value->>'average')::numeric >= 3.5 THEN
        overall_stats := jsonb_set(
          overall_stats,
          '{good,count}',
          (((overall_stats->'good'->>'count')::integer + total_count)::text)::jsonb
        );
      ELSIF
(stat.value->>'average')::numeric >= 2.5 THEN
        overall_stats := jsonb_set(
          overall_stats,
          '{adequate,count}',
          (((overall_stats->'adequate'->>'count')::integer + total_count)::text)::jsonb
        );
      ELSIF
(stat.value->>'average')::numeric >= 1.5 THEN
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
SELECT *
FROM jsonb_each(overall_stats) LOOP IF (stat.value->>'count')::integer > 0 THEN
      overall_stats := jsonb_set(
        overall_stats,
        ARRAY[stat.key, 'average'],
        '5'::jsonb  -- Set to maximum for the category
      );
-- We could implement a more sophisticated weighted average calculation here if needed
overall_stats
:= jsonb_set(
        overall_stats,
        ARRAY[stat.key, 'weighted_average'],
        '5'::jsonb  -- Set to maximum for the category
      );
END IF;
END LOOP;

RETURN jsonb_build_object('overall', overall_stats);
END;
$$;


ALTER FUNCTION "public"."calculate_overall_rating_stats"("rating_stats" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_rating_stats"("review_officers_ratings_array" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
stats jsonb;
BEGIN
WITH rating_counts AS (SELECT r.label,
                              COUNT(*) as count, AVG (rv.value) as average_value,
     -- Calculate weighted average based on review recency
    AVG (
    rv.value *
    GREATEST(
    0.5,                        -- Minimum weight of 0.5 for old reviews
    LEAST(
    1.0,                        -- Maximum weight of 1.0 for recent reviews
    1.0 / (
    EXTRACT (EPOCH FROM (now() - (ror->>'created_at'):: timestamp)) /
    (365.25 * 24 * 60 * 60) + 1 -- Decay over years
    )
    )
    )
    ) as weighted_average
FROM jsonb_array_elements(review_officers_ratings_array) as ror
    JOIN public.rubrics r
ON (ror->>'rubric_id')::text = r.id
    JOIN public.rating_values rv ON rv.label = r.label
GROUP BY r.label
    )
SELECT jsonb_object_agg(
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
$$;


ALTER FUNCTION "public"."calculate_rating_stats"("review_officers_ratings_array" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_cuid"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
RETURN LOWER(
        'c' ||
        TO_CHAR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP), 'FM9999999999') ||
        SUBSTRING(MD5(RANDOM()::TEXT) FOR 8)
       );
END;
$$;


ALTER FUNCTION "public"."generate_cuid"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_agency_officer_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF
TG_OP = 'UPDATE' THEN
        -- Recalculate stats for the agency officer
        PERFORM calculate_agency_officer_stats(NEW.id);
        -- Update agency overall rating
        PERFORM
update_agency_overall_rating(NEW.agency_id);
    ELSIF
TG_OP = 'INSERT' THEN
        -- Calculate initial stats
        PERFORM calculate_agency_officer_stats(NEW.id);
        -- Update agency overall rating
        PERFORM
update_agency_overall_rating(NEW.agency_id);
    ELSIF
TG_OP = 'DELETE' THEN
        -- Update agency overall rating
        PERFORM update_agency_overall_rating(OLD.agency_id);
END IF;

RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_agency_officer_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
insert into public.profiles (id)
values (new.id);
return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_review_rating_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
review_officer record;
    agency_officer
record;
BEGIN
    -- Get the review_officer record
SELECT *
INTO review_officer
FROM review_officers
WHERE id = NEW.review_officer_id;

-- Update stats for all relevant agency_officer records
FOR agency_officer IN
SELECT ao.*
FROM agency_officers ao
         JOIN reviews r ON r.incident_date >= ao.start_date
    AND (ao.end_date IS NULL OR r.incident_date <= ao.end_date)
         JOIN review_officers ro ON ro.review_id = r.id
WHERE ao.officer_id = review_officer.officer_id LOOP
        PERFORM calculate_agency_officer_stats(agency_officer.id);
PERFORM
update_agency_overall_rating(agency_officer.agency_id);
END LOOP;

    -- Update officer overall rating
    PERFORM
update_officer_overall_rating(review_officer.officer_id);

RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_review_rating_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."officers_audit_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    NEW.updated_at
= timezone('utc'::text, now());
    NEW.updated_by
= auth.uid();
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."officers_audit_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_trait_deletion"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF
EXISTS (SELECT 1 FROM review_ratings WHERE trait_id = OLD.id) THEN
        RAISE EXCEPTION 'Cannot delete trait with existing ratings';
END IF;
RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."prevent_trait_deletion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_trait_modification"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF
EXISTS (SELECT 1 FROM review_ratings WHERE trait_id = NEW.id)
       AND (OLD.code != NEW.code OR OLD.name != NEW.name OR OLD.description != NEW.description) THEN
        RAISE EXCEPTION 'Cannot modify trait with existing ratings';
END IF;
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_trait_modification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_links_audit_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    NEW.updated_at
= timezone('utc'::text, now());
    NEW.updated_by
= auth.uid();
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."review_links_audit_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_set_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at
= timezone('utc'::text, now());
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_set_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_agency_overall_rating"("agency_id" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."update_agency_overall_rating"("agency_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_officer_overall_rating"("officer_id" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."update_officer_overall_rating"("officer_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_overall_stats"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Calculate and merge the overall stats with existing review_stats
  NEW.review_stats
:= NEW.review_stats || calculate_overall_rating_stats(NEW.review_stats);
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_overall_stats"() OWNER TO "postgres";

SET
default_tablespace = '';

SET default_table_access_method = "heap";

CREATE TABLE IF NOT EXISTS "public"."agency" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "name" "text" NOT NULL,
    "city" "text",
    "state" "text" NOT NULL,
    "address" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "zip_code" "text",
    "contact_name" "text",
    "contact_email" "text",
    "review_stats" "jsonb" DEFAULT '{}'::"jsonb",
    "review_count" integer DEFAULT 0,
    "rating_overall" numeric DEFAULT 0
);


ALTER TABLE "public"."agency" OWNER TO "postgres";


COMMENT
ON COLUMN "public"."agency"."contact_name" IS 'Name of the primary contact person for the agency';



COMMENT
ON COLUMN "public"."agency"."contact_email" IS 'Email address of the primary contact person for the agency';



CREATE TABLE IF NOT EXISTS "public"."agency_links" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "agency_id" "text",
    "url" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."agency_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agency_officers" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "agency_id" "text",
    "officer_id" "text" NOT NULL,
    "badge_number" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "title" "text",
    "rating_overall" numeric DEFAULT 0,
    "review_stats" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."agency_officers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agency_phone_numbers" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "agency_id" "text",
    "phone_number" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."agency_phone_numbers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "old_values" "jsonb",
    "new_values" "jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."officers" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "middle_name" "text",
    "prefix" "text",
    "suffix" "text",
    "review_stats" "jsonb" DEFAULT '{}'::"jsonb",
    "rating_overall" numeric DEFAULT 0
);


ALTER TABLE "public"."officers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_emails" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "profile_id" "uuid",
    "email" "text" NOT NULL,
    "is_primary" boolean DEFAULT false,
    "verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "label" "text"
);


ALTER TABLE "public"."profile_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_links" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "profile_id" "uuid",
    "url" "text" NOT NULL,
    "label" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."profile_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_phone_numbers" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "profile_id" "uuid",
    "phone_number" "text" NOT NULL,
    "is_primary" boolean DEFAULT false,
    "can_receive_sms" boolean DEFAULT false,
    "is_verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "label" "text"
);


ALTER TABLE "public"."profile_phone_numbers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text","now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "phone_number" "text",
    "avatar_url" "text",
    "street_address" "text",
    "city" "text",
    "state" "text",
    "zip_code" "text",
    "primary_phone_id" "text",
    "primary_email_id" "text",
    "mailing_address_street" "text",
    "mailing_address_city" "text",
    "mailing_address_state" "text",
    "mailing_address_zip" "text",
    "physical_address_street" "text",
    "physical_address_city" "text",
    "physical_address_state" "text",
    "physical_address_zip" "text",
    "languages" "text"[]
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rating_values" (
    "label" "public"."rating_label" NOT NULL,
    "value" integer NOT NULL
);


ALTER TABLE "public"."rating_values" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_attachments" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "review_id" "text",
    "file_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."review_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_links" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "review_id" "text",
    "url" "text" NOT NULL,
    "title" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid"
);


ALTER TABLE "public"."review_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_officers" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "review_id" "text" NOT NULL,
    "officer_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid"
);


ALTER TABLE "public"."review_officers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_officers_ratings" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "review_officer_id" "text",
    "trait_id" "text",
    "rubric_id" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid"
);


ALTER TABLE "public"."review_officers_ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_tags" (
    "review_id" "text" NOT NULL,
    "tag_id" "text" NOT NULL,
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL
);


ALTER TABLE "public"."review_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_witnesses" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "review_id" "text",
    "profile_id" "uuid",
    "statement" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."review_witnesses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "incident_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "desired_outcome" "text",
    "address" "text",
    "thumbnail_url" "text"
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rubrics" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "trait_id" "text" NOT NULL,
    "label" "public"."rating_label" NOT NULL,
    "description" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "help" "text" NOT NULL
);


ALTER TABLE "public"."rubrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "label" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."traits" (
    "id" "text" DEFAULT "public"."generate_cuid"() NOT NULL,
    "label" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid"
);


ALTER TABLE "public"."traits" OWNER TO "postgres";


ALTER TABLE ONLY "public"."agency_links"
    ADD CONSTRAINT "agency_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agency_officers"
    ADD CONSTRAINT "agency_officers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agency_phone_numbers"
    ADD CONSTRAINT "agency_phone_numbers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agency"
    ADD CONSTRAINT "agency_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."officers"
    ADD CONSTRAINT "officers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_emails"
    ADD CONSTRAINT "profile_emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_links"
    ADD CONSTRAINT "profile_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_phone_numbers"
    ADD CONSTRAINT "profile_phone_numbers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rating_values"
    ADD CONSTRAINT "rating_values_pkey" PRIMARY KEY ("label");



ALTER TABLE ONLY "public"."review_attachments"
    ADD CONSTRAINT "review_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_links"
    ADD CONSTRAINT "review_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_officers"
    ADD CONSTRAINT "review_officers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_officers_ratings"
    ADD CONSTRAINT "review_officers_ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_tags"
    ADD CONSTRAINT "review_tags_id_key" UNIQUE ("id");



ALTER TABLE ONLY "public"."review_tags"
    ADD CONSTRAINT "review_tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_tags"
    ADD CONSTRAINT "review_tags_review_id_tag_id_key" UNIQUE ("review_id", "tag_id");



ALTER TABLE ONLY "public"."review_witnesses"
    ADD CONSTRAINT "review_witnesses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rubrics"
    ADD CONSTRAINT "rubrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."traits"
    ADD CONSTRAINT "traits_name_key" UNIQUE ("label");



ALTER TABLE ONLY "public"."traits"
    ADD CONSTRAINT "traits_pkey" PRIMARY KEY ("id");



CREATE INDEX "review_links_review_id_idx" ON "public"."review_links" USING "btree" ("review_id");



CREATE INDEX "review_officers_officer_id_idx" ON "public"."review_officers" USING "btree" ("officer_id");



CREATE INDEX "review_officers_ratings_review_officer_id_idx" ON "public"."review_officers_ratings" USING "btree" ("review_officer_id");



CREATE INDEX "review_officers_ratings_rubric_id_idx" ON "public"."review_officers_ratings" USING "btree" ("rubric_id");



CREATE INDEX "review_officers_ratings_trait_id_idx" ON "public"."review_officers_ratings" USING "btree" ("trait_id");



CREATE INDEX "review_officers_review_id_idx" ON "public"."review_officers" USING "btree" ("review_id");



CREATE OR REPLACE TRIGGER "agency_officer_change" AFTER INSERT OR DELETE OR UPDATE 
ON "public"."agency_officers" FOR EACH ROW EXECUTE FUNCTION "public"."handle_agency_officer_change"();



CREATE OR REPLACE TRIGGER "officers_audit" BEFORE UPDATE 
ON "public"."review_officers" FOR EACH ROW EXECUTE FUNCTION "public"."officers_audit_trigger"();



CREATE OR REPLACE TRIGGER "officers_ratings_audit" BEFORE UPDATE 
ON "public"."review_officers_ratings" FOR EACH ROW EXECUTE FUNCTION "public"."officers_audit_trigger"();



CREATE OR REPLACE TRIGGER "review_links_audit" BEFORE UPDATE 
ON "public"."review_links" FOR EACH ROW EXECUTE FUNCTION "public"."review_links_audit_trigger"();



CREATE OR REPLACE TRIGGER "review_links_audit_log" AFTER INSERT OR DELETE OR UPDATE 
ON "public"."review_links" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_func"();



CREATE OR REPLACE TRIGGER "review_officers_audit_log" AFTER INSERT OR DELETE OR UPDATE 
ON "public"."review_officers" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_func"();



CREATE OR REPLACE TRIGGER "review_officers_ratings_audit_log" AFTER INSERT OR DELETE OR UPDATE 
ON "public"."review_officers_ratings" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_func"();



CREATE OR REPLACE TRIGGER "review_rating_change" AFTER INSERT OR DELETE OR UPDATE 
ON "public"."review_officers_ratings" FOR EACH ROW EXECUTE FUNCTION "public"."handle_review_rating_change"();



CREATE OR REPLACE TRIGGER "rubrics_audit_trigger" AFTER INSERT OR DELETE OR UPDATE 
ON "public"."rubrics" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_func"();



CREATE OR REPLACE TRIGGER "traits_audit_trigger" AFTER INSERT OR DELETE OR UPDATE 
ON "public"."traits" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger_func"();



CREATE OR REPLACE TRIGGER "update_agency_overall_stats" BEFORE UPDATE OF "review_stats"
ON "public"."agency" FOR EACH ROW EXECUTE FUNCTION "public"."update_overall_stats"();

ALTER TABLE "public"."agency" DISABLE TRIGGER "update_agency_overall_stats";



CREATE OR REPLACE TRIGGER "update_officers_overall_stats" BEFORE UPDATE OF "review_stats"
ON "public"."officers" FOR EACH ROW EXECUTE FUNCTION "public"."update_overall_stats"();

ALTER TABLE "public"."officers" DISABLE TRIGGER "update_officers_overall_stats";



ALTER TABLE ONLY "public"."agency_links"
    ADD CONSTRAINT "agency_links_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "public"."agency"("id");



ALTER TABLE ONLY "public"."agency_officers"
    ADD CONSTRAINT "agency_officers_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "public"."agency"("id");



ALTER TABLE ONLY "public"."agency_officers"
    ADD CONSTRAINT "agency_officers_officer_id_fkey" FOREIGN KEY ("officer_id") REFERENCES "public"."officers"("id") ON
DELETE
CASCADE;



ALTER TABLE ONLY "public"."agency_phone_numbers"
    ADD CONSTRAINT "agency_phone_numbers_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "public"."agency"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON
DELETE
SET NULL;



ALTER TABLE ONLY "public"."profile_emails"
    ADD CONSTRAINT "profile_emails_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON
DELETE
CASCADE;



ALTER TABLE ONLY "public"."profile_links"
    ADD CONSTRAINT "profile_links_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON
DELETE
CASCADE;



ALTER TABLE ONLY "public"."profile_phone_numbers"
    ADD CONSTRAINT "profile_phone_numbers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON
DELETE
CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON
DELETE
CASCADE;



ALTER TABLE ONLY "public"."review_attachments"
    ADD CONSTRAINT "review_attachments_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON
DELETE
CASCADE;



ALTER TABLE ONLY "public"."review_links"
    ADD CONSTRAINT "review_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."review_links"
    ADD CONSTRAINT "review_links_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id");



ALTER TABLE ONLY "public"."review_links"
    ADD CONSTRAINT "review_links_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."review_officers"
    ADD CONSTRAINT "review_officers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."review_officers"
    ADD CONSTRAINT "review_officers_officer_id_fkey" FOREIGN KEY ("officer_id") REFERENCES "public"."officers"("id");



ALTER TABLE ONLY "public"."review_officers_ratings"
    ADD CONSTRAINT "review_officers_ratings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."review_officers_ratings"
    ADD CONSTRAINT "review_officers_ratings_review_officer_id_fkey" FOREIGN KEY ("review_officer_id") REFERENCES "public"."review_officers"("id");



ALTER TABLE ONLY "public"."review_officers_ratings"
    ADD CONSTRAINT "review_officers_ratings_rubric_id_fkey" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id");



ALTER TABLE ONLY "public"."review_officers_ratings"
    ADD CONSTRAINT "review_officers_ratings_trait_id_fkey" FOREIGN KEY ("trait_id") REFERENCES "public"."traits"("id");



ALTER TABLE ONLY "public"."review_officers_ratings"
    ADD CONSTRAINT "review_officers_ratings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."review_officers"
    ADD CONSTRAINT "review_officers_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id");



ALTER TABLE ONLY "public"."review_officers"
    ADD CONSTRAINT "review_officers_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."review_tags"
    ADD CONSTRAINT "review_tags_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON
DELETE
CASCADE;



ALTER TABLE ONLY "public"."review_tags"
    ADD CONSTRAINT "review_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON
DELETE
CASCADE;



ALTER TABLE ONLY "public"."review_witnesses"
    ADD CONSTRAINT "review_witnesses_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON
DELETE
SET NULL;



ALTER TABLE ONLY "public"."review_witnesses"
    ADD CONSTRAINT "review_witnesses_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON
DELETE
CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON
DELETE
SET NULL;



ALTER TABLE ONLY "public"."rubrics"
    ADD CONSTRAINT "rubrics_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON
DELETE
SET NULL;



ALTER TABLE ONLY "public"."rubrics"
    ADD CONSTRAINT "rubrics_trait_id_fkey" FOREIGN KEY ("trait_id") REFERENCES "public"."traits"("id") ON
DELETE
CASCADE;



ALTER TABLE ONLY "public"."rubrics"
    ADD CONSTRAINT "rubrics_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON
DELETE
SET NULL;



ALTER TABLE ONLY "public"."traits"
    ADD CONSTRAINT "traits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON
DELETE
SET NULL;



ALTER TABLE ONLY "public"."traits"
    ADD CONSTRAINT "traits_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON
DELETE
SET NULL;



CREATE POLICY "Users can delete own emails" ON "public"."profile_emails" FOR DELETE
USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can delete own links" ON "public"."profile_links" FOR DELETE
USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can delete own phone numbers" ON "public"."profile_phone_numbers" FOR DELETE
USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own profile" ON "public"."profiles" FOR DELETE
USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert own emails" ON "public"."profile_emails" FOR INSERT WITH CHECK (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can insert own links" ON "public"."profile_links" FOR INSERT WITH CHECK (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can insert own phone numbers" ON "public"."profile_phone_numbers" FOR INSERT WITH CHECK (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can insert their own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own emails" ON "public"."profile_emails" FOR UPDATE 
USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can update own links" ON "public"."profile_links" FOR UPDATE 
USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can update own phone numbers" ON "public"."profile_phone_numbers" FOR UPDATE 
USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE 
USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own emails" ON "public"."profile_emails" FOR SELECT 
USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can view own links" ON "public"."profile_links" FOR SELECT 
USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can view own phone numbers" ON "public"."profile_phone_numbers" FOR SELECT 
USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own profile" ON "public"."profiles" FOR SELECT 
USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."profile_emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_phone_numbers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;



ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




















































































































































































GRANT ALL ON FUNCTION "public"."audit_trigger_func"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_trigger_func"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_trigger_func"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_agency_officer_stats"("agency_officer_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_agency_officer_stats"("agency_officer_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_agency_officer_stats"("agency_officer_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_overall_rating_stats"("rating_stats" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_overall_rating_stats"("rating_stats" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_overall_rating_stats"("rating_stats" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_rating_stats"("review_officers_ratings_array" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_rating_stats"("review_officers_ratings_array" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_rating_stats"("review_officers_ratings_array" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_cuid"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_cuid"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_cuid"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_agency_officer_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_agency_officer_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_agency_officer_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_review_rating_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_review_rating_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_review_rating_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."officers_audit_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."officers_audit_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."officers_audit_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_trait_deletion"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_trait_deletion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_trait_deletion"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_trait_modification"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_trait_modification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_trait_modification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."review_links_audit_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."review_links_audit_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."review_links_audit_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_set_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_set_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_set_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_agency_overall_rating"("agency_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_agency_overall_rating"("agency_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_agency_overall_rating"("agency_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_officer_overall_rating"("officer_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_officer_overall_rating"("officer_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_officer_overall_rating"("officer_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_overall_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_overall_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_overall_stats"() TO "service_role";


















GRANT ALL ON TABLE "public"."agency" TO "anon";
GRANT ALL ON TABLE "public"."agency" TO "authenticated";
GRANT ALL ON TABLE "public"."agency" TO "service_role";



GRANT ALL
ON TABLE "public"."agency_links" TO "anon";
GRANT ALL
ON TABLE "public"."agency_links" TO "authenticated";
GRANT ALL
ON TABLE "public"."agency_links" TO "service_role";



GRANT ALL
ON TABLE "public"."agency_officers" TO "anon";
GRANT ALL
ON TABLE "public"."agency_officers" TO "authenticated";
GRANT ALL
ON TABLE "public"."agency_officers" TO "service_role";



GRANT ALL
ON TABLE "public"."agency_phone_numbers" TO "anon";
GRANT ALL
ON TABLE "public"."agency_phone_numbers" TO "authenticated";
GRANT ALL
ON TABLE "public"."agency_phone_numbers" TO "service_role";



GRANT ALL
ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL
ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL
ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL
ON TABLE "public"."officers" TO "anon";
GRANT ALL
ON TABLE "public"."officers" TO "authenticated";
GRANT ALL
ON TABLE "public"."officers" TO "service_role";



GRANT ALL
ON TABLE "public"."profile_emails" TO "anon";
GRANT ALL
ON TABLE "public"."profile_emails" TO "authenticated";
GRANT ALL
ON TABLE "public"."profile_emails" TO "service_role";



GRANT ALL
ON TABLE "public"."profile_links" TO "anon";
GRANT ALL
ON TABLE "public"."profile_links" TO "authenticated";
GRANT ALL
ON TABLE "public"."profile_links" TO "service_role";



GRANT ALL
ON TABLE "public"."profile_phone_numbers" TO "anon";
GRANT ALL
ON TABLE "public"."profile_phone_numbers" TO "authenticated";
GRANT ALL
ON TABLE "public"."profile_phone_numbers" TO "service_role";



GRANT ALL
ON TABLE "public"."profiles" TO "anon";
GRANT ALL
ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL
ON TABLE "public"."profiles" TO "service_role";



GRANT ALL
ON TABLE "public"."rating_values" TO "anon";
GRANT ALL
ON TABLE "public"."rating_values" TO "authenticated";
GRANT ALL
ON TABLE "public"."rating_values" TO "service_role";



GRANT ALL
ON TABLE "public"."review_attachments" TO "anon";
GRANT ALL
ON TABLE "public"."review_attachments" TO "authenticated";
GRANT ALL
ON TABLE "public"."review_attachments" TO "service_role";



GRANT ALL
ON TABLE "public"."review_links" TO "anon";
GRANT ALL
ON TABLE "public"."review_links" TO "authenticated";
GRANT ALL
ON TABLE "public"."review_links" TO "service_role";



GRANT ALL
ON TABLE "public"."review_officers" TO "anon";
GRANT ALL
ON TABLE "public"."review_officers" TO "authenticated";
GRANT ALL
ON TABLE "public"."review_officers" TO "service_role";



GRANT ALL
ON TABLE "public"."review_officers_ratings" TO "anon";
GRANT ALL
ON TABLE "public"."review_officers_ratings" TO "authenticated";
GRANT ALL
ON TABLE "public"."review_officers_ratings" TO "service_role";



GRANT ALL
ON TABLE "public"."review_tags" TO "anon";
GRANT ALL
ON TABLE "public"."review_tags" TO "authenticated";
GRANT ALL
ON TABLE "public"."review_tags" TO "service_role";



GRANT ALL
ON TABLE "public"."review_witnesses" TO "anon";
GRANT ALL
ON TABLE "public"."review_witnesses" TO "authenticated";
GRANT ALL
ON TABLE "public"."review_witnesses" TO "service_role";



GRANT ALL
ON TABLE "public"."reviews" TO "anon";
GRANT ALL
ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL
ON TABLE "public"."reviews" TO "service_role";



GRANT ALL
ON TABLE "public"."rubrics" TO "anon";
GRANT ALL
ON TABLE "public"."rubrics" TO "authenticated";
GRANT ALL
ON TABLE "public"."rubrics" TO "service_role";



GRANT ALL
ON TABLE "public"."tags" TO "anon";
GRANT ALL
ON TABLE "public"."tags" TO "authenticated";
GRANT ALL
ON TABLE "public"."tags" TO "service_role";



GRANT ALL
ON TABLE "public"."traits" TO "anon";
GRANT ALL
ON TABLE "public"."traits" TO "authenticated";
GRANT ALL
ON TABLE "public"."traits" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























RESET ALL;
