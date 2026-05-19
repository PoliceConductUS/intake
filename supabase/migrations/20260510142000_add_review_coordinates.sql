alter table public.reviews
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

create index if not exists reviews_location_coordinates_idx
  on public.reviews(latitude, longitude)
  where latitude is not null and longitude is not null;
