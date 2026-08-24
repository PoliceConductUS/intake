-- Provenance as a structural invariant, canonical agency identity (ORI), and
-- confidence-scored personnel identity resolution.
--
-- Design intent (see openspec/changes/2026-08-24-provenance-structural-invariant):
--
--   1. A displayable value cannot EXIST without provenance.
--      Every claim row carries a NOT NULL FK to a retrieval, and a retrieval
--      cannot exist without a source, a retrieval timestamp, and either a
--      source URL or a records-request identifier.
--
--   2. A displayable value cannot be READ by the render path without its
--      citation travelling with it. The render path connects as
--      `page_renderer`, which holds SELECT on nothing except the
--      `render.*` views. Those views do not expose a bare value column at
--      all -- they expose a single `cited_value` jsonb that contains the
--      value and its citation in the same field. There is no SQL a renderer
--      can write that returns a value without its source.
--
-- Both halves are required. The first alone is a convention (someone selects
-- the value column and drops the citation). The second alone is bypassable
-- (someone reads a base table). Together they make an uncited render
-- structurally unreachable rather than merely discouraged.
--
-- ID policy: per openspec/config.yaml, the database MUST NEVER generate
-- durable IDs. Every primary key below is `text` with no DEFAULT. Intake
-- assigns IDs through its source-key mapping ledger.

begin;

-- ---------------------------------------------------------------------------
-- 1. Enumerations
-- ---------------------------------------------------------------------------

-- Publication lifecycle for anything that can reach a public page.
--   staged      -- ingested, not public. The default. Personnel start here.
--   published   -- publicly renderable.
--   blocked     -- deliberately withheld (legal hold, takedown, gate not cleared).
--   quarantined -- withheld because we do not trust it (source conflict, suspected error).
-- blocked and quarantined are distinct on purpose: one is a policy decision,
-- the other is a data-quality decision, and they are escalated to different people.
create type public.publication_status as enum (
    'staged',
    'published',
    'blocked',
    'quarantined'
);

-- How we obtained a source. Drives terms review and the "do not scrape what
-- prohibits it" boundary -- an access basis of 'scrape' does not exist here by
-- design; if a source is only reachable by scraping it does not get a row.
create type public.source_access_basis as enum (
    'public_api',
    'public_bulk_download',
    'records_request',
    'published_document',
    'agency_published_dataset',
    'user_submission'
);

-- Terms posture. Nothing may be ingested from a source that is not 'cleared'.
create type public.source_terms_status as enum (
    'unreviewed',
    'under_review',
    'cleared',
    'prohibited'
);

-- What kind of assertion a claim's confidence describes.
create type public.confidence_basis as enum (
    'source_asserted',   -- the source states this field directly
    'source_derived',    -- computed from source fields without external input
    'record_matched',    -- attached to this subject by a matching process
    'human_reviewed'     -- a person looked at it and affirmed it
);

-- Whether an entity appears in a given registry. 'absent' is a positive
-- finding, not a null: the FBI registry is a UCR-PARTICIPATION registry, not
-- the NCIC ORI universe. Puerto Rico returns 1 agency. "Not in the registry"
-- must never be read as "does not exist", and must never silently become the
-- denominator of a coverage number.
create type public.registry_presence as enum (
    'present',
    'absent',
    'not_applicable',
    'unknown'
);

-- ---------------------------------------------------------------------------
-- 2. Provenance spine
-- ---------------------------------------------------------------------------

create table public.source (
    source_id text primary key,
    slug text not null unique,
    name text not null,
    publisher text not null,
    access_basis public.source_access_basis not null,
    terms_status public.source_terms_status not null default 'unreviewed',
    terms_url text,
    terms_reviewed_at timestamp with time zone,
    terms_reviewed_by text,
    notes text,
    created_at timestamp with time zone not null default timezone('utc'::text, now()),
    updated_at timestamp with time zone not null default timezone('utc'::text, now()),

    -- A cleared source must record who cleared it and when. Prevents
    -- 'cleared' from being set as a convenience default.
    constraint source_cleared_requires_review check (
        terms_status <> 'cleared'
        or (terms_reviewed_at is not null and terms_reviewed_by is not null)
    )
);

comment on table public.source is
'A dataset or records channel we are permitted to ingest from. INS-14 owns terms_status; a source that is not cleared cannot back a published claim.';

