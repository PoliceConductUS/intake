-- Corrections and takedown mechanics with an audit trail (INS-9).
--
-- Builds on 20260824170000_provenance_structural_invariant.sql, which already
-- established `subject_suppression` (an active row removes a subject from every
-- render view) and `publication_event` (append-only status audit). Those give
-- us suppression STATE. They do not give us:
--
--   1. An intake path. Correction requests and takedown demands arrive as
--      email, forms, and attorney letters and currently land nowhere durable.
--
--   2. Durability against the ingestion pipeline. Today the loader connects
--      with full rights on `public`. Nothing stops a re-import from updating
--      `lifted_at` or deleting the suppression row outright. "Honored Tuesday,
--      undone by Wednesday's re-import" is currently reachable.
--
--   3. Durability against IDENTITY CHURN, which is the subtler half. Intake
--      maps source record keys to canonical cuid2 IDs through an on-disk YAML
--      ledger (src/cli/state/source-name-to-canonical-id). `subject_suppression`
--      is keyed on the canonical ID. If that ledger is regenerated, lost, or
--      diverges, a re-import assigns a NEW canonical ID to the SAME upstream
--      record. The suppression row survives, still points at the old ID, and
--      protects nothing. The record comes back under a new ID and every
--      suppression check passes.
--
--      This is why suppression is captured at the SOURCE KEY level here, not
--      only the canonical-ID level. A suppression records which upstream rows
--      produced the subject, so re-identification does not launder it.
--
--   4. A public corrections log.
--
-- Boundary (INS-9): this migration builds the mechanism. It does not decide
-- what gets taken down. Legal demands are structurally forbidden from being
-- resolved here -- see `enforce_legal_demand_routing` below.
--
-- ID policy: per openspec/config.yaml the database MUST NEVER generate durable
-- IDs. `correction_request` and `subject_suppression` IDs are assigned by the
-- caller. `publication_event` rows are an append-only log, not durable
-- entities, and keep the generated-ID exemption established in the provenance
-- migration.

begin;

-- ---------------------------------------------------------------------------
-- 1. Intake: correction requests and takedown demands
-- ---------------------------------------------------------------------------

-- What arrived. Kept distinct because the routing rules differ, not for
-- reporting convenience: `legal_demand` is barred from being resolved by
-- anyone but the Executive Director, and `sealed_or_expunged` is barred from
-- being declined at all.
create type public.correction_request_kind as enum (
    'correction',            -- "this fact is wrong" -- from anyone
    'removal_request',       -- "take this down" -- from a member of the public
    'legal_demand',          -- attorney letter, cease and desist, court order
    'data_subject_request',  -- statutory access/erasure request
    'source_withdrawal',     -- the publisher retracted or corrected the source
    'sealed_or_expunged',    -- record may be sealed or expunged
    'internal_finding'       -- we found the error ourselves
);

-- How it reached us. Recorded because a demand served by a process server and
-- a note typed into a web form carry different obligations, and because we
-- must be able to show the intake channel if the handling is ever questioned.
create type public.correction_request_channel as enum (
    'web_form',
    'email',
    'postal_mail',
    'phone',
    'legal_service',
    'source_publisher',
    'internal'
);

create type public.correction_request_disposition as enum (
    'received',      -- logged, untouched. The only state intake may write.
    'escalated',     -- routed to the Executive Director. Terminal for engineering.
    'action_taken',  -- a suppression or correction was applied under a named decision
    'declined',      -- a named decider chose not to act
    'withdrawn'      -- the requester withdrew it
);

