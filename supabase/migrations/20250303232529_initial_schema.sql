-- Collapsed from 20250303232529_remote_schema.sql
-- Portable (non-Supabase) form: Supabase extensions/roles/RLS/privileges/audit
-- removed.

set search_path to public;
create extension if not exists postgis;

-- Collapsed from 20250303232529_remote_schema.sql

set
statement_timeout = 0;
set
lock_timeout = 0;
set
idle_in_transaction_session_timeout = 0;
set
client_encoding = 'UTF8';
set
standard_conforming_strings = on;
set
check_function_bodies = false;
set
xmloption = content;
set
client_min_messages = warning;
set
row_security = off;


create type public.rating_label as enum (
    'Outstanding',
    'Good',
    'Adequate',
    'Needs Improvement',
    'Unacceptable'
);


create or replace function public.calculate_agency_officer_stats(
    "agency_officer_id" text
) returns void
language plpgsql
as $$
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


create or replace function public.calculate_overall_rating_stats(
    "rating_stats" jsonb
) returns jsonb
language plpgsql
as $$
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
-- We could implement a more sophisticated weighted average calculation here if
-- needed
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


create or replace function public.calculate_rating_stats(
    "review_officers_ratings_array" jsonb
) returns jsonb
language plpgsql
as $$
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


create or replace function public.generate_cuid() returns text
language plpgsql
as $$
BEGIN
RETURN LOWER(
        'c' ||
        TO_CHAR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP), 'FM9999999999') ||
        SUBSTRING(MD5(RANDOM()::TEXT) FOR 8)
       );
END;
$$;


create or replace function public.handle_agency_officer_change() returns trigger
language plpgsql
as $$
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


create or replace function public.handle_new_user() returns trigger
language plpgsql security definer
set "search_path" to 'public'
as $$
begin
insert into public.profiles (id)
values (new.id);
return new;
end;
$$;


create or replace function public.handle_review_rating_change() returns trigger
language plpgsql
as $$
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


create or replace function public.prevent_trait_deletion() returns trigger
language plpgsql
as $$
BEGIN
    IF
EXISTS (SELECT 1 FROM review_ratings WHERE trait_id = OLD.id) THEN
        RAISE EXCEPTION 'Cannot delete trait with existing ratings';
END IF;
RETURN OLD;
END;
$$;


create or replace function public.prevent_trait_modification() returns trigger
language plpgsql
as $$
BEGIN
    IF
EXISTS (SELECT 1 FROM review_ratings WHERE trait_id = NEW.id)
       AND (OLD.code != NEW.code OR OLD.name != NEW.name OR OLD.description != NEW.description) THEN
        RAISE EXCEPTION 'Cannot modify trait with existing ratings';
END IF;
RETURN NEW;
END;
$$;


create or replace function public.trigger_set_timestamp() returns trigger
language plpgsql
as $$
BEGIN
    NEW.updated_at
= timezone('utc'::text, now());
RETURN NEW;
END;
$$;


create or replace function public.update_agency_overall_rating(
    "agency_id" text
) returns void
language plpgsql
as $$
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


create or replace function public.update_officer_overall_rating(
    "officer_id" text
) returns void
language plpgsql
as $$
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


create or replace function public.update_overall_stats() returns trigger
language plpgsql
as $$
BEGIN
  -- Calculate and merge the overall stats with existing review_stats
  NEW.review_stats
:= NEW.review_stats || calculate_overall_rating_stats(NEW.review_stats);
RETURN NEW;
END;
$$;

set
default_tablespace = '';

set default_table_access_method = heap;

create table if not exists public.agency (
    id text default public.generate_cuid() not null,
    -- RF04: This existing schema identifier is consumed by migrations and
    -- clients. Renaming it requires a coordinated schema/API change.
    name text not null,
    city text,
    state text not null,
    address text,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    updated_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    zip_code text,
    contact_name text,
    contact_email text,
    review_stats jsonb default '{}'::jsonb,
    review_count integer default 0,
    rating_overall numeric default 0
);


comment
on column public.agency.contact_name is
'Name of the primary contact person for the agency';