-- One row per pull. Re-running a loader produces a NEW retrieval, never an
-- update -- that is what makes "re-pull and diff" possible and what makes a
-- retrieval date meaningful.
create table public.source_retrieval (
    retrieval_id text primary key,
    source_id text not null references public.source (source_id) on delete restrict,
    retrieved_at timestamp with time zone not null,
    source_url text,
    records_request_id text,
    request_detail text,
    content_hash text not null,
    artifact_uri text,
    created_at timestamp with time zone not null default timezone('utc'::text, now()),

    -- The instruction is "source URL OR records-request identifier". This is
    -- that requirement expressed as a constraint rather than a code review.
    constraint source_retrieval_locator_required check (
        source_url is not null or records_request_id is not null
    ),
    constraint source_retrieval_not_future check (
        retrieved_at <= timezone('utc'::text, now()) + interval '1 hour'
    )
);

comment on table public.source_retrieval is
'One immutable row per pull of a source. Never updated in place; a re-pull is a new row. Supplies the retrieval date and the URL/records-request locator half of every citation.';

create index source_retrieval_source_idx
on public.source_retrieval (source_id, retrieved_at desc);

-- Retrievals are append-only. A mutable retrieval date is a falsifiable
-- citation.
create or replace function public.reject_source_retrieval_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception
        'source_retrieval is append-only: attempted % on retrieval_id=%',
        tg_op, coalesce(old.retrieval_id, new.retrieval_id)
        using errcode = 'restrict_violation';
end;
$$;

create trigger source_retrieval_append_only
before update or delete on public.source_retrieval
for each row execute function public.reject_source_retrieval_mutation();

-- ---------------------------------------------------------------------------
-- 3. Claim -- the only place a displayable value may live
-- ---------------------------------------------------------------------------

-- Predicates are registered, not free text. An unregistered predicate cannot
-- be written, so a new displayable field cannot appear on a page without
-- someone declaring its datatype and whether it is publishable at all.
create table public.claim_predicate (
    predicate text primary key,
    subject_type text not null,
    datatype text not null check (datatype in ('text', 'number', 'date', 'boolean')),
    description text not null,
    -- Some fields are ingested for internal use and must never render even
    -- when cited. `agency_type_name` is the live example: it is internally
    -- inconsistent across states (FBI returns 148 'State Police' agencies for
    -- California, 1 for Texas), so it may drive grouping but must not be the
    -- subtitle on a public page until a second source corroborates it.
    renderable boolean not null default true,
    -- Corroboration gate: how many INDEPENDENT sources must assert this
    -- predicate before any claim on it may be published.
    min_independent_sources integer not null default 1
        check (min_independent_sources >= 1),
    created_at timestamp with time zone not null default timezone('utc'::text, now())
);

comment on table public.claim_predicate is
'Registry of displayable fields. Adding a field to a public page requires adding a row here, which is a reviewable schema change rather than a template edit.';

create table public.claim (
    claim_id text primary key,

    subject_type text not null,
    subject_id text not null,
    predicate text not null references public.claim_predicate (predicate) on delete restrict,

    -- Exactly one typed value column is populated, matching the predicate's
    -- declared datatype -- or value_absent is true.
    value_text text,
    value_number numeric,
    value_date date,
    value_boolean boolean,

    -- A source affirmatively telling us it does not know. This is NOT the same
    -- as us not having asked. 39% of Texas federal-registry rows (686/1,754)
    -- and 27% of California rows (237/867) have null lat/lon. That null is a
    -- fact about the source and it renders as "not recorded by <source>",
    -- with a citation, and is never silently backfilled.
    value_absent boolean not null default false,

    -- The invariant. A claim cannot be inserted without a retrieval, and a
    -- retrieval cannot exist without a source, a date, and a locator.
    retrieval_id text not null references public.source_retrieval (retrieval_id) on delete restrict,

    -- Source-local identity for this record, so a claim can be traced back to
    -- the exact row in the exact snapshot it came from.
    source_record_key text not null,

    confidence numeric not null check (confidence > 0 and confidence <= 1),
    confidence_basis public.confidence_basis not null,

    publication_status public.publication_status not null default 'staged',

    -- Corrections supersede; they do not overwrite. The prior claim and its
    -- citation stay readable for audit.
    superseded_by_claim_id text references public.claim (claim_id) on delete restrict,

    created_at timestamp with time zone not null default timezone('utc'::text, now()),
    updated_at timestamp with time zone not null default timezone('utc'::text, now()),

    constraint claim_exactly_one_value check (
        case when value_absent then
            (value_text is null and value_number is null
             and value_date is null and value_boolean is null)
        else
            (num_nonnulls(value_text, value_number, value_date, value_boolean) = 1)
        end
    ),
    constraint claim_not_self_superseding check (
        superseded_by_claim_id is null or superseded_by_claim_id <> claim_id
    )
);

