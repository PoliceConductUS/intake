-- Stored facts the site page views read instead of splitting paths or
-- choosing an annotation's page (supply-site-display-data, "Page-shaped
-- views", "Schema changes").

-- A location row's own URL segment and, for a state row, its USPS code. The
-- Census gazetteer source writes both with the path it already writes.
-- Existing rows get them when the Census source is generated again; this
-- migration fills no row. The "required" rules (segment on every row,
-- state_code exactly on state rows) become NOT NULL and check constraints in
-- a later migration, after every row holds them (tasks.md 9.2a).
-- assert_site_projections() raises meanwhile on a page location whose
-- segment does not match its path.
alter table public.location_path
add column segment text,
add column state_code text,
add constraint location_path_segment_format check (
    segment is null or segment ~ '^[a-z0-9-]+$'
),
add constraint location_path_state_code_format check (
    state_code is null or (level = 'state' and state_code ~ '^[A-Z]{2}$')
);

-- Public labels of the annotation types (manual records). data_annotation.type
-- references this table once the manual records exist (tasks.md 9.11a).
create table public.data_annotation_type (
    type text primary key check (char_length(btrim(type)) > 0),
    label text not null check (char_length(btrim(label)) > 0),
    data_source_values jsonb not null default '{}'::jsonb check (
        jsonb_typeof(data_source_values) = 'object'
    )
);

-- The read shape of an annotation's links: a non-empty JSON array of
-- {"url": site path or null, "label": text}, in display order. A url is a
-- site path that starts and ends with "/", optionally followed by a
-- "#fragment"; null means the linked record has no page of its own.
create function public.data_annotation_links_valid(links jsonb)
returns boolean
language sql
immutable
as $$
    select
        jsonb_typeof(links) = 'array'
        and jsonb_array_length(links) > 0
        and not exists (
            select 1
            from jsonb_array_elements(links) as link (value)
            where not (
                jsonb_typeof(link.value) = 'object'
                and (
                    select array_agg(key order by key)
                    from jsonb_object_keys(link.value) as keys (key)
                ) = array['label', 'url']
                and jsonb_typeof(link.value -> 'label') = 'string'
                and char_length(btrim(link.value ->> 'label')) > 0
                and (
                    jsonb_typeof(link.value -> 'url') = 'null'
                    or (
                        jsonb_typeof(link.value -> 'url') = 'string'
                        and link.value ->> 'url'
                        ~ '^/([a-z0-9-]+/)*(#[a-z0-9-]+)?$'
                    )
                )
            )
        )
$$;

-- The page an annotation shows on, set by intake from the annotation's
-- subject (design.md D11; owner, 2026-11-22): the linked person, else the
-- linked agency, else the record whose page shows it, else the licensing
-- authority only. links holds the human-readable links to the connected
-- records, written by intake from their stored canonical paths and slugs.
-- display_value and display_replacement_value are the plain text the site
-- shows for the reported and replacement values; value and replacement_value
-- stay the audit record. Existing rows get these columns when intake
-- generates its annotations again; the rules that every row has one
-- attachment and links become constraints in a later migration (tasks.md
-- 9.11a), and assert_site_projections() raises meanwhile on an active
-- annotation without them.
alter table public.data_annotation
add column personnel_id text references public.personnel (id),
add column agency_id text references public.agency (id),
add column review_id text references public.reviews (id),
add column civil_case_id text references public.civil_cases (id),
add column location_path_id text references public.location_path (
    location_path_id
),
add column federal_agency_id text references public.federal_agency (id),
add column licensing_authority_id text references public.licensing_authority (
    id
),
add column links jsonb,
add column display_value text,
add column display_replacement_value text,
add constraint data_annotation_links_check check (
    links is null or public.data_annotation_links_valid(links)
),
add constraint data_annotation_display_value_check check (
    display_value is null or char_length(btrim(display_value)) > 0
),
add constraint data_annotation_display_replacement_value_check check (
    display_replacement_value is null
    or char_length(btrim(display_replacement_value)) > 0
),
add constraint data_annotation_one_attachment check (
    num_nonnulls(
        personnel_id,
        agency_id,
        review_id,
        civil_case_id,
        location_path_id,
        federal_agency_id,
        licensing_authority_id
    ) <= 1
);

create index data_annotation_personnel_id_idx on public.data_annotation (
    personnel_id
);
create index data_annotation_agency_id_idx on public.data_annotation (
    agency_id
);
create index data_annotation_licensing_authority_id_idx
on public.data_annotation (licensing_authority_id);
