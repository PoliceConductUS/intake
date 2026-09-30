-- Per-officer arrest profile (ADR 0032). A flexible, recomputed summary of an
-- officer's arrests — counts broken down by year, offense, district, time, etc.
-- One row per officer (unique agency_personnel_id, the business key). No arrestee
-- PII is stored: only derived category counts in the jsonb breakdowns. `coverage`
-- records the source, date range, and totals behind the summary.

create table if not exists public.arrest_profile (
  id text primary key,
  agency_personnel_id text not null
    references public.agency_personnel (id) on delete cascade,
  coverage jsonb not null default '{}'::jsonb,
  breakdowns jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (agency_personnel_id)
);
