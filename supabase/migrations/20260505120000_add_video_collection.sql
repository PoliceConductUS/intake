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
