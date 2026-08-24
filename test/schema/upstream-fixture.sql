-- Minimal stand-in for the pre-existing objects that
-- 20260824170000_provenance_structural_invariant.sql references.
--
-- Applied ONLY when public.agency does not already exist, so that against a
-- real `supabase db reset` database this file is skipped entirely and the
-- migration is exercised against the actual 45-table schema.
--
-- Column definitions are copied from
-- supabase/migrations/20250303232529_initial_schema.sql. PostGIS-dependent
-- columns (location_path_id, geometry) are omitted -- the provenance migration
-- does not reference them, and PostGIS is not available on a bare Postgres.

create extension if not exists pgcrypto;

create or replace function public.generate_cuid()
returns text
language plpgsql
as $$
begin
    return lower(
        'c'
        || to_char(extract(epoch from current_timestamp), 'FM9999999999')
        || substring(md5(random()::text) for 8)
    );
end;
$$;

create table if not exists public.agency (
    id text primary key default public.generate_cuid(),
    name text not null,
    city text,
    state text not null,
    address text,
    zip_code text,
    contact_name text,
    contact_email text,
    created_at timestamp with time zone not null default timezone('utc'::text, now()),
    updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.officers (
    id text primary key default public.generate_cuid(),
    first_name text not null,
    last_name text not null,
    middle_name text,
    prefix text,
    suffix text,
    created_at timestamp with time zone not null default timezone('utc'::text, now()),
    updated_at timestamp with time zone not null default timezone('utc'::text, now())
);
