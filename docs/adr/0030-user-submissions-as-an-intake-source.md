# ADR 0030: User Submissions as an Intake Source

## Status

Accepted

> The intake-side implementation of
> [ADR 0029](0029-align-the-public-report-model-to-the-report-new-form.md)'s
> resolution step. Applies the same resolve-or-fail discipline
> ([ADR 0015](0015-isolate-namespaces-and-own-cross-source-identity-at-root.md) /
> [ADR 0023](0023-contexts-return-mapped-source-ids-never-canonical-ids.md)) and
> acquire/run split ([ADR 0005](0005-use-source-specific-artifact-producers.md))
> that every other source uses.

## Context

The website's `/report/new` (and its sibling forms) capture user submissions into
an S3 bucket, already synced to a sibling folder of this repo
(`../policeconduct-submissions-942370948729`). Layout:

- `submissions/<date>/<formName>/<id>.json` — one submission:
  `{ submissionId, receivedAt, sourceIp, userAgent, payload: { formName, data } }`.
- `submissions/verify/<verificationId>.json` — email verification. A submission is
  **verified** when its record has `verifiedAt` set.
- `submissions/status/<id>.json` — human review verdict, keyed by `submissionId`:
  `{ submissionId, status, decision?: { at, by, reason } }`. `approved` publishes;
  `rejected` is a permanent exclusion; any other value (`received`, `in_review`, …)
  or a missing file holds the submission for review.

Form types present: `reportNew`, `civilLitigationNew`, `personnelNew`,
`officerEdit`, `agencyEdit`, `contact`, `volunteer`, `dataSubjectAccessRequest`,
`issue`. Only a subset are verified.

Publishing user text is higher-risk than the government/court feeds: it can be
incoherent, off-topic, defamatory, or rule-violating. The bar to publish is high
— **better safe than sorry** — and anything short of clearly-publishable needs a
human, not a silent drop.

## Decision

Add a source `org.policeconduct.submissions` with the standard acquire→run shape.

**1. acquire owns sync; the publish verdict is a cached human decision.** acquire
`aws s3 sync`s the bucket to the sibling folder (`SUBMISSIONS_BUCKET_DIR`) and
pushes local curator changes back up. Both directions are **additive** (never
`--delete`): the local folder holds curator-authored content (status verdicts, the
seeded submission) that may not round-trip, since the bucket policy can deny
`PutObject` to this principal — submissions are written by the website pipeline.
The write-back is therefore **best-effort**: a denied/failed up-sync is warned and
skipped, never fatal, so a read-only profile still acquires. The publish verdict
is a **human decision cached as a `status/` file** (§Context): `approved`
publishes, `rejected` is a permanent exclusion, everything else holds. The
automated AI coherence/site-rules gate is **deferred**; until it lands the verdict
is set by hand. Either way `run` reads the cached verdict and stays deterministic
— network and non-determinism never enter `run`.

**2. run resolves, gates, and emits — deterministically.** run traverses **only
verified** submissions of the v1 form type (`reportNew`), and for each:

- resolves each officer's `department` to an agency and the officer's name to
  `agency_personnel` (officer@agency) — **resolve-or-fail**, via the run resolver
  context (ADR 0023). An officer/agency that does not resolve is an attributed
  claim, never a canonical link. (The `reportNew` v1 form carries no case number;
  civil-case linking via `resolveCivilCase` waits on a form field for it.)
- resolves the incident `location` (free-text user input) by **geocoding it
  through the shared agency location path** (address → coordinates → snapped
  `location_path_id` + `latitude`/`longitude`), at import via the injected
  coordinate resolver — the same infrastructure agencies use, not a brittle
  name match. A location that fails to geocode routes the report to human review.
- applies the cached `status/` verdict as a **high publication bar** — publish only
  on `approved`; `rejected` is dropped; anything else is held (§1).
