-- Denormalized per-entity stats tables that nothing reads. Drop them.
drop table if exists public.agency_officers_stats;
drop table if exists public.agency_stats;
drop table if exists public.officers_stats;
