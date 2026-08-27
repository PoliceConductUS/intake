# ADR 0029: Align the Public Report Model to the /report/new Form

## Status

Proposed

> Applies the resolve-or-fail discipline of
> [ADR 0006](0006-allow-artifacts-to-create-known-valid-related-entities.md) /
> [ADR 0015](0015-isolate-namespaces-and-own-cross-source-identity-at-root.md) /
> [ADR 0023](0023-contexts-return-mapped-source-ids-never-canonical-ids.md) and
> the natural-key identity of
> [ADR 0028](0028-natural-key-identity-for-cross-source-entities.md) to
> user-submitted reports. The schema is intake-owned (all migrations live here),
> so the schema half is an intake change; the form, submit endpoint, and display
> are website changes that must move in lockstep.

## Context

The `reviews` / `review_*` / `rubrics` / `traits` tables predate the current
product model. The website's `/report/new` form defines the intended model: a
**first-person narrative account** of a police interaction — what led up to it,
what happened, how it felt — **not** the old per-trait rubric scoring. Rubrics
and traits are no longer used (confirmed), though current `main`'s
`report-detail.ts` still queries and renders them.

A report must attach to **canonical** records, never free text: a specific
officer at a specific agency (`agency_personnel`), a specific `location_path_id`,
an existing `civil_case` — the same resolve-or-fail discipline intake uses.

Submission is **capture-then-resolve**, mirroring intake's acquire→run: a generic
form-submission endpoint captures the raw report as `verification_pending`
(unresolved, the submitter's words verbatim); a separate **resolution step** turns
it into a published, anchored report. `reviews` already carries the
resolved-location columns (`location_path_id`, `latitude`, `longitude`,
`address`).

## Decision

Adopt the `/report/new` model as the canonical report shape and align the schema
to it.

**1. The report row carries narrative + resolved location.**

- Kept: `id`, `slug`, `title`, `incident_date`, `location_path_id`, `latitude`,
  `longitude`, `address`, `desired_outcome`, `charges`, `created_at`,
  `updated_at`.
- Added: `what_happened` (the narrative — the former `description` folds into it),
  `how_felt`, `what_else`, `incident_time`, `submitter_relationship`,
  `interaction_type`, `setting`, `bodycam_requested`, `complaint_filed`,
  `purpose`, `case_number`.
- `description` is retired into `what_happened` with the display (coordinated, not
  in the non-breaking phase). `submitter_relationship` is non-identifying report
  provenance (firsthand vs. secondhand), not contact info.

**2. Resolved links, never free text** (the resolution step resolves these):

| Form input                       | Resolves to                                                     |
| -------------------------------- | --------------------------------------------------------------- |
| `location` (city/state)          | `location_path_id` (+ `latitude`/`longitude`)                   |
| `agencyName`                     | a specific agency                                               |
| officers named in `whatHappened` | `agency_personnel` (officer@agency) via `review_personnel`      |
| `caseNumber`                     | an existing `civil_case` (natural key `court:docket`, ADR 0028) |

An officer/agency/case that does not resolve is kept as an **attributed claim**
(the submitter's words), never a canonical link — as with the youtube /
courtlistener / clearinghouse sources.

**3. Submitter contact is never persisted.** `reporterName` / `reporterEmail` /
`reporterPhone` do not enter the database at all — no report column and no
submissions table. Verification uses them transiently, off-database. The report
therefore has no submitter reference, so `reviews.user_id` is dropped — which in
turn lets `profiles` (and its children) go.

**4. Coordinated drops, in lockstep with the display rewrite** (never before —
current `main` still renders the scoring tables):

- the dead scoring model: `rubrics`, `traits`, `rubric_labels`,
  `review_personnel_ratings`;
- `description` (folded into `what_happened`);
- `reviews.user_id`, then `profiles`, `profile_emails`, `profile_links`,
  `profile_phone_numbers` (no submitter stored);
- `audit_logs` (unused system table).

**5. Publish gate.** A captured report stays `verification_pending` until the
resolution step anchors it to at least one real officer@agency
(everything-resolves-to-an-officer); it is published only then, never as an
unanchored record.

## Consequences

Cross-repo and **phased**, drop last:

1. **Schema migration (intake), non-breaking:** add the new report columns and
   confirm the report→`agency_personnel` / →`civil_case` links. Nothing dropped.
2. **Resolution step + website:** the resolution step resolves
   officer/agency/location/case (mirroring intake's resolvers) to move a captured
   submission from `verification_pending` to a published report; the website
   rewrites the report display to the new narrative model. The generic capture
   endpoint already exists, so this is resolution + display, not a new endpoint.
   Any existing rubric/trait report content is transformed onto the narrative
   model (mapped into `what_happened` etc.) as a one-time production backfill —
   never silently discarded.
3. **Dropped intake-side (done).** The old models are retired in intake now,
   decoupled from the website (the schema is intake-owned; the website's reads of
   these tables are updated separately and are not a blocker):
   - scoring model — `review_personnel_ratings`, `rubric_labels`, `rubrics`,
     `traits` (migration `20260829000000`);
   - submitter/account model — `reviews.user_id`, `review_witnesses.profile_id`,
     `audit_logs`, `profile_emails`, `profile_links`, `profile_phone_numbers`,
     `profiles` (migration `20260830000000`).

   Reports now link to officers only via `review_personnel` (officer@agency); no
   trait linkage and no submitter/account remain.

Result: user reports become structured, verifiable records anchored to real
officers/agencies/cases, and the public dataset carries no submitter PII.

## Alternatives Considered

- **Keep rubric/trait scoring** — rejected; the form abandoned it and it is
  unused.
- **Free-text officer/agency/location on the report** — rejected; violates
  resolve-or-fail. A report must point at real records.
- **Drop the scoring tables now** — rejected; breaks current `main`'s display.
  The drop is coordinated and last.

## Revisit Trigger

The `/report/new` fields change materially, or the submit endpoint's resolution
rules need to diverge from intake's.
