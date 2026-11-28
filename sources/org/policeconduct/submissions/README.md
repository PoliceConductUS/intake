# org/policeconduct/submissions

Intake source for user submissions captured by the website's `/report/new` (and
sibling) forms. Design: [ADR 0030](../../../../docs/adr/0030-user-submissions-as-an-intake-source.md),
report model: [ADR 0029](../../../../docs/adr/0029-align-the-public-report-model-to-the-report-new-form.md).

**Bucket** (synced to the local folder named by `SUBMISSIONS_BUCKET_DIR`; there
is no default, and both phases fail when it is not set):

- `submissions/<date>/<formName>/<id>.json` — one submission.
- `submissions/verify/<verificationId>.json` — email verification;
  **verified = `verifiedAt` set**.
- `submissions/status/<id>.json` — human review workflow.

**acquire** syncs the bucket folder with S3: it uploads the local folder, then
downloads the bucket. It runs no AI analysis.

**transform** reads `<SUBMISSIONS_BUCKET_DIR>/submissions`: every `reportNew`
submission, every `verify` record and every `status` record. The verdict it
applies is the `status` recorded in `submissions/status/`. It emits a `Review`
only for a verified, approved submission with at least one officer that
resolves and a usable location. An officer that does not resolve is left off
and reported as a finding on the `Review`. A submission that is verified and
not emitted is written to `review-report.json` in state with a reason code,
unless it is rejected. Every submission, verify record and status record is
counted in the row accounting. Submitter PII never persists, and no finding,
log line, error message or reason code holds submitter text.

## Overview

The source is active: `intake.source.ts:source` declares
`produces: ["Reviews", "ReviewPersonnel"]` and `standalone: true`, and both
phases are implemented.

## Interface

- `intake.source.ts:source` - the `IntakeSource` object:
  `{ produces: ["Reviews", "ReviewPersonnel"], standalone: true, acquire, transform }`.
- `acquire.ts:acquire` - `SourceAcquire`,
  `async ({ env, logger }) => Promise<void>`. Runs `aws s3 sync` from the local
  bucket folder to the S3 bucket, then from the S3 bucket to the local folder.
- `transform.ts:transform` - `SourceTransform`,
  `async ({ env, state, data, logger }) => Promise<SourceManifest>`. Returns
  `{ artifacts: [{ kind: "Reviews", records }, { kind: "ReviewPersonnel", records }], accounting }`
  and writes `review-report.json` to `state`. Each `Reviews` record is
  `{ metadata: { defects }, spec }`; `defects` is always present and is empty
  when the source has nothing to report on the record. The `Reviews` spec
  holds:
  - `id`, the `submissionId`.
  - `slug`, from the local `slugify` (not exported) of `<title>-<submissionId>`.
  - `title` and `description`, copied unchanged.
  - `incident_date`, `desired_outcome`, `charges` and `submitter_relationship`,
    each null when the submission field is blank.
  - `address`, `city`, `state` and `zip_code`, from the location that was
    used.
- `submissions.ts:readSubmissions` -
  `async (submissionsDir: string) => Promise<Submissions>`. Reads every
  `<submissionsDir>/<date>/reportNew/*.json`, `verify/*.json` and
  `status/*.json`, and lists the file names of the other form folders.
- `submissions.ts:Submissions` - type
  `{ reports, verifyRecords, statusRecords, otherFormSubmissionIds }`.
  `reports` holds every `reportNew` submission sorted by `receivedAt`,
  verified or not. `otherFormSubmissionIds` holds the file name, without
  `.json`, of every file in a form folder other than `reportNew`.
- `submissions.ts:ReportSubmission` - type
  `{ file, submissionId, receivedAt, title, description, location, officers, outcome, charges, incidentDate, relationship }`.
  `file` is the path relative to the submissions folder. It has no field for
  the reporter's name, email, phone, IP address, or user agent.
- `submissions.ts:OfficerRef` - type
  `{ name: string; badge: string; department: string }`, one officer named in a
  report.
- `submissions.ts:VerifyRecord` - type
  `{ file, verificationId, submissionId, formName, verified }`. `verified` is
  true when the file's `verifiedAt` is not null.
- `submissions.ts:StatusRecord` - type `{ file, status }` with either
  `submissionId` or `verificationId`.
- `submissions.ts:REPORT_FORM` - the string `reportNew`.