comment on table public.claim is
'Every value that can appear on a public page. retrieval_id is NOT NULL: an uncited claim cannot be represented in this schema.';

create index claim_subject_idx
on public.claim (subject_type, subject_id, predicate);

create index claim_live_subject_idx
on public.claim (subject_type, subject_id)
where superseded_by_claim_id is null and publication_status = 'published';

create index claim_retrieval_idx on public.claim (retrieval_id);
create index claim_predicate_idx on public.claim (predicate);

-- The typed value column must match the predicate's declared datatype.
-- Cross-row check, so it is a trigger rather than a CHECK constraint.
create or replace function public.enforce_claim_datatype()
returns trigger
language plpgsql
as $$
declare
    declared_datatype text;
    declared_subject_type text;
begin
    select datatype, subject_type
    into declared_datatype, declared_subject_type
    from public.claim_predicate
    where predicate = new.predicate;

    if declared_subject_type <> new.subject_type then
        raise exception
            'predicate % is declared for subject_type %, not %',
            new.predicate, declared_subject_type, new.subject_type
            using errcode = 'check_violation';
    end if;

    if new.value_absent then
        return new;
    end if;

    if (declared_datatype = 'text' and new.value_text is null)
        or (declared_datatype = 'number' and new.value_number is null)
        or (declared_datatype = 'date' and new.value_date is null)
        or (declared_datatype = 'boolean' and new.value_boolean is null)
    then
        raise exception
            'predicate % is declared as % and requires value_%',
            new.predicate, declared_datatype, declared_datatype
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

create trigger claim_datatype_check
before insert or update on public.claim
for each row execute function public.enforce_claim_datatype();

-- A claim may not be published if its predicate is not renderable, if its
-- source is not terms-cleared, or if it has not met its corroboration
-- threshold. Publication is refused rather than silently downgraded.
create or replace function public.enforce_claim_publishable()
returns trigger
language plpgsql
as $$
declare
    is_renderable boolean;
    required_sources integer;
    distinct_sources integer;
    terms public.source_terms_status;
begin
    if new.publication_status <> 'published' then
        return new;
    end if;

    select cp.renderable, cp.min_independent_sources
    into is_renderable, required_sources
    from public.claim_predicate cp
    where cp.predicate = new.predicate;

    if not is_renderable then
        raise exception
            'predicate % is not renderable and cannot be published',
            new.predicate
            using errcode = 'check_violation';
    end if;

    select s.terms_status into terms
    from public.source_retrieval r
    join public.source s on s.source_id = r.source_id
    where r.retrieval_id = new.retrieval_id;

    if terms <> 'cleared' then
        raise exception
            'claim %: backing source has terms_status=% and cannot be published',
            new.claim_id, terms
            using errcode = 'check_violation';
    end if;

    if required_sources > 1 then
        select count(distinct r.source_id) into distinct_sources
        from public.claim c
        join public.source_retrieval r on r.retrieval_id = c.retrieval_id
        where c.subject_type = new.subject_type
          and c.subject_id = new.subject_id
          and c.predicate = new.predicate
          and c.superseded_by_claim_id is null
          and (c.claim_id <> new.claim_id);

        -- include this claim's own source
        select distinct_sources + 1 into distinct_sources
        where not exists (
            select 1
            from public.claim c
            join public.source_retrieval r on r.retrieval_id = c.retrieval_id
            join public.source_retrieval nr on nr.retrieval_id = new.retrieval_id
            where c.claim_id <> new.claim_id
              and c.subject_type = new.subject_type
              and c.subject_id = new.subject_id
              and c.predicate = new.predicate
              and c.superseded_by_claim_id is null
              and r.source_id = nr.source_id
        );

        if coalesce(distinct_sources, 1) < required_sources then
            raise exception
                'predicate % requires % independent sources; % present',
                new.predicate, required_sources, coalesce(distinct_sources, 1)
                using errcode = 'check_violation';
        end if;
    end if;

    return new;
end;
$$;

create trigger claim_publishable_check
before insert or update on public.claim
for each row execute function public.enforce_claim_publishable();

-- ---------------------------------------------------------------------------
-- 4. Publication audit trail and subject-level suppression
-- ---------------------------------------------------------------------------