- keys the report on its **`submissionId` as a natural-key identity** (ADR 0028):
  `Review.id = submissionId`, so the report id is the immutable audit tie back to
  the submission (the bucket's `verify/`/`status/` records cross-link the rest),
  and re-import is idempotent. `slug` stays the separate user-facing URL.
- emits a report (`Review` + `ReviewPersonnel`) **only** when it clears the bar
  and anchors to at least one real officer@agency
  (everything-resolves-to-an-officer; ADR 0029 publish gate). Otherwise it emits
  nothing to the database.

**3. Everything else goes to a human-review report, not the database.** A
submission that is not clearly publishable — lacks an `approved` verdict, does not
resolve to an officer, is a non-`reportNew` form, or is otherwise borderline — is
written to a **run-output review-report file** (`review-report.json` in the
source's state dir), listing the held/rejected submission and why (the verdict, or
"no officer resolved"). Nothing enters the database until a human acts on it. This
is the source's second output, alongside the artifacts.

**3a. Submitter prose is stored verbatim.** The narrative fields (`title`,
`what_happened`, `desired_outcome`, `charges`, …) are written exactly as entered
— no casing, normalization, summarizing, or rewording. Resolution and the AI gate
act _around_ the prose (deciding publish/hold/flag, resolving officers/location),
never _on_ it. Mechanically this is the facade default (verbatim pass-through):
narrative columns carry no normalizing resolver, unlike agency `name`/`city`.

**4. Submitter PII never persists** (ADR 0029 §3). `reporterName` /
`reporterEmail` / `reporterPhone`, `sourceIp`, and `userAgent` are used only
transiently (verification is already done off-database, in the bucket's `verify/`
records); none becomes a database column or artifact field.

**5. Old-model `traits` are deprecated and ignored.** A `reportNew` submission's
`officers[].traits` is the retired rubric/trait model (ADR 0029); the scoring
tables are dropped, so the source never reads or stores it — it resolves the
officer from `name` + `department` and keeps the submitter's narrative prose.

**6. v1 scope is `reportNew` only.** The other publication-content forms
(`personnelNew`, `civilLitigationNew`, `officerEdit`, `agencyEdit`) need
edit/merge semantics against existing records and are deferred; until then they
land in the human-review report. Ops forms (`contact`, `volunteer`,
`dataSubjectAccessRequest`, `issue`) are never publication content.

## Consequences

Prerequisites, then the source:

1. **Report entity (intake schema/specs).** No `Review`/report import artifact
   kind exists yet. Add `Review` + `ReviewPersonnel` entity descriptors and
   regenerate specs/mutations/facades/resolvers (ADR 0026). The report targets the
   ADR 0029 narrative columns.
2. **New run resolver.** RunDataContext today has `resolvePersonnel` and
   `resolveCivilCase`; add `resolveAgency` (resolve-or-fail, ADR 0023 — a mapped
   source id out, never a canonical id). Location is not a run resolver: it
   geocodes at import through the shared agency path (§2).
3. **acquire:** `aws s3 sync` down/up; the publish verdict is a cached `status/`
   file (a human decision for now; the AI gate is deferred).
4. **run:** verified-`reportNew` traversal → resolve → `status/` gate → emit
   `Review`/`ReviewPersonnel` for approved+officer-resolved reports, review-report
   file for the rest.

**Standalone** (ADR 0031): the source is excluded from group runs and runs on its
own after the reconstruction, so its officer/location resolution reads a fully
imported roster. It stages the approved reports into the database between group
runs — the same manual-intervention shape as `org.policeconduct.manual`.

## Alternatives Considered

- **AI analysis in `run`.** Rejected: it is network + non-determinism, which the
  acquire/run split keeps out of `run`. Caching the verdict in acquire preserves a
  deterministic, reproducible run and a stable artifact for human review.
- **Write borderline submissions to the DB as `verification_pending`.** Deferred:
  needs an admin triage UI. A run-output report file needs nothing new and keeps
  unpublished user text out of the database entirely.
- **Handle all form types in v1.** Rejected for scope: edits/merges against
  existing records are a separate problem from minting a new report.

## Revisit Trigger

The bucket layout or verification signal changes; the AI gate needs to move; or a
second form type is brought in (adds edit/merge semantics).