create table public.correction_request (
    request_id text primary key,

    received_at timestamp with time zone not null default timezone('utc'::text, now()),
    channel public.correction_request_channel not null,
    request_kind public.correction_request_kind not null,

    -- The requester's own words, unedited. Immutable after insert (trigger
    -- below). If we ever have to show what was actually asked of us, a
    -- paraphrase is worthless.
    request_text text not null,

    -- Requester identity. Personal data: never reaches a render view, and the
    -- corrections-log view is asserted not to expose it.
    requester_name text,
    requester_contact text,
    requester_role text,

    -- What the requester says it is about. Nullable on purpose -- a requester
    -- will often send a URL or a name, not a canonical ID, and forcing a
    -- resolution at intake time invites a wrong guess about which human the
    -- request concerns.
    subject_type text,
    subject_id text,
    subject_hint text,

    disposition public.correction_request_disposition not null default 'received',

    escalated_at timestamp with time zone,
    escalated_to text,

    decided_at timestamp with time zone,
    decided_by text,
    decision_note text,

    -- Set when acting on this request produced a suppression.
    resulting_suppression_id text,

    -- Whether this request's outcome appears in the public corrections log.
    -- Default false: publishing that a named person asked to be removed
    -- re-publishes the association the removal was meant to end.
    publish_in_log boolean not null default false,

    created_at timestamp with time zone not null default timezone('utc'::text, now()),
    updated_at timestamp with time zone not null default timezone('utc'::text, now()),

    constraint correction_request_escalation_complete check (
        (escalated_at is null and escalated_to is null)
        or (escalated_at is not null and escalated_to is not null)
    ),
    constraint correction_request_decision_complete check (
        (decided_at is null and decided_by is null)
        or (decided_at is not null and decided_by is not null)
    ),
    -- A resolved request must name who resolved it. "It got closed" with no
    -- attributable decider is the state we are specifically trying to avoid.
    constraint correction_request_resolution_attributed check (
        disposition not in ('action_taken', 'declined')
        or (decided_at is not null and decided_by is not null)
    )
);

comment on table public.correction_request is
'Intake ledger for correction requests and takedown demands. Append-only in its substance: request_text and requester identity are immutable after insert. INS-9 boundary -- engineering logs and escalates; it does not decide.';

create index correction_request_open_idx
on public.correction_request (received_at)
where disposition = 'received';

create index correction_request_subject_idx
on public.correction_request (subject_type, subject_id)
where subject_id is not null;

create index correction_request_kind_idx
on public.correction_request (request_kind, disposition);

-- The substance of a request cannot be edited after it arrives. Disposition,
-- escalation, decision, and linkage fields remain mutable; what the requester
-- said and who they are do not.
create or replace function public.enforce_correction_request_immutable_substance()
returns trigger
language plpgsql
as $$
begin
    if new.request_text is distinct from old.request_text
        or new.requester_name is distinct from old.requester_name
        or new.requester_contact is distinct from old.requester_contact
        or new.requester_role is distinct from old.requester_role
        or new.channel is distinct from old.channel
        or new.request_kind is distinct from old.request_kind
        or new.received_at is distinct from old.received_at
    then
        raise exception
            'correction_request %: request substance is immutable after intake',
            old.request_id
            using errcode = 'restrict_violation';
    end if;

    new.updated_at := timezone('utc'::text, now());
    return new;
end;
$$;

create trigger correction_request_immutable_substance
before update on public.correction_request
for each row execute function public.enforce_correction_request_immutable_substance();

create or replace function public.reject_correction_request_delete()
returns trigger
language plpgsql
as $$
begin
    raise exception
        'correction_request is not deletable: attempted delete on request_id=%',
        old.request_id
        using errcode = 'restrict_violation';
end;
$$;

create trigger correction_request_no_delete
before delete on public.correction_request
for each row execute function public.reject_correction_request_delete();

-- The INS-9 boundary, expressed as a constraint rather than a paragraph in a
-- runbook.
--
-- A legal demand may go exactly one place: escalated. It cannot be marked
-- action_taken or declined here, because deciding what a legal demand requires
-- is a legal determination and this role does not make those. Reaching
-- 'action_taken' or 'declined' requires that it was escalated first AND that a
-- decider is named -- so the record shows a human made the call.
--
-- A suspected sealed or expunged record may never be declined. If we are wrong
-- about it being sealed, we have published sealed material.
create or replace function public.enforce_legal_demand_routing()
returns trigger
language plpgsql
as $$
begin
    if new.request_kind in ('legal_demand', 'sealed_or_expunged')
        and new.disposition in ('action_taken', 'declined')
        and new.escalated_at is null
    then
        raise exception
            'request % is a % and must be escalated before it can be resolved; route it to the Executive Director untouched',
            new.request_id, new.request_kind
            using errcode = 'restrict_violation';
    end if;

    if new.request_kind = 'sealed_or_expunged' and new.disposition = 'declined' then
        raise exception
            'request %: a suspected sealed or expunged record cannot be declined',
            new.request_id
            using errcode = 'restrict_violation';
    end if;

    return new;
