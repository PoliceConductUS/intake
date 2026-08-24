## Why

We publish claims about named human beings, and 132,109 officer pages are
already live (INS-11). The first correction request or takedown demand will
arrive with no intake path, no suppression procedure, and no audit trail. The
first time we need this we will need it urgently, which is the worst time to
design it.

`20260824170000_provenance_structural_invariant.sql` established suppression
STATE: an active `subject_suppression` row removes a subject from every render
view, and `publication_event` is an append-only status log. Four things are
missing, and each of them is a way a takedown fails silently.

**1. There is no intake path.** Correction requests and takedown demands arrive
by email, web form, and attorney letter and currently land in a person's inbox.
Nothing records what was asked, when it arrived, or what we did about it.

**2. The ingestion pipeline can undo a takedown.** The loader connects with
full rights on `public`. Nothing prevents a re-import from setting `lifted_at`
or deleting the suppression row. A takedown honoured on Tuesday and undone by
Wednesday's re-import is currently reachable, and it would leave no trace that
it had ever been honoured.

**3. Re-identification launders a takedown, and this is the subtle one.**
Intake maps source record keys to canonical cuid2 IDs through an on-disk YAML
ledger (`src/cli/state/source-name-to-canonical-id`). `subject_suppression` is
keyed on the canonical ID. If that ledger is regenerated, lost, or diverges
from the database, a re-import assigns a NEW canonical ID to the SAME upstream
record. The suppression row survives untouched, still pointing at the old ID,
and protects nothing. Every canonical-ID check passes. The record comes back.

Suppression keyed only on our own identifier cannot survive a change to our own
identifier. It has to be anchored to something the source controls.

**4. There is no public corrections log.** An accountability organisation that
corrects records privately is asking for a trust it does not extend to anyone
else.

## What Changes

**Intake**

- From: Requests arrive in an inbox and are handled ad hoc.
- To: `public.correction_request` records channel, kind, the requester's
  verbatim text, and disposition. Request substance is immutable after intake
  and the row cannot be deleted.
- Reason: If our handling of a demand is ever questioned, a paraphrase is
  worthless.
- Impact: New table. No existing table is altered.

**The INS-9 boundary, enforced**

- From: "Route legal demands to the Executive Director" is a paragraph in
  AGENTS.md.
- To: A trigger refuses to mark a `legal_demand` or `sealed_or_expunged`
  request `action_taken` or `declined` unless it was escalated first, and
  refuses to decline a suspected sealed record at all. A resolved request must
  name who decided.
- Reason: Deciding what a legal demand requires is a legal determination.
  Engineering does not make those, and the schema should not let it.

**Suppression that survives a re-import**

- From: Suppression is keyed on the canonical ID only.
- To: `public.suppression_source_key` records the upstream `(source_id,
source_record_key)` pairs behind a subject, captured by trigger at the moment
  of suppression. `claim` writes are refused if the subject OR the upstream
  record key is suppressed. `public.agency` and `public.officers` refuse
  UPDATE and DELETE on a suppressed row.
- Reason: A re-import must fail closed whether or not our ID mapping survived.

**Suppression is applied and lifted under audit, never deleted**

- From: `subject_suppression` rows are freely updatable and deletable.
- To: DELETE is refused outright. UPDATE is restricted to the lift fields, once,
  and requires a `lift_note`. Apply and lift both write `publication_event`.
- Reason: Deleting a suppression destroys the evidence that we honoured a
  takedown, which is the record we would most need.

**Lifting does not republish**

- From: Undefined.
- To: Lifting a suppression returns the subject's claims to `staged`, never to
  `published`.
- Reason: A suppression is lifted for many reasons and none of them are the
  same decision as "this is fit to publish". An accidental lift must not
  re-expose a page.

**Least-privilege ingestion role**

- From: The loader connects with full rights on `public`.
- To: `intake_writer` holds DML on the data tables and SELECT-only on the
  suppression tables and the audit log.
- Reason: The triggers stop an accidental un-suppression. This stops a
  deliberate one, and it survives a future migration that drops a trigger.

**Public corrections log**

- From: None.
- To: `render.corrections_log`, granted to `page_renderer`.
- Reason: Distribution and accountability. See design.md for the naming rule --
  agencies are named, people are not.

## Impact

- Purely additive. No existing table is altered or dropped.
- Depends on `20260824170000_provenance_structural_invariant.sql` (PR #60);
  this migration must be applied after it.
- Loaders must be repointed to connect as `intake_writer`. A loader still
  connecting as the database owner is outside the privilege guarantee, which is
  why `assert_suppression_invariant()` checks grants rather than trusting the
  connection string.
- `assert_provenance_invariant()` is redefined to widen its render-view
  allowlist by one entry. All four of its checks are otherwise unchanged.
- Requires a generated type refresh in downstream consumers. No data reset.
