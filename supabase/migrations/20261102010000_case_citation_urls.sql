-- A full citation is source data, not an inference from the filing date.
alter table public.civil_cases
add column full_citation text,
add column citation_source_url text,
add constraint civil_cases_citation_source_check check (
    (full_citation is null and citation_source_url is null)
    or (
        full_citation is not null and char_length(btrim(full_citation)) > 0
        and citation_source_url is not null
        and citation_source_url ~ '^https?://[^[:space:]]+$'
    )
);

-- Old paths remain owned by the same case.
-- Destinations use the current case slug.
create table public.civil_case_url_alias (
    old_path text primary key,
    civil_case_id text not null references public.civil_cases (id),
    evidence text not null check (char_length(btrim(evidence)) > 0),
    recorded_at timestamptz not null,
    check (old_path ~ '^/civil-(cases|litigation)/[a-z0-9/-]+/$')
);
alter table public.civil_case_url_alias enable row level security;
comment on table public.civil_case_url_alias is
'Historical case URL ownership for build-time redirects.
No public write or API read policy.';
