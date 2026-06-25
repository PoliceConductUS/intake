do $$
begin
  if not exists (
    select 1
    from pg_extension
    where extname = 'postgis'
  ) then
    create schema if not exists extensions;
    create extension postgis with schema extensions;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'location_path'
      and column_name = 'latitude'
  ) then
    alter table public.location_path drop column latitude;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'location_path'
      and column_name = 'longitude'
  ) then
    alter table public.location_path drop column longitude;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'location_path'
      and column_name = 'map_min_lat'
  ) then
    alter table public.location_path drop column map_min_lat;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'location_path'
      and column_name = 'map_min_lng'
  ) then
    alter table public.location_path drop column map_min_lng;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'location_path'
      and column_name = 'map_max_lat'
  ) then
    alter table public.location_path drop column map_max_lat;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'location_path'
      and column_name = 'map_max_lng'
  ) then
    alter table public.location_path drop column map_max_lng;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'location_path'
      and column_name = 'map_position_source'
  ) then
    alter table public.location_path drop column map_position_source;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'location_path'
      and column_name = 'centroid'
  ) then
    alter table public.location_path add column centroid geography(Point, 4326);
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'location_path'
      and column_name = 'bbox'
  ) then
    alter table public.location_path add column bbox geometry(Polygon, 4326);
  end if;
end $$;

do $$
begin
  if to_regclass('public.location_path_geometry') is null then
    create table public.location_path_geometry (
      location_path_id text primary key references public.location_path(location_path_id) on delete cascade,
      boundary geometry(Geometry, 4326) not null
    );
  end if;
end $$;

do $$
begin
  if to_regclass('public.location_path_geometry_boundary_gist') is null then
    create index location_path_geometry_boundary_gist
      on public.location_path_geometry using gist (boundary);
  end if;
end $$;
