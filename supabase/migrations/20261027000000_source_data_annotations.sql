-- Findings and original source values remain owned by each imported record.
alter table public.location_path
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.location_path_geometry
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.location_path_alias
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.agency
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.personnel
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.agency_personnel
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.licensing_authority
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.authority_license
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.license_action
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.personnel_education
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.personnel_photo
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.discipline_agency_personnel
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.coverage_links
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.coverage_link_agency_personnel
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.agency_phone_numbers
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.federal_agency
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.civil_cases
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.civil_case_personnel
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.civil_case_links
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.reviews
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.review_personnel
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.review_links
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.arrest_profile
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.agency_arrest_profile
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.license
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

alter table public.discipline
add column data_annotations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(data_annotations) = 'array'
),
add column data_source_values jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data_source_values) = 'object'
);

-- Unrepresentable descriptive dates retain exact literals in source evidence.
alter table public.agency_personnel alter column start_date drop not null;

-- Explicit provider attribution; never inferred from a person or employer.
alter table public.licensing_authority
add column source_namespaces text [] not null default '{}';

alter table public.licensing_authority
add column source_exclusions jsonb not null default '{}'::jsonb check (
    jsonb_typeof(source_exclusions) = 'object'
);