end;
$$;

create trigger correction_request_legal_routing
before insert or update on public.correction_request
for each row execute function public.enforce_legal_demand_routing();

-- ---------------------------------------------------------------------------
-- 2. Suppression that survives a re-import
-- ---------------------------------------------------------------------------

-- Which upstream rows are covered by a suppression.
--
-- This is the answer to identity churn. `subject_suppression` protects a
-- canonical ID; this table protects the SOURCE RECORD that produced it. A
-- re-import that assigns a fresh canonical ID to the same upstream row still
-- collides with these keys, because the source's own record key does not
-- change when our ledger does.
create table public.suppression_source_key (
    suppression_id text not null
        references public.subject_suppression (suppression_id) on delete restrict,
    source_id text not null references public.source (source_id) on delete restrict,
    source_record_key text not null,
    captured_at timestamp with time zone not null default timezone('utc'::text, now()),

    primary key (suppression_id, source_id, source_record_key)
);

comment on table public.suppression_source_key is
'Upstream (source, record key) pairs covered by a suppression. Suppression keyed only on our canonical ID is defeated by re-identification; this is keyed on the source''s own identifier, which a re-import cannot change.';

create index suppression_source_key_lookup_idx
on public.suppression_source_key (source_id, source_record_key);

-- Capture the source keys automatically when a suppression is applied.
--
-- Doing this by trigger rather than by convention matters: whoever honours a
-- takedown at 11pm is not going to remember to also enumerate the upstream
-- record keys, and a suppression that missed them looks identical to one that
-- did not until the next import quietly resurrects the record.
create or replace function public.capture_suppression_source_keys()
returns trigger
language plpgsql
as $$
begin
    insert into public.suppression_source_key
        (suppression_id, source_id, source_record_key)
    select distinct new.suppression_id, r.source_id, c.source_record_key
    from public.claim c
        join public.source_retrieval r on r.retrieval_id = c.retrieval_id
    where c.subject_type = new.subject_type
        and c.subject_id = new.subject_id
    on conflict do nothing;

    return null;
end;
$$;

comment on function public.capture_suppression_source_keys() is
'Records the upstream record keys behind a subject at the moment it is suppressed, so a later re-import cannot reintroduce it under a new canonical ID.';

create trigger subject_suppression_capture_source_keys
after insert on public.subject_suppression
for each row execute function public.capture_suppression_source_keys();

-- Is this subject under an active suppression?
create or replace function public.is_subject_suppressed(
    p_subject_type text,
    p_subject_id text
)
returns text
language sql
stable
as $$
    select sup.suppression_id
    from public.subject_suppression sup
    where sup.subject_type = p_subject_type
        and sup.subject_id = p_subject_id
        and sup.lifted_at is null
    limit 1;
$$;

comment on function public.is_subject_suppressed(text, text) is
'Returns the active suppression_id for a subject, or null. Returns the id rather than a boolean so callers can name the suppression in their error message.';

-- Suppression lookup by canonical ID alone, ignoring subject_type.
--
-- Deliberately over-broad. Canonical IDs are cuid2 and globally unique, so a
-- match is a match. A suppression filed against subject_type='person' must
-- still stop a write that calls the same ID an 'officer'; a type mismatch is
-- exactly the kind of near-miss that would otherwise let a record through.
create or replace function public.is_id_suppressed(p_subject_id text)
returns text
language sql
stable
as $$
    select sup.suppression_id
    from public.subject_suppression sup
    where sup.subject_id = p_subject_id
        and sup.lifted_at is null
    limit 1;
$$;

