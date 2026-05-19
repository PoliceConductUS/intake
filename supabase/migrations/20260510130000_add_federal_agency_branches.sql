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
