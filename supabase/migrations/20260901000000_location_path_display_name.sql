-- Collapse the three denormalized name columns into one per-row display_name at
-- the row's own level. Ancestor names (county, state) are resolved by walking
-- parent_location_path_id / path, an existing pattern (readLocationPathByPath) —
-- not stored redundantly. slug columns and level are unchanged.
alter table "public"."location_path" add column "display_name" text;

update "public"."location_path"
set "display_name" = case "level"
  when 'place' then "place_name"
  when 'administrative_area' then "administrative_area_name"
  else "state_or_territory_name"
end;

alter table "public"."location_path" alter column "display_name" set not null;

alter table "public"."location_path" drop column "state_or_territory_name";
alter table "public"."location_path" drop column "administrative_area_name";
alter table "public"."location_path" drop column "place_name";