-- Is this UPSTREAM record covered by an active suppression, whatever canonical
-- ID it is being mapped to this time?
create or replace function public.is_source_key_suppressed(
    p_source_id text,
    p_source_record_key text
)
returns text
language sql
stable
as $$
    select ssk.suppression_id
    from public.suppression_source_key ssk
        join public.subject_suppression sup
            on sup.suppression_id = ssk.suppression_id
    where ssk.source_id = p_source_id
        and ssk.source_record_key = p_source_record_key
        and sup.lifted_at is null
    limit 1;
$$;

comment on function public.is_source_key_suppressed(text, text) is
'The re-import guard. Answers "is this upstream row suppressed" without reference to any canonical ID, so a regenerated ID mapping cannot launder a takedown.';

-- The Wednesday guard.
--
-- Refuses to write a claim that is under suppression by EITHER route: the
-- subject's canonical ID, or the upstream record key that produced it. A
-- re-import hits this whether or not the canonical ID survived.
--
-- This raises rather than silently dropping the row. A loader that is trying
-- to reintroduce suppressed material should stop and be looked at, not skip a
-- row into a log nobody reads. Intake pre-filters suppressed subjects so this
-- is a backstop, not the routine path.
create or replace function public.enforce_claim_not_suppressed()
returns trigger
language plpgsql
as $$
declare
    blocking text;
    claim_source text;
begin
    blocking := public.is_id_suppressed(new.subject_id);

    if blocking is null then
        select r.source_id into claim_source
        from public.source_retrieval r
        where r.retrieval_id = new.retrieval_id;

        blocking := public.is_source_key_suppressed(claim_source, new.source_record_key);
    end if;

    if blocking is not null then
        raise exception
            'claim %: subject %/% is under active suppression % (source record key %); a suppressed record may not be rewritten by an import',
            new.claim_id, new.subject_type, new.subject_id, blocking, new.source_record_key
            using errcode = 'restrict_violation',
                  hint = 'Lift the suppression through the corrections process, or exclude this record from the import.';
    end if;

    return new;
end;
$$;

create trigger claim_suppression_guard
before insert or update on public.claim
for each row execute function public.enforce_claim_not_suppressed();

-- The same guard on the pre-provenance entity tables that intake still writes
-- directly. `public.agency` and `public.officers` predate the claim model and
-- the loader updates their columns in place; without this, a re-import
-- silently overwrites the contents of a record that is under legal hold.
create or replace function public.enforce_entity_not_suppressed()
returns trigger
language plpgsql
as $$
declare
    blocking text;
begin
    blocking := public.is_id_suppressed(
        case when tg_op = 'DELETE' then old.id else new.id end
    );

    if blocking is not null then
        raise exception
            'table %: row % is under active suppression %; % refused',
            tg_table_name,
            case when tg_op = 'DELETE' then old.id else new.id end,
            blocking,
            tg_op
            using errcode = 'restrict_violation',
                  hint = 'Lift the suppression through the corrections process before modifying this row.';
    end if;

    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger agency_suppression_guard
before update or delete on public.agency
for each row execute function public.enforce_entity_not_suppressed();

create trigger officers_suppression_guard
before update or delete on public.officers
for each row execute function public.enforce_entity_not_suppressed();

-- ---------------------------------------------------------------------------
-- 3. Suppression is applied and lifted under audit, never deleted
-- ---------------------------------------------------------------------------

-- A suppression row is never removed. Deleting one destroys the evidence that
-- we honoured a takedown, which is the record we would most need if the
-- handling were ever challenged.
create or replace function public.reject_subject_suppression_delete()
returns trigger
language plpgsql
as $$
begin
    raise exception
        'subject_suppression is not deletable: lift it instead (suppression_id=%)',
        old.suppression_id
        using errcode = 'restrict_violation';
end;
$$;

create trigger subject_suppression_no_delete
before delete on public.subject_suppression
for each row execute function public.reject_subject_suppression_delete();