-- Whole-subject suppression: a takedown, a legal hold, or the personnel
-- publication gate. Overrides claim-level status. Built before we need it.
create table public.subject_suppression (
    suppression_id text primary key,
    subject_type text not null,
    subject_id text not null,
    reason_code text not null check (reason_code in (
        'personnel_publication_gate',
        'takedown_request',
        'legal_hold',
        'data_subject_request',
        'accuracy_dispute',
        'source_withdrawn',
        'sealed_or_expunged_suspected'
    )),
    reason_note text,
    requested_by text,
    applied_by text not null,
    applied_at timestamp with time zone not null default timezone('utc'::text, now()),
    lifted_by text,
    lifted_at timestamp with time zone,
    lift_note text,

    constraint subject_suppression_lift_complete check (
        (lifted_at is null and lifted_by is null)
        or (lifted_at is not null and lifted_by is not null)
    )
);

comment on table public.subject_suppression is
'Fast, auditable suppression of an entire subject. An active row removes the subject from every render view regardless of claim status.';

create unique index subject_suppression_active_idx
on public.subject_suppression (subject_type, subject_id)
where lifted_at is null;

create table public.publication_event (
    event_id text primary key,
    subject_type text not null,
    subject_id text not null,
    claim_id text references public.claim (claim_id) on delete set null,
    from_status public.publication_status,
    to_status public.publication_status not null,
    reason_code text,
    reason_note text,
    actor text not null,
    occurred_at timestamp with time zone not null default timezone('utc'::text, now())
);

comment on table public.publication_event is
'Append-only audit trail of every publication-status transition. Written by trigger, so a status change cannot happen without a recorded event.';

create index publication_event_subject_idx
on public.publication_event (subject_type, subject_id, occurred_at desc);

create index publication_event_claim_idx
on public.publication_event (claim_id, occurred_at desc);

-- Every status transition writes an event. Not optional, not a code path.
-- The actor comes from a session GUC so the audit trail names a human or a
-- named automated process rather than a database role.
create or replace function public.record_publication_event()
returns trigger
language plpgsql
as $$
declare
    acting text;
begin
    if tg_op = 'UPDATE'
        and old.publication_status is not distinct from new.publication_status
    then
        return new;
    end if;

    acting := coalesce(
        nullif(current_setting('intake.actor', true), ''),
        'unattributed:' || session_user
    );

    insert into public.publication_event (
        event_id, subject_type, subject_id, claim_id,
        from_status, to_status, reason_code, reason_note, actor
    )
    values (
        'pev_' || encode(gen_random_bytes(12), 'hex'),
        new.subject_type,
        new.subject_id,
        new.claim_id,
        case when tg_op = 'UPDATE' then old.publication_status else null end,
        new.publication_status,
        nullif(current_setting('intake.reason_code', true), ''),
        nullif(current_setting('intake.reason_note', true), ''),
        acting
    );

    return new;
end;
$$;

comment on function public.record_publication_event() is
'Audit events use a generated non-durable event_id; publication_event is an append-only log, not a durable entity, so the intake ID policy does not apply.';

create trigger claim_publication_audit
after insert or update of publication_status on public.claim
for each row execute function public.record_publication_event();

create or replace function public.reject_publication_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'publication_event is append-only: attempted %', tg_op
        using errcode = 'restrict_violation';
end;
$$;

create trigger publication_event_append_only
before update or delete on public.publication_event
for each row execute function public.reject_publication_event_mutation();

-- ---------------------------------------------------------------------------
-- 5. Canonical agency identity -- ORI, and the entity layer above it
-- ---------------------------------------------------------------------------