The other symbols named below (`s3Sync`, `readJson`, `parse`, `jsonFileNames`,
`EnvelopeSchema`, `ReportDataSchema`, `VerifySchema`, `StatusSchema`,
`deflattenOfficers`, `readReportSubmission`, `matchRecords`, `notSelected`,
`resolveOfficers`, `finding`, `locationHints`, `isGeocodable`,
`writeReviewReport`, `APPROVED` and `REJECTED`) are not exported.

## Invariants

- `acquire.ts:acquire` throws when `env.SUBMISSIONS_BUCKET_DIR` or
  `env.SUBMISSIONS_S3_BUCKET` is undefined or blank.
- `acquire.ts:acquire` pushes local changes to S3 before it pulls. A failed push
  is logged as `WARNING — write-back skipped` and does not throw; a failed pull
  rejects.
- `acquire.ts:s3Sync` never passes `--delete`; it adds `--profile` only when
  `env.AWS_PROFILE` is non-blank.
- `submissions.ts:readJson` lets a read error propagate and throws
  `org/policeconduct/submissions: <filePath> is not valid JSON.` for a file
  that does not parse. The message leaves out the parser's own text, which
  quotes the file content.
- `submissions.ts:parse` throws
  `org/policeconduct/submissions: <filePath> is not a valid <reportNew submission | verify record | status record>: <field>: <problem>`
  for a file that does not fit its schema.
- `submissions.ts:jsonFileNames` reads a missing `verify` or `status` folder as
  no records. Every other error from listing a folder propagates, and so does
  a missing folder anywhere else. A bucket with no `verify` folder is
  legitimate: the bucket holds `reportNew` submissions that have no verify
  record, and each is counted as `not verified`.
- `submissions.ts:EnvelopeSchema` requires each submission file to have a string
  `submissionId`, a string `receivedAt`, and a `payload` with a string
  `formName`. `submissions.ts:readSubmissions` parses every `reportNew` file,
  verified or not, so a malformed unverified file also throws.
- `submissions.ts:readReportSubmission` throws
  `<filePath> is in a reportNew folder but its payload.formName is not reportNew.`
  when `payload.formName` is not the folder name.
- `submissions.ts:readSubmissions` throws
  `<file> and <file> hold one submissionId.` when two `reportNew` files have
  the same `submissionId`.
- `submissions.ts:readSubmissions` takes only files whose name ends in `.json`
  and, under the submissions folder, only directories. A date folder with no
  `reportNew` folder gives no reports.
- `submissions.ts:deflattenOfficers` rebuilds the `officers` array from flat
  `officers[N][field]` keys, ordered by `N`, when `payload.data` has no
  `officers` array.
- `submissions.ts:ReportDataSchema` requires `payload.data` to be an object,
  defaults each absent field to `""` (`officers` to `[]`), and throws on a
  field value of the wrong type.
- `submissions.ts:VerifySchema` is strict. It requires `verificationId`,
  `submissionId` and `formName` as non-empty strings and `verifiedAt` as a
  non-empty string or null. It allows `usedAt`, `createdAt`, `expiresAt`,
  `sentAt`, `email`, `secretHash`, `providerMessageId` and `resendCount`, and
  rejects any other key. `submissions.ts:readSubmissions` carries none of the
  allowed-only fields into `submissions.ts:VerifyRecord`.
- `submissions.ts:StatusSchema` is strict. It requires a non-empty `status`
  and exactly one of `submissionId` and `verificationId`. It allows
  `statusChangedAt` and `decision` (`{ at, by, reason }`), and rejects any
  other key.
- `transform.ts:matchRecords` gives each `reportNew` submission its verify
  record and its status record. A status record is matched by its
  `submissionId`, or by its `verificationId` through the verify records. It
  throws, naming the files, when:
  - two verify records hold one `verificationId`, or are for one submission;
  - a verify record for a submission in a `reportNew` folder has another
    `formName`;
  - a verify record with `formName` `reportNew` is for a submission that is in
    no `reportNew` folder;
  - a status record names a verification that has no verify record;
  - two status records are for one submission;
  - a status record matches no `reportNew` submission and no file name in
    another form folder (`status record <file> matches no submission.`).
- `transform.ts:matchRecords` counts a verify record whose `formName` is not
  `reportNew`, and a status record whose submission is in another form folder,
  as not selected under `other form`.