-- The only legal update to a suppression is lifting it, once, with a reason.
-- Editing why or against whom a suppression was filed would make the audit
-- trail a narrative rather than a record.
create or replace function public.enforce_subject_suppression_lift_only()
returns trigger
language plpgsql
as $$
begin
    if new.subject_type is distinct from old.subject_type
        or new.subject_id is distinct from old.subject_id
        or new.reason_code is distinct from old.reason_code
        or new.reason_note is distinct from old.reason_note
        or new.requested_by is distinct from old.requested_by
        or new.applied_by is distinct from old.applied_by
        or new.applied_at is distinct from old.applied_at
    then
        raise exception
            'suppression %: only the lift fields may be updated',
            old.suppression_id
            using errcode = 'restrict_violation';
    end if;

    if old.lifted_at is not null then
        raise exception
            'suppression % is already lifted and cannot be re-lifted or re-applied; file a new suppression',
            old.suppression_id
            using errcode = 'restrict_violation';
    end if;

    if new.lifted_at is not null
        and coalesce(btrim(new.lift_note), '') = ''
    then
        raise exception
            'suppression %: lifting requires lift_note stating the basis',
            old.suppression_id
            using errcode = 'restrict_violation';
    end if;

    return new;
end;
$$;

create trigger subject_suppression_lift_only
before update on public.subject_suppression
for each row execute function public.enforce_subject_suppression_lift_only();

-- Suppression apply/lift lands in the same append-only log as claim status
-- transitions, so "what happened to this subject" is one query rather than a
-- reconciliation of two tables.
create or replace function public.record_suppression_event()
returns trigger
language plpgsql
as $$
declare
    acting text;
begin
    if tg_op = 'UPDATE' and new.lifted_at is null then
        return null;
    end if;

    acting := coalesce(
        nullif(current_setting('intake.actor', true), ''),
        case when tg_op = 'INSERT' then new.applied_by else new.lifted_by end,
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
        null,
        case when tg_op = 'UPDATE' then 'blocked'::public.publication_status else null end,
        case when tg_op = 'INSERT' then 'blocked'::public.publication_status
             else 'staged'::public.publication_status end,
        new.reason_code,
        case when tg_op = 'INSERT' then new.reason_note else new.lift_note end,
        acting
    );

    return null;
end;
$$;

comment on function public.record_suppression_event() is
'Writes suppression apply and lift into publication_event. A lift records to_status=staged, never published: see restage_claims_on_lift.';

create trigger subject_suppression_audit
after insert or update on public.subject_suppression
for each row execute function public.record_suppression_event();

-- Lifting a suppression returns the subject to `staged`. It does not restore
-- whatever publication status the claims held before.
--
-- This is deliberate and it is the conservative direction. A suppression is
-- lifted for many reasons -- the dispute was resolved, the wrong subject was
-- suppressed, the hold expired -- and none of them are the same decision as
-- "this is fit to publish". Making republication a separate, separately
-- audited act means an accidental lift cannot re-expose a page.
create or replace function public.restage_claims_on_lift()
returns trigger
language plpgsql
as $$
begin
    if new.lifted_at is null then
        return null;
    end if;

    perform set_config(
        'intake.reason_note',
        'restaged on lift of suppression ' || new.suppression_id,
        true
    );

    update public.claim
    set publication_status = 'staged'
    where subject_type = new.subject_type
        and subject_id = new.subject_id
        and publication_status = 'published';

    return null;
end;
$$;

create trigger subject_suppression_restage
after update on public.subject_suppression
for each row execute function public.restage_claims_on_lift();

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ingestion role
-- ---------------------------------------------------------------------------

-- The triggers above stop an accidental un-suppression. This stops a
-- deliberate one, and it is the half that does not depend on a future
-- migration leaving the triggers in place: the ingestion role has no
-- privilege on the suppression tables at all.
--
-- Loaders must connect as `intake_writer`. A loader running as the database
-- owner is outside this guarantee, which is why assert_suppression_invariant()
-- checks the grants rather than trusting the connection string.
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'intake_writer') then
        create role intake_writer nologin;
    end if;
end;
$$;

