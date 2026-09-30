-- Discipline: a disciplinary/administrative action against a peace officer's
-- certification (a POST consent/board order, suspension, revocation, agency
-- termination, etc.). The event is one row; it is attributed to the agency
-- assignment(s) the officer held at the time via discipline_agency_officers —
-- the same event/participants split used by civil_cases / civil_case_officers.
-- Provenance, the originating complaint id, and the audit trail live in intake
-- YAML, not here: this table is the presentation record only.
create table if not exists public.discipline (
  id text primary key,
  action text not null check (char_length(btrim(action)) > 0),
  effective_date date,
  expiration_date date,
  case_number text check (case_number is null or char_length(btrim(case_number)) > 0),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

-- Attribution: which assignment(s) a discipline event reflects on. An officer
-- active at several agencies at the time implicates all of them, so this is a
-- one-to-many from the event. Each row is a link (its own id + a unique pair),
-- matching coverage_link_agency_officers.
create table if not exists public.discipline_agency_officers (
  id text primary key,
  discipline_id text not null
    references public.discipline (id) on delete cascade,
  agency_officer_id text not null
    references public.agency_officers (id) on delete cascade,
  unique (discipline_id, agency_officer_id)
);

create index if not exists discipline_agency_officers_discipline_idx
  on public.discipline_agency_officers (discipline_id);
create index if not exists discipline_agency_officers_agency_officer_idx
  on public.discipline_agency_officers (agency_officer_id);
