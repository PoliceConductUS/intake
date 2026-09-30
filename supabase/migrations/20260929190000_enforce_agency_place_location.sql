-- A generated constant makes the referenced location's level part of the FK.
-- PostgreSQL also rejects reclassifying a place while an agency references it.
ALTER TABLE public.location_path
ADD CONSTRAINT location_path_id_level_key UNIQUE (location_path_id, level);

ALTER TABLE public.agency
ADD COLUMN location_path_level text GENERATED ALWAYS AS (
    'place'::text
) STORED NOT NULL,
ADD CONSTRAINT agency_location_path_place_fkey
FOREIGN KEY (location_path_id, location_path_level)
REFERENCES public.location_path (location_path_id, level) ON DELETE RESTRICT;