grant usage on schema public to intake_writer;
grant select, insert, update, delete on all tables in schema public to intake_writer;
grant usage, select on all sequences in schema public to intake_writer;
grant execute on all functions in schema public to intake_writer;

-- The revocations that matter. Read-only on suppression state: intake must be
-- able to SEE what is suppressed so it can skip those records, and must not be
-- able to change it.
revoke insert, update, delete on public.subject_suppression from intake_writer;
revoke insert, update, delete on public.suppression_source_key from intake_writer;

-- Intake may file a request that arrived through a source publisher, and may
-- not dispose of one.
revoke update, delete on public.correction_request from intake_writer;

-- The audit log is written by trigger under the trigger owner's rights; the
-- role itself never writes it directly.
revoke insert, update, delete on public.publication_event from intake_writer;
revoke insert, update, delete on public.source_retrieval from intake_writer;

comment on role intake_writer is
'Ingestion role. Full DML on data tables, read-only on suppression state. A pipeline connecting as this role cannot lift a takedown even with a bug or a malicious patch.';

-- ---------------------------------------------------------------------------
-- 5. Public corrections log
-- ---------------------------------------------------------------------------

-- What the public can see about our corrections.
--
-- The hard call here is naming. A corrections log that says "removed the
-- record for <person name> on 2026-08-24 following a removal request"
-- republishes exactly the association the removal was meant to end, and does
-- it on a page designed to be crawled. So:
--
--   * Corrections and suppressions of AGENCIES are named. An agency is not a
--     data subject and the public interest in knowing we corrected a
--     department's record is real.
--   * Anything concerning a PERSON appears without the subject ID or any
--     identifying detail -- date, action, and coarse reason only.
--
-- Requester identity never appears at any granularity.
create or replace function render.corrections_reason_label(p_reason_code text)
returns text
language sql
immutable
as $$
    select case p_reason_code
        when 'takedown_request' then 'Removal request'
        when 'legal_hold' then 'Legal hold'
        when 'data_subject_request' then 'Request from the person named'
        when 'accuracy_dispute' then 'Accuracy dispute'
        when 'source_withdrawn' then 'Source withdrew the record'
        when 'sealed_or_expunged_suspected' then 'Possible sealed or expunged record'
        when 'personnel_publication_gate' then 'Not yet cleared for publication'
        else 'Under review'
    end;
$$;

create view render.corrections_log as
select
    date_trunc('day', pe.occurred_at) as logged_on,
    pe.subject_type,
    -- Named for agencies, withheld for people. See the comment above.
    case when pe.subject_type = 'agency' then pe.subject_id else null end
        as subject_id,
    case
        when pe.to_status = 'blocked' then 'Record withheld'
        when pe.to_status = 'staged' then 'Record returned to review'
        when pe.to_status = 'quarantined' then 'Record quarantined pending review'
        when pe.to_status = 'published' then 'Record published'
    end as action,
    render.corrections_reason_label(pe.reason_code) as reason
from public.publication_event pe
where pe.reason_code is not null
    -- Claim-level churn during normal ingestion is not a "correction" in the
    -- sense the public cares about; only subject-level actions are logged.
    and pe.claim_id is null
order by pe.occurred_at desc;

comment on view render.corrections_log is
'Public corrections log. Agencies are named; anything concerning a person is date/action/reason only, because naming the subject of a removal republishes what the removal withdrew. Requester identity is never exposed.';

alter view render.corrections_log set (security_invoker = off);

-- Explicit grant: `alter default privileges ... revoke all` in the provenance
-- migration means a new render view is unreadable until someone writes this
-- line deliberately.
grant execute on function render.corrections_reason_label(text) to page_renderer;
grant select on render.corrections_log to page_renderer;

