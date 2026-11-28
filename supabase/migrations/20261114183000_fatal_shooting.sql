-- Source-attributed reports; canonical identities are supplied by intake.
create table public.fatal_shooting_agency (
    id text primary key,
    agency_id text references public.agency (id),
    name text not null check (char_length(btrim(name)) > 0),
    type text,
    state text,
    oricodes text,
    total_shootings integer not null check (total_shootings >= 0),
    source_dataset text not null check (char_length(btrim(source_dataset)) > 0),
    source_record_id text not null check (
        char_length(btrim(source_record_id)) > 0
    ),
    source_url text not null check (char_length(btrim(source_url)) > 0),
    source_commit text not null check (source_commit ~ '^[0-9a-f]{40}$'),
    source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
    retrieved_at timestamptz not null,
    license text not null check (char_length(btrim(license)) > 0),
    redistribution_class text not null check (
        char_length(btrim(redistribution_class)) > 0
    ),
    evidence_status text not null check (evidence_status in ('source_reported'))
);

create index fatal_shooting_agency_agency_idx
on public.fatal_shooting_agency (agency_id);

create table public.fatal_shooting (
    id text primary key,
    date date not null,
    name text,
    age numeric,
    gender text,
    race text,
    race_source text,
    city text,
    county text,
    state text,
    latitude double precision,
    longitude double precision,
    location_precision text,
    body_camera boolean,
    was_mental_illness_related boolean,
    threat_type text,
    armed_with text,
    flee_status text,
    reported_agency_ids text,
    source_dataset text not null check (char_length(btrim(source_dataset)) > 0),
    source_record_id text not null check (
        char_length(btrim(source_record_id)) > 0
    ),
    source_url text not null check (char_length(btrim(source_url)) > 0),
    source_commit text not null check (source_commit ~ '^[0-9a-f]{40}$'),
    source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
    retrieved_at timestamptz not null,
    license text not null check (char_length(btrim(license)) > 0),
    redistribution_class text not null check (
        char_length(btrim(redistribution_class)) > 0
    ),
    evidence_status text not null check (evidence_status in ('source_reported'))
);

create index fatal_shooting_date_idx on public.fatal_shooting (date);
