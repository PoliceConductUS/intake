# org.policeconduct.submissions

Intake source for user submissions captured by the website's `/report/new` (and
sibling) forms. Design: [ADR 0030](../../docs/adr/0030-user-submissions-as-an-intake-source.md),
report model: [ADR 0029](../../docs/adr/0029-align-the-public-report-model-to-the-report-new-form.md).

**Bucket** (synced to a sibling folder of the repo,
`../policeconduct-submissions-942370948729`, override with
`SUBMISSIONS_BUCKET_DIR`):

- `submissions/<date>/<formName>/<id>.json` — one submission.
- `submissions/verify/<verificationId>.json` — email verification;
  **verified = `verifiedAt` set**.
- `submissions/status/<id>.json` — human review workflow.

**acquire** syncs the bucket and runs the AI analysis for each verified
submission, caching the verdict per submission (network + non-determinism stay
here).

**run** traverses only verified `reportNew` submissions, resolves
officer@agency / location / civil case (resolve-or-fail), applies the cached AI
verdict as a high publication bar, and emits a `Review` only when it clears the
bar and anchors to a real officer. Everything else → the run-output review-report
file. Submitter PII never persists.

## Status: scaffold

Not yet active (`produces: []`). Pending, in order:

1. `Review` + `ReviewPersonnel` entity descriptors (regenerate specs/mutations/facades/resolvers).
2. `resolveAgency` + `resolveLocationPath` on RunDataContext.
3. acquire: sync + AI-analyze-and-cache verified submissions.
4. run: resolve → AI gate → emit `Review`/`ReviewPersonnel`, else review-report file.