comment
on column public.agency.contact_email is
'Email address of the primary contact person for the agency';


create table if not exists public.agency_links (
    id text default public.generate_cuid() not null,
    agency_id text,
    url text not null,
    description text,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null
);


create table if not exists public.agency_officers (
    id text default public.generate_cuid() not null,
    agency_id text,
    officer_id text not null,
    badge_number text,
    start_date date not null,
    end_date date,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    updated_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    license_type text not null,
    rating_overall numeric default 0,
    review_stats jsonb default '{}'::jsonb
);


create table if not exists public.agency_phone_numbers (
    id text default public.generate_cuid() not null,
    agency_id text,
    phone_number text not null,
    description text,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null
);


create table if not exists public.audit_logs (
    id text default public.generate_cuid() not null,
    table_name text not null,
    record_id text not null,
    -- RF04: This existing schema identifier is consumed by migrations and
    -- clients. Renaming it requires a coordinated schema/API change.
    action text not null,
    old_values jsonb,
    new_values jsonb,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    created_by uuid
);


create table if not exists public.officers (
    id text default public.generate_cuid() not null,
    first_name text not null,
    last_name text not null,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    updated_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    middle_name text,
    -- RF04: This existing schema identifier is consumed by migrations and
    -- clients. Renaming it requires a coordinated schema/API change.
    prefix text,
    suffix text,
    review_stats jsonb default '{}'::jsonb,
    rating_overall numeric default 0
);


create table if not exists public.profile_emails (
    id text default public.generate_cuid() not null,
    profile_id uuid,
    email text not null,
    is_primary boolean default false,
    verified boolean default false,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    -- RF04: This existing schema identifier is consumed by migrations and
    -- clients. Renaming it requires a coordinated schema/API change.
    label text
);


create table if not exists public.profile_links (
    id text default public.generate_cuid() not null,
    profile_id uuid,
    url text not null,
    -- RF04: This existing schema identifier is consumed by migrations and
    -- clients. Renaming it requires a coordinated schema/API change.
    label text not null,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null
);


create table if not exists public.profile_phone_numbers (
    id text default public.generate_cuid() not null,
    profile_id uuid,
    phone_number text not null,
    is_primary boolean default false,
    can_receive_sms boolean default false,
    is_verified boolean default false,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    -- RF04: This existing schema identifier is consumed by migrations and
    -- clients. Renaming it requires a coordinated schema/API change.
    label text
);


create table if not exists public.profiles (
    id uuid not null,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    updated_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    phone_number text,
    avatar_url text,
    street_address text,
    city text,
    state text,
    zip_code text,
    primary_phone_id text,
    primary_email_id text,
    mailing_address_street text,
    mailing_address_city text,
    mailing_address_state text,
    mailing_address_zip text,
    physical_address_street text,
    physical_address_city text,
    physical_address_state text,
    physical_address_zip text,
    languages text []
);


create table if not exists public.rating_values (
    -- RF04: This existing schema identifier is consumed by migrations and
    -- clients. Renaming it requires a coordinated schema/API change.
    label public.rating_label not null,
    -- RF04: This existing schema identifier is consumed by migrations and
    -- clients. Renaming it requires a coordinated schema/API change.
    value integer not null
);


create table if not exists public.review_attachments (
    id text default public.generate_cuid() not null,
    review_id text,
    file_path text not null,
    file_name text not null,
    content_type text not null,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null
);


create table if not exists public.review_links (
    id text default public.generate_cuid() not null,
    review_id text,
    url text not null,
    title text not null,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    updated_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    created_by uuid,
    updated_by uuid
);


create table if not exists public.review_officers (
    id text default public.generate_cuid() not null,
    review_id text not null,
    officer_id text not null,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    updated_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    created_by uuid,
    updated_by uuid
);


create table if not exists public.review_officers_ratings (
    id text default public.generate_cuid() not null,
    review_officer_id text,
    trait_id text,
    rubric_id text,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    updated_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    created_by uuid,
    updated_by uuid
);


create table if not exists public.review_tags (
    review_id text not null,
    tag_id text not null,
    id text default public.generate_cuid() not null
);


