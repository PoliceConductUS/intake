-- The *_slug columns are a redundant normalized match key: path already encodes
-- them (/{state}/{area}/{place}/) and they are not unique (a place slug repeats
-- across counties). Drop them; place-snapping matches on path segments instead
-- (split_part(path,'/',2) = state, ',4' = place), backed by a functional index so
-- the snap stays fast. (No slug index existed before, so this is a net gain.)
create index if not exists "location_path_place_snap_idx"
  on "public"."location_path" (split_part("path", '/', 2), split_part("path", '/', 4))
  where "level" = 'place';

alter table "public"."location_path" drop column "state_or_territory_slug";
alter table "public"."location_path" drop column "administrative_area_slug";
alter table "public"."location_path" drop column "place_slug";
