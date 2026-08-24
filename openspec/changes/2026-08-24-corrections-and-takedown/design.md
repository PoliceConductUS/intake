# Design

## The failure this is built around

> A takedown honoured on Tuesday and undone by a re-import on Wednesday.

There are two distinct versions of that failure and they need different
defences.

**Version A — the pipeline overwrites the record.** The loader classifies an
existing agency with owned columns as an `update` and writes `public.agency`
directly. Under a legal hold that overwrites the record we are holding. The
suppression row survives, so the page stays down, but the contents of the held
record are gone.

**Version B — the pipeline reintroduces the record under a new ID.** Intake
maps source record keys to canonical cuid2 IDs through a YAML ledger on disk.
`subject_suppression` is keyed on the canonical ID. If that ledger is
regenerated, the same upstream row is assigned a fresh canonical ID, and every
suppression check keyed on the old ID passes. The record comes back.

Version B is the dangerous one, because it is silent, because the ledger lives
outside the database where the suppression lives, and because nothing about it
looks like a failure. The import succeeds. The row count goes up by one.

## Why suppression is anchored to the source record key

The only identifier that does not change when our ID mapping changes is the
source's own. `public.claim` already carries `source_record_key`, so at the
moment a subject is suppressed we can enumerate the exact upstream rows behind
it and record them in `suppression_source_key`.

Capture is by trigger, not by convention. Whoever honours a takedown at 11pm is
not going to remember to also enumerate the upstream record keys, and a
suppression that missed them looks identical to one that did not — until the
next import.

The guard on `public.claim` therefore checks two things, and either one blocks
the write:

1. is the subject's canonical ID suppressed?
2. is the `(source_id, source_record_key)` behind this claim suppressed?

Check 2 is what catches Version B.

## Why the ID lookup ignores subject_type

`is_id_suppressed(subject_id)` deliberately does not filter on `subject_type`.
Canonical IDs are cuid2 and globally unique, so a match is a match. A
suppression filed against `subject_type='person'` must still stop a write that
calls the same ID an `'officer'`. A type mismatch between the suppression and
the write is exactly the near-miss that would otherwise let a record through,
and being over-broad here costs nothing.

## Why the guard raises instead of skipping

A trigger that silently dropped suppressed rows would turn a serious event into
a log line nobody reads. It raises. A loader trying to reintroduce suppressed
material should stop and be looked at.

To keep that a backstop rather than the routine path, `classifyDatabaseOperations`
reads active suppressions and demotes a suppressed row's operation from
`update` to `read`. A honoured takedown then costs one skipped record instead
of a broken pipeline. Intake reads suppression state through the same
`intake_writer` role that cannot write it.

## Why two independent defences

The triggers stop an accidental un-suppression. They do not stop a deliberate
one, and they do not survive a future migration that drops a trigger — which is
exactly the kind of thing that happens during an unrelated refactor eighteen
months from now.

So `intake_writer` holds SELECT and nothing else on the suppression tables.
Removing that protection requires writing a GRANT, which
`assert_suppression_invariant()` fails the build on. Neither defence depends on
the other.

`intake_writer` needs SELECT, not zero access: the planner has to see what is
suppressed in order to skip it.

## Why lifting returns claims to `staged`, not to `published`

A suppression gets lifted for several different reasons — the accuracy dispute
was resolved, the wrong subject was suppressed, a legal hold expired, someone
made a mistake filing it. None of those is the same decision as "this record is
fit to publish."

Restoring the prior publication status would make an accidental lift
immediately re-expose a public page. Returning to `staged` means republication
is a separate act with its own audit event. The cost is that a legitimately
lifted record needs a second, deliberate step. That is the correct direction to
be wrong in.

## The naming rule in the public corrections log

This is the hard call in the change.

A corrections log that says _"removed the record for [name] on 2026-08-24
following a removal request"_ republishes exactly the association the removal
was meant to end — and does it on a page built to be crawled and indexed. The
log would become a directory of people who asked to be taken down.

So the rule is asymmetric:

- **Agencies are named.** An agency is not a data subject, and the public
  interest in knowing that we corrected a department's record is real and
  direct.
- **Anything concerning a person is date, action, and coarse reason only.** No
  subject ID, no identifying detail.
- **Requester identity never appears at any granularity**, for either.

`assert_suppression_invariant()` checks the view's own output for a disclosed
non-agency subject ID, so this holds as an assertion about data rather than an
intention about SQL.

The cost is that the log is less informative for the personnel corpus, which is
the larger half. That is the right trade: a corrections log exists to show we
correct things, not to re-identify the people we corrected.

## What this change does not decide

Per the INS-9 boundary: it builds the mechanism and decides nothing about what
gets taken down. The schema enforces that boundary rather than documenting it —
a `legal_demand` cannot be resolved without escalation, and a suspected sealed
or expunged record cannot be declined at all.

## Known gaps, deliberately left

**The legacy entity tables have no source-key linkage.** `public.agency` and
`public.officers` predate the claim model and carry no `source_record_key`
column, so Version B cannot be blocked in the database for them — there is
nothing to compare against. The guard on those tables covers UPDATE and DELETE
of a suppressed row (Version A) but cannot recognise a re-created row under a
new ID. Those tables are what render the 132,109 live personnel pages, so this
gap is real and not theoretical. Closing it means plumbing source record keys
through `ImportRows`, which belongs with the loader audit.

**Suppressed skips are not yet in the change diff.** The planner demotes a
suppressed row to `read`, which is correct behaviour, but the count does not
surface in the load's change diff.

Both are tracked as follow-up issues.