create table if not exists public.review_witnesses (
    id text default public.generate_cuid() not null,
    review_id text,
    profile_id uuid,
    -- RF04: This existing schema identifier is consumed by migrations and
    -- clients. Renaming it requires a coordinated schema/API change.
    statement text,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    updated_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null
);


create table if not exists public.reviews (
    id text default public.generate_cuid() not null,
    user_id uuid,
    title text not null,
    description text,
    incident_date timestamp with time zone,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    updated_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    desired_outcome text,
    address text,
    thumbnail_url text
);


create table if not exists public.rubrics (
    id text default public.generate_cuid() not null,
    trait_id text not null,
    -- RF04: This existing schema identifier is consumed by migrations and
    -- clients. Renaming it requires a coordinated schema/API change.
    label public.rating_label not null,
    description text not null,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    updated_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    created_by uuid,
    updated_by uuid,
    help text not null
);


create table if not exists public.tags (
    id text default public.generate_cuid() not null,
    -- RF04: This existing schema identifier is consumed by migrations and
    -- clients. Renaming it requires a coordinated schema/API change.
    label text not null,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    updated_at timestamp with time zone default now() not null
);


create table if not exists public.traits (
    id text default public.generate_cuid() not null,
    -- RF04: This existing schema identifier is consumed by migrations and
    -- clients. Renaming it requires a coordinated schema/API change.
    label text not null,
    active boolean default true,
    created_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    updated_at timestamp with time zone default timezone(
        'utc'::text, now()
    ) not null,
    created_by uuid,
    updated_by uuid
);


alter table only public.agency_links
add constraint agency_links_pkey primary key (id);


alter table only public.agency_officers
add constraint agency_officers_pkey primary key (id);


alter table only public.agency_phone_numbers
add constraint agency_phone_numbers_pkey primary key (id);


alter table only public.agency
add constraint agency_pkey primary key (id);


alter table only public.audit_logs
add constraint audit_logs_pkey primary key (id);


alter table only public.officers
add constraint officers_pkey primary key (id);


alter table only public.profile_emails
add constraint profile_emails_pkey primary key (id);


alter table only public.profile_links
add constraint profile_links_pkey primary key (id);


alter table only public.profile_phone_numbers
add constraint profile_phone_numbers_pkey primary key (id);


alter table only public.profiles
add constraint profiles_pkey primary key (id);


alter table only public.rating_values
add constraint rating_values_pkey primary key (label);


alter table only public.review_attachments
add constraint review_attachments_pkey primary key (id);


alter table only public.review_links
add constraint review_links_pkey primary key (id);


alter table only public.review_officers
add constraint review_officers_pkey primary key (id);


alter table only public.review_officers_ratings
add constraint review_officers_ratings_pkey primary key (id);


alter table only public.review_tags
add constraint review_tags_id_key unique (id);


alter table only public.review_tags
add constraint review_tags_pkey primary key (id);


alter table only public.review_tags
add constraint review_tags_review_id_tag_id_key unique (
    review_id, tag_id
);


alter table only public.review_witnesses
add constraint review_witnesses_pkey primary key (id);


alter table only public.reviews
add constraint reviews_pkey primary key (id);


alter table only public.rubrics
add constraint rubrics_pkey primary key (id);


alter table only public.tags
add constraint tags_pkey primary key (id);


alter table only public.traits
add constraint traits_name_key unique (label);


alter table only public.traits
add constraint traits_pkey primary key (id);


create index review_links_review_id_idx on public.review_links using btree (
    review_id
);


create index review_officers_officer_id_idx on public.review_officers using
btree (
    officer_id
);


create index review_officers_ratings_review_officer_id_idx on
public.review_officers_ratings using btree (
    review_officer_id
);


create index review_officers_ratings_rubric_id_idx on
public.review_officers_ratings using btree (
    rubric_id
);


create index review_officers_ratings_trait_id_idx on
public.review_officers_ratings using btree (
    trait_id
);


create index review_officers_review_id_idx on public.review_officers using
btree (
    review_id
);


create or replace trigger agency_officer_change after insert or delete or update
on public.agency_officers for each row execute function
public.handle_agency_officer_change();


