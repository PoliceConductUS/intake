alter table public.reviews
  add column if not exists location_path_id text references public.location_path(location_path_id) on delete set null;

alter table public.civil_cases
  add column if not exists location_path_id text references public.location_path(location_path_id) on delete set null;

create index if not exists reviews_location_path_id_idx
  on public.reviews(location_path_id);

create index if not exists civil_cases_location_path_id_idx
  on public.civil_cases(location_path_id);

alter table public.reviews
  drop column if exists category;

alter table public.civil_cases
  drop column if exists category;