- `submissions.ts:readReportSubmission` copies only the fields of
  `submissions.ts:ReportSubmission`; other keys in the file are not carried into
  the record.
- `transform.ts:transform` throws when `env.SUBMISSIONS_BUCKET_DIR` is undefined
  or blank, and when `data` or `data.resolveAgency` is undefined.
- `transform.ts:transform` gives each `reportNew` submission one outcome, in
  this order:
  - no verify record, or one that is not verified: not selected, `not verified`;
  - a status in `transform.ts:REJECTED` (`rejected`): not selected, `rejected`;
  - no status record: held, `no verdict`;
  - a status not in `transform.ts:APPROVED` (`approved` or `published`): held,
    with the status string as the reason;
  - no officer resolves: held, `approved but no officer resolved`;
  - no usable location: held, `approved but location not geocodable`;
  - otherwise the `Review` and its `ReviewPersonnel` records are emitted.
- A held submission is written to `review-report.json` with its reason and is
  counted as not selected under `held: <reason>`. A rejected or unverified
  submission is not in that file.
- `transform.ts:transform` states row accounting for three inputs:
  `reportNew submissions`, `verify records` and `status records`. The verify
  record and the status record of a `reportNew` submission are counted with
  the outcome of that submission, so `emitted` for those two inputs is the
  number of records whose submission was emitted. `reported` is always 0: the
  source leaves no row out with a finding.
- `transform.ts:resolveOfficers` leaves off an officer with a blank name or
  department (`officer-name-or-agency-blank`), an officer whose agency does not
  resolve (`officer-agency-not-found`), and an officer who does not resolve at
  that agency (`officer-not-on-agency-roster`). When the `Review` is emitted,
  each is a `warning` finding on it with the field `officers[<position>]`, the
  value null, and evidence `{ file, officer }` giving the submission file and
  the officer's position counted from 1. The finding does not hold the name or
  agency the submitter typed.
- `transform.ts:transform` uses `transform.ts:locationHints` when
  `transform.ts:isGeocodable` accepts them (city, state, and zip code all
  present), otherwise the location of the first resolved officer whose agency
  has a `location`, with the `warning` finding
  `location-replaced-by-agency-address` on the field `address`. With neither,
  the submission is held. The reason and the finding do not hold the
  submitter's location text.
- `transform.ts:transform` uses the `submissionId` as the `Reviews` record key
  and `spec.id`, and keys each `ReviewPersonnel` record
  `<submissionId>|<agencyPersonnelId>`.
- `transform.ts:writeReviewReport` writes a temporary file with mode `0o600` and
  renames it to `review-report.json`; on failure it removes the temporary file
  and rethrows.

## Side Effects

- `acquire.ts:acquire` - reads `env.SUBMISSIONS_BUCKET_DIR`,
  `env.SUBMISSIONS_S3_BUCKET`, and `env.AWS_PROFILE` from the `env` it is given.
- `acquire.ts:s3Sync` - runs the external `aws` command through `execFile`:
  `aws s3 sync <from> <to> --exclude *.DS_Store`. Called twice by
  `acquire.ts:acquire`: an upload to the S3 bucket, then a download into the
  local bucket folder.
- `acquire.ts:acquire` - syncs the root of the bucket folder, which holds the
  `submissions` folder.
- `transform.ts:transform` - reads `env.SUBMISSIONS_BUCKET_DIR` from the `env`
  it is given and reads only from `<SUBMISSIONS_BUCKET_DIR>/submissions`.
- `submissions.ts:readSubmissions` - files: reads the `reportNew`, `verify`
  and `status` JSON files under the submissions folder, and lists the other
  form folders without opening their files.
- `transform.ts:resolveOfficers` - calls `data.resolveAgency` and
  `data.resolvePersonnel` on the data context it is given.
- `transform.ts:writeReviewReport` - files: writes `<state>/review-report.json`.
  Its one top-level key is `heldOrRejected`, a list of entries that hold
  `submissionId`, `title`, and `reason`. Only held submissions are in the
  list; a rejected submission is never in it. `title` is the submitter's own
  title; `reason` is a reason code or the status string.
- `acquire.ts:acquire`, `transform.ts:transform` - logging through
  `logger?.info`. `transform.ts:transform` logs the number published and the
  number held.

## Verification

- Run: `npx vitest run test/sources/org/policeconduct/submissions`