create or replace trigger review_rating_change after insert or delete or update
on public.review_officers_ratings for each row execute function
public.handle_review_rating_change();


create or replace trigger update_agency_overall_stats before update of
review_stats
on public.agency for each row execute function public.update_overall_stats();

alter table public.agency disable trigger "update_agency_overall_stats";


create or replace trigger update_officers_overall_stats before update of
review_stats
on public.officers for each row execute function public.update_overall_stats();

alter table public.officers disable trigger "update_officers_overall_stats";


alter table only public.agency_links
add constraint agency_links_agency_id_fkey foreign key (
    agency_id
) references public.agency (id);


alter table only public.agency_officers
add constraint agency_officers_agency_id_fkey foreign key (
    agency_id
) references public.agency (id);


alter table only public.agency_officers
add constraint agency_officers_officer_id_fkey foreign key (
    officer_id
) references public.officers (id) on
delete
cascade;


alter table only public.agency_phone_numbers
add constraint agency_phone_numbers_agency_id_fkey foreign key (
    agency_id
) references public.agency (id);


alter table only public.audit_logs
add constraint audit_logs_created_by_fkey foreign key (
    created_by
) references public.profiles (id) on
delete
set null;


alter table only public.profile_emails
add constraint profile_emails_profile_id_fkey foreign key (
    profile_id
) references public.profiles (id) on
delete
cascade;


alter table only public.profile_links
add constraint profile_links_profile_id_fkey foreign key (
    profile_id
) references public.profiles (id) on
delete
cascade;


alter table only public.profile_phone_numbers
add constraint profile_phone_numbers_profile_id_fkey foreign key (
    profile_id
) references public.profiles (id) on
delete
cascade;


alter table only public.review_attachments
add constraint review_attachments_review_id_fkey foreign key (
    review_id
) references public.reviews (id) on
delete
cascade;


alter table only public.review_links
add constraint review_links_review_id_fkey foreign key (
    review_id
) references public.reviews (id);


alter table only public.review_officers
add constraint review_officers_officer_id_fkey foreign key (
    officer_id
) references public.officers (id);


alter table only public.review_officers_ratings
add constraint review_officers_ratings_review_officer_id_fkey foreign key (
    review_officer_id
) references public.review_officers (id);


alter table only public.review_officers_ratings
add constraint review_officers_ratings_rubric_id_fkey foreign key (
    rubric_id
) references public.rubrics (id);


alter table only public.review_officers_ratings
add constraint review_officers_ratings_trait_id_fkey foreign key (
    trait_id
) references public.traits (id);


alter table only public.review_officers
add constraint review_officers_review_id_fkey foreign key (
    review_id
) references public.reviews (id);


alter table only public.review_tags
add constraint review_tags_review_id_fkey foreign key (
    review_id
) references public.reviews (id) on
delete
cascade;


alter table only public.review_tags
add constraint review_tags_tag_id_fkey foreign key (
    tag_id
) references public.tags (id) on
delete
cascade;


alter table only public.review_witnesses
add constraint review_witnesses_profile_id_fkey foreign key (
    profile_id
) references public.profiles (id) on
delete
set null;


alter table only public.review_witnesses
add constraint review_witnesses_review_id_fkey foreign key (
    review_id
) references public.reviews (id) on
delete
cascade;


alter table only public.reviews
add constraint reviews_user_id_fkey foreign key (
    user_id
) references public.profiles (id) on
delete
set null;


alter table only public.rubrics
add constraint rubrics_created_by_fkey foreign key (
    created_by
) references public.profiles (id) on
delete
set null;


alter table only public.rubrics
add constraint rubrics_trait_id_fkey foreign key (
    trait_id
) references public.traits (id) on
delete
cascade;


alter table only public.rubrics
add constraint rubrics_updated_by_fkey foreign key (
    updated_by
) references public.profiles (id) on
delete
set null;


alter table only public.traits
add constraint traits_created_by_fkey foreign key (
    created_by
) references public.profiles (id) on
delete
set null;


alter table only public.traits
add constraint traits_updated_by_fkey foreign key (
    updated_by
) references public.profiles (id) on
delete
set null;


reset all;
