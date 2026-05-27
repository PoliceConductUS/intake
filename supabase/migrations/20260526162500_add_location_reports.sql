create table if not exists public.location_reports (
  id text primary key,
  location_path_id text not null references public.location_path(location_path_id) on delete restrict,
  report_type text not null,
  report_key text not null,
  title text not null,
  summary text not null,
  payload jsonb not null,
  sort_order integer not null default 0,
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  published_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (location_path_id, report_key)
);

create table if not exists public.location_report_sources (
  id text primary key,
  location_report_id text not null references public.location_reports(id) on delete cascade,
  source_key text not null,
  label text not null,
  url text not null,
  source_type text not null default 'web' check (source_type in ('law', 'methodology', 'pdf', 'web')),
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  unique (location_report_id, source_key)
);

create index if not exists location_reports_location_path_idx
  on public.location_reports(location_path_id, sort_order, title);

create index if not exists location_report_sources_report_idx
  on public.location_report_sources(location_report_id, sort_order, label);
