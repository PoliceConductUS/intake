# ADR 0030: User Submissions as an Intake Source

## Status

Proposed

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
- `submissions/status/<id>.json` — human review workflow (`in_review`, …).

Form types present: `reportNew`, `civilLitigationNew`, `personnelNew`,
`officerEdit`, `agencyEdit`, `contact`, `volunteer`, `dataSubjectAccessRequest`,
`issue`. Only a subset are verified.

Publishing user text is higher-risk than the government/court feeds: it can be
incoherent, off-topic, defamatory, or rule-violating. The bar to publish is high
— **better safe than sorry** — and anything short of clearly-publishable needs a
human, not a silent drop.

## Decision

Add a source `org.policeconduct.submissions` with the standard acquire→run shape.

**1. acquire owns sync + the non-deterministic AI, cached.** acquire syncs the S3
bucket to the sibling folder and runs the AI analysis (coherence + site-rules
compliance) for each verified submission, **caching the verdict alongside the
submission** — exactly as `youtube.policeactivity` caches captions. Network and
non-determinism stay in acquire; `run` reads the cached verdict and stays
deterministic and reproducible, and a human reviewer sees the same verdict the
gate saw.

**2. run resolves, gates, and emits — deterministically.** run traverses **only
verified** submissions of the v1 form type (`reportNew`), and for each:

- resolves the named officers to `agency_personnel` (officer@agency), the agency,
  the incident `location_path_id`, and any `caseNumber` to an existing
  `civil_case` — all **resolve-or-fail**, via the run resolver context
  (ADR 0023). An officer/agency/case that does not resolve is an attributed claim,
  never a canonical link.
- applies the cached AI verdict as a **high publication bar**.
- emits a report (`Review` + `ReviewPersonnel`) **only** when it clears the bar
  and anchors to at least one real officer@agency
  (everything-resolves-to-an-officer; ADR 0029 publish gate). Otherwise it emits
  nothing to the database.

**3. Everything else goes to a human-review report, not the database.** A
submission that is not clearly publishable — fails the AI bar, does not resolve to
an officer, is a non-`reportNew` form, or is otherwise borderline — is written to
a **run-output review-report file** (the source's output), listing the submission,
the AI verdict, and what failed to resolve. Nothing enters the database until a
human acts on it. This is the source's second output, alongside the artifacts.

**4. Submitter PII never persists** (ADR 0029 §3). `reporterName` /
`reporterEmail` / `reporterPhone`, `sourceIp`, and `userAgent` are used only
transiently (verification is already done off-database, in the bucket's `verify/`
records); none becomes a database column or artifact field.

**5. v1 scope is `reportNew` only.** The other publication-content forms
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
2. **New run resolvers.** RunDataContext today has `resolvePersonnel` and
   `resolveCivilCase`; add `resolveAgency` and `resolveLocationPath`
   (resolve-or-fail, ADR 0023 — mapped source ids out, never canonical ids).
3. **acquire:** sync + AI-analyze-and-cache the verified submissions.
4. **run:** verified-`reportNew` traversal → resolve → AI gate → emit
   `Review`/`ReviewPersonnel` for publishable, review-report file for the rest.

Gated behind the full reconstruction rebuild (no new source runs before it); the
schema/specs/resolvers and scaffold land now, the source runs after.

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
