-- A valid agency has a non-empty, geocodable location. Its location_path_id is
-- already NOT NULL, but the address/city/zip that geocode to it, and the
-- resulting coordinates, were nullable. They are all createRequired in the entity
-- model (the Create mutation always supplies them, from the source or a seed), so
-- the database should enforce it too.
alter table public.agency
  alter column address set not null,
  alter column city set not null,
  alter column zip_code set not null,
  alter column latitude set not null,
  alter column longitude set not null;