-- The department a member of the public would name: "California Highway
-- Patrol". The FBI registry returns 148 rows typed 'State Police' for
-- California, each holding its own ORI, because ORI is a REPORTING-UNIT key,
-- not a department key. Without this layer CHP renders as 148 separate police
-- departments. Agency-side entity resolution is therefore a first-class
-- problem, not just a personnel-side one.
create table public.agency_entity (
    agency_entity_id text primary key,
    state text not null,
    canonical_name text not null,
    entity_kind text not null check (entity_kind in (
        'municipal_police', 'county_sheriff', 'state_police', 'state_agency',
        'federal_agency', 'tribal', 'university_campus', 'school_district',
        'transit', 'airport', 'special_jurisdiction', 'corrections',
        'prosecutor', 'other', 'unclassified'
    )),
    created_at timestamp with time zone not null default timezone('utc'::text, now()),
    updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

comment on table public.agency_entity is
'The department-level entity above the ORI reporting unit. One CHP, not 148. canonical_name and entity_kind are internal grouping keys; the public-facing name is a claim.';

-- An agency (reporting unit) belongs to at most one entity. Membership is
-- itself evidence-backed and confidence-scored.
create table public.agency_entity_member (
    membership_id text primary key,
    agency_entity_id text not null references public.agency_entity (agency_entity_id) on delete restrict,
    agency_id text not null references public.agency (id) on delete cascade,
    confidence numeric not null check (confidence > 0 and confidence <= 1),
    method text not null check (method in (
        'shared_ori_prefix', 'name_pattern', 'source_asserted', 'manual_review'
    )),
    evidence jsonb not null,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone not null default timezone('utc'::text, now()),

    constraint agency_entity_member_unique unique (agency_id)
);

create index agency_entity_member_entity_idx
on public.agency_entity_member (agency_entity_id);

-- ORI assignment. The FORM is recorded explicitly, because federal datasets
-- mix 7-character and 9-character ORIs and an unlabeled `ori` column silently
-- fails to join across them. A silent join failure here means a page about
-- the wrong department.
create table public.agency_ori (
    agency_ori_id text primary key,
    agency_id text not null references public.agency (id) on delete cascade,
    ori text not null,
    ori_form text not null check (ori_form in ('ori7', 'ori9')),

    -- Derived 7-character bridge key for cross-form joins. Generated, so it
    -- cannot drift from `ori`, and explicitly derived so nobody mistakes it
    -- for a source-asserted identifier.
    ori7 text generated always as (upper(substring(ori from 1 for 7))) stored,

    is_primary boolean not null default false,
    retrieval_id text not null references public.source_retrieval (retrieval_id) on delete restrict,
    confidence numeric not null check (confidence > 0 and confidence <= 1),
    created_at timestamp with time zone not null default timezone('utc'::text, now()),

    constraint agency_ori_form_length check (
        (ori_form = 'ori7' and length(ori) = 7)
        or (ori_form = 'ori9' and length(ori) = 9)
    ),
    constraint agency_ori_shape check (ori ~ '^[A-Z]{2}[A-Z0-9]{5,7}$'),
    constraint agency_ori_unique unique (agency_id, ori, ori_form)
);

comment on column public.agency_ori.ori7 is
'Derived 7-character bridge key. Two ORIs sharing an ori7 are candidates for the same reporting unit across dataset generations -- a candidate, never an automatic merge.';

create unique index agency_ori_one_primary_idx
on public.agency_ori (agency_id)
where is_primary;

create index agency_ori_ori7_idx on public.agency_ori (ori7);
create index agency_ori_lookup_idx on public.agency_ori (ori);

-- Reviewed conflict queue. Nothing auto-resolves.
create table public.ori_conflict (
    conflict_id text primary key,
    ori7 text not null,
    conflict_type text not null check (conflict_type in (
        'same_ori_multiple_agencies',
        'same_ori7_different_forms',
        'agency_multiple_primary_candidates',
        'registry_name_mismatch',
        'absent_from_registry'
    )),
    detected_at timestamp with time zone not null default timezone('utc'::text, now()),
    status text not null default 'open' check (status in ('open', 'resolved', 'wont_fix')),
    evidence jsonb not null,
    resolution_note text,
    resolved_by text,
    resolved_at timestamp with time zone,

    constraint ori_conflict_resolution_complete check (
        status = 'open'
        or (resolved_by is not null and resolved_at is not null and resolution_note is not null)
    )
);

comment on table public.ori_conflict is
'Reviewed conflict queue for ORI inconsistencies. Populated by trigger on detection. An open conflict suppresses the affected agencies from render -- accuracy over coverage.';

create unique index ori_conflict_open_idx
on public.ori_conflict (ori7, conflict_type)
where status = 'open';

-- Detect ORI collisions on write and open a conflict rather than resolving
-- them. Two different agencies claiming the same ORI means at least one page
-- is about the wrong department.
create or replace function public.detect_ori_conflict()
returns trigger
language plpgsql
as $$
declare
    colliding_agencies integer;
    form_variants integer;
begin
    select count(distinct agency_id) into colliding_agencies
    from public.agency_ori
    where ori7 = upper(substring(new.ori from 1 for 7));

    if colliding_agencies > 1 then
        insert into public.ori_conflict (conflict_id, ori7, conflict_type, evidence)
        values (
            'oric_' || encode(gen_random_bytes(12), 'hex'),
            upper(substring(new.ori from 1 for 7)),
            'same_ori_multiple_agencies',
            jsonb_build_object(
                'agency_ids', (
                    select jsonb_agg(distinct agency_id)
                    from public.agency_ori
                    where ori7 = upper(substring(new.ori from 1 for 7))
                ),
                'triggering_agency_ori_id', new.agency_ori_id
            )
        )
        on conflict do nothing;
    end if;

    select count(distinct ori_form) into form_variants
    from public.agency_ori
    where ori7 = upper(substring(new.ori from 1 for 7));

    if form_variants > 1 then
        insert into public.ori_conflict (conflict_id, ori7, conflict_type, evidence)
        values (
            'oric_' || encode(gen_random_bytes(12), 'hex'),
            upper(substring(new.ori from 1 for 7)),
            'same_ori7_different_forms',
            jsonb_build_object('triggering_agency_ori_id', new.agency_ori_id)
        )
        on conflict do nothing;
    end if;

    return new;
end;
$$;

-- The `on conflict do nothing` above is deduplication of an open queue entry,
-- not suppression of bad data: the conflict row already exists and is open.
create trigger agency_ori_conflict_detect
after insert on public.agency_ori
for each row execute function public.detect_ori_conflict();

-- "Absent from the registry" is a recorded finding, not a missing row.
create table public.agency_registry_presence (
    presence_id text primary key,
    agency_id text not null references public.agency (id) on delete cascade,
    source_id text not null references public.source (source_id) on delete restrict,
    presence public.registry_presence not null,
    retrieval_id text not null references public.source_retrieval (retrieval_id) on delete restrict,
    note text,
    created_at timestamp with time zone not null default timezone('utc'::text, now()),

    constraint agency_registry_presence_unique unique (agency_id, source_id, retrieval_id)
);

comment on table public.agency_registry_presence is
'Explicit presence/absence of an agency in a given registry as of a given retrieval. INS-7 coverage denominators must be computed from this, never from a registry row count.';

-- ---------------------------------------------------------------------------
-- 6. Personnel identity -- confidence-scored links, never hard merges
-- ---------------------------------------------------------------------------

-- A person row is an identity HYPOTHESIS with no attributes. Names are claims.
-- This is deliberate: it means there is no `person.first_name` column that
-- could ever be rendered without a citation.
create table public.person (
    person_id text primary key,
    -- Link back to the legacy officers row during migration, so the existing
    -- corpus can be attached without being rewritten.
    legacy_officer_id text references public.officers (id) on delete set null,
    created_at timestamp with time zone not null default timezone('utc'::text, now()),
    updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

comment on table public.person is
'An identity hypothesis. Intentionally attribute-free: every displayable fact about a person is a claim, so there is no column here that could render uncited.';

create unique index person_legacy_officer_idx
on public.person (legacy_officer_id)
where legacy_officer_id is not null;

-- Name variants. The same human appears under different names across sources
-- and across a career. Every variant keeps its own citation.
create table public.person_name_variant (
    name_variant_id text primary key,
    person_id text not null references public.person (person_id) on delete cascade,
    full_name text not null,
    first_name text,
    middle_name text,
    last_name text,
    suffix text,
    -- Blocking key for candidate generation. Derived, never displayed.
    normalized_key text not null,
    retrieval_id text not null references public.source_retrieval (retrieval_id) on delete restrict,
    source_record_key text not null,
    confidence numeric not null check (confidence > 0 and confidence <= 1),
    created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index person_name_variant_person_idx
on public.person_name_variant (person_id);

create index person_name_variant_blocking_idx
on public.person_name_variant (normalized_key);

-- Employment interval. Its EXISTENCE is a displayable assertion, so it carries
-- a retrieval. Its attributes (rank, badge number, dates) are claims on
-- subject_type='employment'.
create table public.employment_period (
    employment_id text primary key,
    person_id text not null references public.person (person_id) on delete cascade,
    agency_id text not null references public.agency (id) on delete restrict,
    retrieval_id text not null references public.source_retrieval (retrieval_id) on delete restrict,
    source_record_key text not null,
    confidence numeric not null check (confidence > 0 and confidence <= 1),
    publication_status public.publication_status not null default 'staged',
    created_at timestamp with time zone not null default timezone('utc'::text, now()),
    updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

comment on table public.employment_period is
'Person-at-agency assertion. Dates, rank and badge number are claims on subject_type=''employment'', not columns here.';

create index employment_period_person_idx on public.employment_period (person_id);
create index employment_period_agency_idx on public.employment_period (agency_id);

-- Identity resolution. Two person rows are LINKED, never merged. A link is
-- reversible; a merge is not, and an incorrect merge attributes one officer's
-- misconduct to a different human being.
create table public.person_identity_link (
    link_id text primary key,
    person_id_a text not null references public.person (person_id) on delete cascade,
    person_id_b text not null references public.person (person_id) on delete cascade,

    -- 'distinct_person' is as valuable as 'same_person': it records a reviewed
    -- negative so the same false candidate is not re-proposed every run.
    assertion text not null check (assertion in ('same_person', 'possible_same_person', 'distinct_person')),
    confidence numeric not null check (confidence > 0 and confidence <= 1),
    method text not null check (method in (
        'state_certification_number',
        'exact_name_and_dob',
        'name_and_agency_overlap',
        'name_and_badge_overlap',
        'probabilistic_score',
        'manual_review'
    )),
    evidence jsonb not null,
    status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected')),
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone not null default timezone('utc'::text, now()),

    -- Canonical ordering makes the pair unique in one direction only.
    constraint person_identity_link_ordered check (person_id_a < person_id_b),
    constraint person_identity_link_unique unique (person_id_a, person_id_b, method),
    constraint person_identity_link_review_complete check (
        status = 'proposed'
        or (reviewed_by is not null and reviewed_at is not null)
    ),
    -- Automated methods may not self-accept a same_person link. Merging two
    -- officer careers is a human-reviewed decision.
    constraint person_identity_link_same_person_needs_review check (
        not (assertion = 'same_person' and status = 'accepted' and method <> 'manual_review'
             and method <> 'state_certification_number')
    )
);

comment on table public.person_identity_link is
'Confidence-scored identity assertions between person rows. Never a merge: no row is rewritten, and any link can be reversed without data loss.';

create index person_identity_link_a_idx on public.person_identity_link (person_id_a, status);
create index person_identity_link_b_idx on public.person_identity_link (person_id_b, status);

-- ---------------------------------------------------------------------------
-- 7. The render surface
-- ---------------------------------------------------------------------------

create schema render;

comment on schema render is
'The only schema the page-build role may read. Every column that carries a value carries its citation in the same column.';

-- Assemble value + citation into one indivisible jsonb. A renderer cannot
-- select the value and drop the source, because they are the same column.
create or replace function render.cite(
    p_value jsonb,
    p_absent boolean,
    p_source_slug text,
    p_source_name text,
    p_publisher text,
    p_retrieved_at timestamp with time zone,
    p_source_url text,
    p_records_request_id text,
    p_confidence numeric,
    p_confidence_basis text
)
returns jsonb
language sql
immutable
as $$
    select jsonb_build_object(
        'value', case when p_absent then null else p_value end,
        'absent', p_absent,
        'citation', jsonb_build_object(
            'source', p_source_slug,
            'sourceName', p_source_name,
            'publisher', p_publisher,
            'retrievedAt', p_retrieved_at,
            'locator', coalesce(p_source_url, 'records-request:' || p_records_request_id),
            'locatorType', case when p_source_url is not null then 'url' else 'records_request' end,
            'confidence', p_confidence,
            'confidenceBasis', p_confidence_basis
        )
    );
$$;

-- The single published-claim view. Note what is NOT here: value_text,
-- value_number, value_date, value_boolean. There is no bare value column to
-- select.
create view render.published_claim as
select
    c.subject_type,
    c.subject_id,
    c.predicate,
    render.cite(
        case
            when c.value_text is not null then to_jsonb(c.value_text)
            when c.value_number is not null then to_jsonb(c.value_number)
            when c.value_date is not null then to_jsonb(c.value_date)
            when c.value_boolean is not null then to_jsonb(c.value_boolean)
            else null
        end,
        c.value_absent,
        s.slug, s.name, s.publisher,
        r.retrieved_at, r.source_url, r.records_request_id,
        c.confidence, c.confidence_basis::text
    ) as cited_value
from public.claim c
    inner join public.source_retrieval r on r.retrieval_id = c.retrieval_id
    inner join public.source s on s.source_id = r.source_id
    inner join public.claim_predicate cp on cp.predicate = c.predicate
where c.publication_status = 'published'
    and c.superseded_by_claim_id is null
    and cp.renderable
    and s.terms_status = 'cleared'
    and not exists (
        select 1 from public.subject_suppression sup
        where sup.subject_type = c.subject_type
            and sup.subject_id = c.subject_id
            and sup.lifted_at is null
    );

comment on view render.published_claim is
'The entire public read surface for field values. INNER JOINs to retrieval and source make an uncited row unrepresentable in the result set.';

-- Agency identity for URL construction. ORI is an identifier, not a claim
-- about a person, but it is still suppressed while an ORI conflict is open --
-- an unresolved ORI collision means we may be about to publish a page about
-- the wrong department.
create view render.published_agency as
select
    a.id as agency_id,
    aem.agency_entity_id,
    ao.ori,
    ao.ori_form
from public.agency a
    inner join public.agency_ori ao on ao.agency_id = a.id and ao.is_primary
    left join public.agency_entity_member aem on aem.agency_id = a.id
where not exists (
    select 1 from public.subject_suppression sup
    where sup.subject_type = 'agency' and sup.subject_id = a.id and sup.lifted_at is null
)
and not exists (
    select 1 from public.ori_conflict oc
    where oc.ori7 = ao.ori7 and oc.status = 'open'
);

-- Personnel render surface. Gated at the schema level, not the template level:
-- until the Data Integrity & Publication Risk Reviewer clears the gate, this
-- view is defined to return zero rows and the page_renderer role is not
-- granted SELECT on it at all.
--
-- Two independent locks. Removing one does not open the gate.
create view render.published_person as
select
    p.person_id,
    e.employment_id,
    e.agency_id
from public.person p
    inner join public.employment_period e on e.person_id = p.person_id
where e.publication_status = 'published'
    and not exists (
        select 1 from public.subject_suppression sup
        where sup.subject_type = 'person' and sup.subject_id = p.person_id and sup.lifted_at is null
    )
    -- Lock 1: hard gate. Removing this line is a visible, reviewable schema
    -- migration, not a config flag someone can flip.
    and false;

comment on view render.published_person is
'PERSONNEL PUBLICATION GATE. Hard-coded to return zero rows AND not granted to page_renderer. Opening it requires a migration plus a grant, both reviewable, and requires Data Integrity & Publication Risk Reviewer clearance per INS-11.';

-- ---------------------------------------------------------------------------
-- 8. Least-privilege render role
-- ---------------------------------------------------------------------------

-- The page build connects as this role. It has SELECT on the render views and
-- on nothing else -- so "read a base table and skip the citation" is not a
-- discipline problem, it is a permission denied.
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'page_renderer') then
        create role page_renderer nologin;
    end if;
end;
$$;

revoke all on schema public from page_renderer;
revoke all on all tables in schema public from page_renderer;
revoke all on all sequences in schema public from page_renderer;
revoke all on all functions in schema public from page_renderer;

grant usage on schema render to page_renderer;

-- The allowlist. Deliberately not `grant select on all tables in schema
-- render` -- each grant is an explicit, greppable, reviewable line, and
-- render.published_person is conspicuously absent.
grant select on render.published_claim to page_renderer;
grant select on render.published_agency to page_renderer;

-- The views are owned by the migration role and read base tables through
-- their owner's rights, so page_renderer never needs USAGE on public.
alter view render.published_claim set (security_invoker = off);
alter view render.published_agency set (security_invoker = off);
alter view render.published_person set (security_invoker = off);

-- Future objects in `render` are NOT granted automatically. A new render view
-- is unreadable until someone writes an explicit grant.
alter default privileges in schema render revoke all on tables from page_renderer;

-- ---------------------------------------------------------------------------
-- 9. Self-check the invariant holds
-- ---------------------------------------------------------------------------

-- Callable in CI and after every migration. Returns violations; empty result
-- means the invariant is intact. This is what stops a later migration from
-- quietly granting the renderer access to a base table.
create or replace function public.assert_provenance_invariant()
returns table (violation text, detail text)
language sql
stable
as $$
    -- 1. page_renderer must hold no privilege on any table outside `render`.
    select
        'renderer_reads_base_table'::text,
        (table_schema || '.' || table_name || ' [' || privilege_type || ']')::text
    from information_schema.table_privileges
    where grantee = 'page_renderer'
        and table_schema <> 'render'

    union all

    -- 2. page_renderer must hold no privilege on a render object outside the
    --    reviewed allowlist. Catches a future `grant select on all tables`.
    select
        'renderer_grant_outside_allowlist'::text,
        (table_name || ' [' || privilege_type || ']')::text
    from information_schema.table_privileges
    where grantee = 'page_renderer'
        and table_schema = 'render'
        and table_name not in ('published_claim', 'published_agency')

    union all

    -- 3. The personnel gate must remain closed.
    select
        'personnel_gate_open'::text,
        'page_renderer holds ' || privilege_type || ' on render.published_person'
    from information_schema.table_privileges
    where grantee = 'page_renderer'
        and table_schema = 'render'
        and table_name = 'published_person'

    union all

    -- 4. No render view may expose a bare value column.
    select
        'render_view_exposes_bare_value'::text,
        (table_name || '.' || column_name)::text
    from information_schema.columns
    where table_schema = 'render'
        and column_name in ('value_text', 'value_number', 'value_date', 'value_boolean');
$$;

comment on function public.assert_provenance_invariant() is
'Returns zero rows when the provenance invariant is intact. Run in CI after migrations; a non-empty result fails the build.';

commit;
