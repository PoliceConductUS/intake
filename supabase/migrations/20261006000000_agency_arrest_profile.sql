-- One recomputed arrest aggregate per agency, including unassigned bookings.
create table public.agency_arrest_profile (
  id text primary key,
  agency_id text not null references public.agency (id) on delete cascade,
  coverage jsonb not null default '{}'::jsonb,
  breakdowns jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (agency_id)
);
