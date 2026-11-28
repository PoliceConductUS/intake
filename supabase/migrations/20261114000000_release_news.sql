alter table public.coverage_links
add column source_namespace text,
add column source_id text,
add column summary text,
add column occurrences jsonb,
add constraint coverage_links_source_pair
check ((source_namespace is null) = (source_id is null)),
add constraint coverage_links_source_identity
unique (source_namespace, source_id);

alter table public.coverage_link_agency_personnel
add column source_namespace text,
add column source_id text,
add column occurrence_url text,
add column correction_reason text,
add constraint coverage_assignment_source_pair
check ((source_namespace is null) = (source_id is null)),
add constraint coverage_assignment_source_identity
unique (source_namespace, source_id);

create table public.coverage_homepage_windows (
    id text primary key,
    window_end date not null unique,
    placement_count integer not null check (placement_count between 0 and 25)
);

create table public.coverage_homepage_placements (
    id text primary key,
    window_id text not null references public.coverage_homepage_windows (id),
    coverage_link_id text not null references public.coverage_links (id),
    position integer not null check (position between 1 and 25),
    clicks integer not null check (clicks >= 0),
    unique (window_id, position)
);