-- assert_provenance_invariant() carries a hard-coded allowlist of render views
-- the page role may read, and it correctly rejects the grant above until the
-- allowlist is widened here. That rejection is the feature: adding a public
-- read surface is a deliberate edit to a named list, reviewed in the diff, not
-- a side effect of writing a GRANT.
--
-- Redefined in full rather than patched, because the allowlist is the only
-- thing changing and a reader needs to see the other four checks are intact.
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
    --    `corrections_log` added by INS-9: it is a public surface by design and
    --    exposes no bare value column and no requester identity.
    select
        'renderer_grant_outside_allowlist'::text,
        (table_name || ' [' || privilege_type || ']')::text
    from information_schema.table_privileges
    where grantee = 'page_renderer'
        and table_schema = 'render'
        and table_name not in
            ('published_claim', 'published_agency', 'corrections_log')

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

-- ---------------------------------------------------------------------------
-- 6. Self-check the suppression invariant holds
-- ---------------------------------------------------------------------------

-- The counterpart to assert_provenance_invariant(). Empty result means intact.
-- Run in CI after every migration; a non-empty result fails the build. This is
-- what catches a later migration that re-grants the suppression tables with a
-- convenient `grant all on all tables in schema public`.
create or replace function public.assert_suppression_invariant()
returns table (violation text, detail text)
language sql
stable
as $$
    -- 1. The ingestion role must not be able to change suppression state.
    select
        'intake_can_modify_suppression'::text,
        (table_name || ' [' || privilege_type || ']')::text
    from information_schema.table_privileges
    where grantee = 'intake_writer'
        and table_schema = 'public'
        and table_name in ('subject_suppression', 'suppression_source_key')
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE')

    union all

    -- 2. The ingestion role must not be able to rewrite the audit trail.
    select
        'intake_can_modify_audit_trail'::text,
        (table_name || ' [' || privilege_type || ']')::text
    from information_schema.table_privileges
    where grantee = 'intake_writer'
        and table_schema = 'public'
        and table_name in ('publication_event', 'source_retrieval')
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE')

    union all

    -- 3. No actively-suppressed subject may appear in a render view. This is
    --    the outcome the whole mechanism exists to produce, checked directly
    --    against the views rather than inferred from the code that builds them.
    select
        'suppressed_subject_is_renderable'::text,
        (sup.subject_type || '/' || sup.subject_id
            || ' visible via render.published_claim')::text
    from public.subject_suppression sup
    where sup.lifted_at is null
        and exists (
            select 1 from render.published_claim rc
            where rc.subject_type = sup.subject_type
                and rc.subject_id = sup.subject_id
        )

    union all

    select
        'suppressed_subject_is_renderable'::text,
        ('agency/' || sup.subject_id || ' visible via render.published_agency')::text
    from public.subject_suppression sup
    where sup.lifted_at is null
        and exists (
            select 1 from render.published_agency ra
            where ra.agency_id = sup.subject_id
        )

    union all

    -- 4. The renderer must not be able to read requester identity.
    select
        'renderer_can_read_requesters'::text,
        (table_schema || '.' || table_name || ' [' || privilege_type || ']')::text
    from information_schema.table_privileges
    where grantee = 'page_renderer'
        and table_name = 'correction_request'

    union all

    select
        'corrections_log_exposes_requester'::text,
        ('render.corrections_log.' || column_name)::text
    from information_schema.columns
    where table_schema = 'render'
        and table_name = 'corrections_log'
        and column_name in
            ('requester_name', 'requester_contact', 'requester_role', 'request_text')

    union all

    -- 5. The corrections log must not name a person.
    select
        'corrections_log_names_person'::text,
        ('subject_id disclosed for subject_type=' || cl.subject_type)::text
    from render.corrections_log cl
    where cl.subject_type <> 'agency'
        and cl.subject_id is not null

    union all

    -- 6. A legal demand must not have been resolved without escalation.
    select
        'legal_demand_resolved_without_escalation'::text,
        cr.request_id::text
    from public.correction_request cr
    where cr.request_kind in ('legal_demand', 'sealed_or_expunged')
        and cr.disposition in ('action_taken', 'declined')
        and cr.escalated_at is null;
$$;

comment on function public.assert_suppression_invariant() is
'Returns zero rows when the corrections/takedown invariant is intact. Non-empty means a suppressed record is reachable, the ingestion role can undo a takedown, requester identity is exposed, or a legal demand was resolved without escalation.';

commit;
