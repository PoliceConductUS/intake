create table if not exists public.location_path_alias (
  alias_path text primary key,
  location_path_id text not null references public.location_path(location_path_id) on delete cascade
);
