create table if not exists public.civil_cases (
    id text not null,
    title text not null,
    cause_number text not null,
    court text,
    filed_date date not null,
    summary text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    primary key (id)
);

create unique index if not exists civil_cases_cause_number_key
    on public.civil_cases(cause_number);

create table if not exists public.civil_case_links (
    id text not null,
    civil_case_id text not null references public.civil_cases(id) on delete cascade,
    label text,
    url text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    primary key (id)
);

create unique index if not exists civil_case_links_case_url_key
    on public.civil_case_links(civil_case_id, url);

create table if not exists public.civil_case_agencies (
    civil_case_id text not null references public.civil_cases(id) on delete cascade,
    agency_id text not null references public.agency(id) on delete cascade,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    primary key (civil_case_id, agency_id)
);

create table if not exists public.civil_case_officers (
    civil_case_id text not null references public.civil_cases(id) on delete cascade,
    officer_id text not null references public.officers(id) on delete cascade,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    primary key (civil_case_id, officer_id)
);

create index if not exists civil_case_links_case_id_idx
    on public.civil_case_links(civil_case_id);

create index if not exists civil_case_agencies_agency_id_idx
    on public.civil_case_agencies(agency_id);

create index if not exists civil_case_officers_officer_id_idx
    on public.civil_case_officers(officer_id);

-- Civil cases data is seeded in seed.sql with explicit IDs
