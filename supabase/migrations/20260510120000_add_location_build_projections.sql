create table if not exists public.location_path (
  location_path_id text primary key,
  path text not null unique,
  level text not null check (level in ('state', 'administrative_area', 'place')),
  state_or_territory_slug text not null,
  administrative_area_slug text,
  place_slug text,
  state_or_territory_name text not null,
  administrative_area_name text,
  place_name text,
  parent_location_path_id text references public.location_path(location_path_id),
  latitude double precision,
  longitude double precision,
  map_min_lat double precision,
  map_min_lng double precision,
  map_max_lat double precision,
  map_max_lng double precision,
  map_position_source text check (map_position_source in ('geocoded', 'derived_from_children')),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.location_path_closure (
  ancestor_location_path_id text not null references public.location_path(location_path_id) on delete cascade,
  descendant_location_path_id text not null references public.location_path(location_path_id) on delete cascade,
  depth integer not null check (depth >= 0),
  primary key (ancestor_location_path_id, descendant_location_path_id)
);

create table if not exists public.build_page_payload (
  path text primary key,
  page_type text not null,
  entity_id text,
  payload jsonb not null,
  content_hash text not null,
  content_updated_at timestamp with time zone,
  generated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.agency_zip_index (
  postal_code text not null,
  agency_id text not null references public.agency(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('official_address')),
  primary key (postal_code, agency_id, relationship_type)
);

alter table public.agency
  add column if not exists location_path_id text references public.location_path(location_path_id) on delete set null,
  add column if not exists agency_slug text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

update public.agency
set agency_slug = slug
where agency_slug is null
  and slug is not null;

create unique index if not exists agency_location_path_slug_unique_idx
  on public.agency (location_path_id, agency_slug)
  where location_path_id is not null
    and agency_slug is not null;

create index if not exists location_path_parent_idx
  on public.location_path (parent_location_path_id);

create index if not exists location_path_closure_descendant_idx
  on public.location_path_closure (descendant_location_path_id);

create index if not exists build_page_payload_page_type_idx
  on public.build_page_payload (page_type);

drop index if exists public.agency_canonical_url_unique_idx;

alter table public.agency
  drop column if exists canonical_url;
