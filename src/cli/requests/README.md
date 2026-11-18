# requests

## Overview

Registers the `requests` command group, which submits periodic records
requests and synchronizes the replies:

- `requests submit <source>` with `--force` (override the 90-day submission
  interval).
- `requests status [source]` with `--json`.
- `requests sync [source]` with `--request-id <id>` and `--email-id <id>`,
  which must be given together.

A request is kept as a `RecordsRequest` envelope in the source's namespace
state. A request is sent by email through Resend, or through a portal form
driven by Playwright. Replies are fetched from Resend and classified with
Anthropic.

## Interface

- `index.ts:registerCliCommand` - `(program, dependencies)`; registers
  `requests`.
- `lifecycle.ts:requestDefinitionSchema` - schema for a source's `request`
  export; type `RequestDefinition`.
- `lifecycle.ts:RequestStore` - `new RequestStore(workspace)`; `directory`,
  `lock`, `list`, `save`, `importHistory`, `importUnlocked`.
- `lifecycle.ts:submit` - `(store, options: SubmitOptions)` returns a
  `RecordsRequestEnvelope`.
- `lifecycle.ts:SubmitOptions` - `sourceId`, `definition`, `now`, `force`,
  `from`, `receivingAddress`, `requester`, `standard`, `send`, and optional
  `portalContact` and `sendPortal`.
- `lifecycle.ts:assertCanSubmit` - `(rows, now, force)`.
- `lifecycle.ts:eligibility` - `(submitted, now, force)` returns
  `{ eligible, next }`. `next` is 90 days after `submitted`; a date-only
  `submitted` counts from the end of that day (`T23:59:59.999Z`).
- `lifecycle.ts:SubmissionRejectedError` - marks a send known not to have
  been delivered.
- `lifecycle.ts:digest` - sha256 hex of bytes or a string.
- `portal.ts:portalFormSchema` - schema for a source's `portalForm` export;
  type `PortalForm`.
- `portal.ts:portalProfileSchema` - re-export of `portalContactSchema` from
  `src/shared/io/RecordsRequest.ts`; type `PortalProfile`.
- `portal.ts:PortalPage` - the page methods `submitPortal` calls.
- `portal.ts:PortalBrowser` - `{ page, close() }`; what `openBrowser`
  returns.
- `portal.ts:submitPortal` -
  `(id, payload, profile, form, { evidenceDirectory, openBrowser? })` returns
  `{ id, evidence }`. The returned `id` is `portal-confirmation:<id>`.
- `resend.ts:Resend` - `new Resend(key, http = fetch)`; `send`, `list`,
  `receive`.
- `resend.ts:ReceivedMessage` - `{ message, json, raw, files }`; what
  `Resend.receive` returns.
- `responses.ts:createAnalyzer` - `(apiKey, model)` returns a function from
  text to `Analysis`.
- `responses.ts:Analysis` - `disposition`, `quote`, `recordAttachmentIds`,
  `productionComplete`, `agencyReference`, `referenceQuote`.
- `responses.ts:validateAnalysis` - `(input, text)` returns `Analysis`.
- `responses.ts:correlate` - `(text, rows)` returns a request ID only when
  exactly one row matches.
- `responses.ts:syncMessages` -
  `(store, sources, inbox, receivingAddress, analyze, associations?)`.

## Invariants

- `index.ts:registerCliCommand` - every error an action throws is caught
  and returned as exit code 1 with the message on stderr. The actions throw:
  - `Portal has no verified form definition` when `submit` is run for a
    source whose channel is `portal` and that exports no `portalForm`.
  - `--request-id and --email-id must be supplied together` when `sync` has
    only one of them.
  - `Request ID does not exist in selected sources` when `sync` has a
    `--request-id` that no selected source holds.
- `index.ts:required` (not exported) - throws `<NAME> is required` when the
  environment value is blank.
- `index.ts:loadSources` (not exported) - only sources with a `request`
  export; throws `No request source` for a named source without one.
- `lifecycle.ts:requestDefinitionSchema` - `.strict()` at every object level.
- `lifecycle.ts:RequestStore.lock` - an existing `.lock` directory throws;
  the lock is not removed automatically after an interrupted operation.
- `lifecycle.ts:RequestStore.list` - throws `Request namespace mismatch` when
  `metadata.namespace` differs from the source.
- `lifecycle.ts:submit`:
  - A row whose submission is `failed` is sent again with its saved payload;
    no new request is created.
  - Throws `Portal has no verified submission adapter: <url>` when the
    channel is `portal` and `sendPortal` is absent.
  - Throws `Portal contact email must match the receiving address` when the
    portal contact's email differs from `receivingAddress`.
- `lifecycle.ts:RequestStore.importUnlocked` - throws
  `Historical request changed` when a saved historical row differs from the
  definition.
- `lifecycle.ts:assertCanSubmit` - throws on any row whose submission is
  `reserved` or `uncertain`, and when the latest submission is under 90 days
  old and `force` is false.
- `lifecycle.ts:sendReserved` (not exported) - throws
  `Request has no saved payload` when the row has no payload, and
  `Portal has no verified submission adapter` when the row's transport is
  `portal` and `sendPortal` is absent; both leave the row unchanged. A
  `SubmissionRejectedError` from the send sets the submission to `failed`;
  any other error sets it to `uncertain`; the error is rethrown.
- `portal.ts:portalFormSchema` - `.strict()`; requires a `fill` action for
  `requestText`.
- `portal.ts:submitPortal`:
  - Throws `Portal contact email must match the receiving address` when the
    profile's email differs from the payload's `reply_to`.
  - Throws `Portal destination differs from saved payload` when the
    payload's `to` differs from the form's `url`.
  - Throws when a blocker is visible, when a field reads back a different
    value, and when the confirmation text differs from `successText`.
  - Every error raised before the click on the submit target is rethrown as
    a `SubmissionRejectedError`, so the request becomes `failed`. An error
    raised from the click onward is rethrown unchanged, so the request
    becomes `uncertain`.
- `resend.ts:Resend` - the constructor throws `Resend API key required` on a
  blank key.
- `resend.ts:Resend.request` (private) - a non-OK response throws; a POST
  with status 400, 401, 403, 404, 422 or 429 throws
  `SubmissionRejectedError`. Each call has a 60000 ms timeout.
- `resend.ts:Resend.send` - sets the `Idempotency-Key` header to the request
  ID.
- `resend.ts:Resend.list` - throws `Resend pagination repeated a message`
  when a page repeats a message ID, and
  `Resend pagination returned empty continuation` when a page has `has_more`
  and no message.
- `resend.ts:Resend.receive` - throws `Resend message ID mismatch` when the
  returned message has a different ID, and `Raw email unavailable` when `raw`
  is null.
- `resend.ts:Resend.download` (private) - throws
  `Resend evidence download failed: <status>` on a non-OK response. Each call
  has a 60000 ms timeout.
- `responses.ts:validateAnalysis` - throws
  `Analysis quote is absent from response` unless `quote` is a substring of
  the reply text. When `agencyReference` is set, it throws
  `Agency reference quote is absent from response` unless `referenceQuote` is
  set, is a substring of the reply text, and contains `agencyReference`.
- `responses.ts:createAnalyzer` - the Anthropic client has `maxRetries: 0`
  and each call has `max_tokens: 2048`. It throws
  `No reply analysis returned` when the response has no text block.
- `responses.ts:syncMessages`:
  - A message not addressed to the receiving address is left out: no file is
    written and the report has no entry for it.
  - A message that matches no request, or more than one, is written to disk
    and reported as `unmatched-or-ambiguous`.
  - Throws `Association request is outside selected sources` when
    `associations` names a request that no selected source holds.
  - Throws `Analysis names an unavailable record attachment` when
    `recordAttachmentIds` has an ID that is not among the message's files.
  - Throws `Uncertain request has no persisted attempt timestamp` when a
    `reserved` or `uncertain` request with no `attemptedAt` gets a reply
    whose disposition is not `unclear`.

## Side Effects

- `index.ts:registerCliCommand` - the module wraps `process.env` with
  `withParameterStoreSecrets` when it loads. It reads `INTAKE_WORKSPACE`,
  `RESEND_API_KEY`, `RESEND_API_KEY_FULL_ACCESS`, `ANTHROPIC_API_KEY`,
  `ANTHROPIC_MODEL`, `RECORDS_REQUEST_CONTACT`, `RECORDS_REQUEST_FROM`,
  `RECORDS_REQUEST_RECEIVING_ADDRESS` and `RECORDS_REQUEST_REQUESTER`.
- `index.ts:registerCliCommand` - all three subcommands call
  `store.importHistory`, so `status` writes too. `submit` reads
  `<cwd>/docs/data-request-format.md`.
- `index.ts:loadSources` (not exported) - imports every source under
  `<cwd>/sources` through `discoverSources`.
- `lifecycle.ts:RequestStore.list` - creates the `RecordsRequest` directory
  when it is absent.
- `lifecycle.ts:RequestStore.save` - writes a `RecordsRequest` envelope under
  `$INTAKE_WORKSPACE/intake/state/namespaces/<source>/RecordsRequest/`.
- `lifecycle.ts:RequestStore.lock` - creates and removes the `.lock`
  directory there.
- `lifecycle.ts:submit` - mints the request ID with cuid2 `createId()`.
- `portal.ts:openBrowser` (not exported) - imports `playwright` and launches headless
  Chromium.
- `portal.ts:submitPortal` - submits the portal form over the network; writes
  `evidence/<id>/portal-confirmation.png` and `portal-confirmation.json`.
- `resend.ts:Resend.request` (private) - HTTPS calls to `https://api.resend.com`.
- `resend.ts:Resend.download` (private) - HTTP GET of the attachment download URLs
  Resend returns.
- `responses.ts:createAnalyzer` - Anthropic `messages.create` call.
- `responses.ts:syncMessages` - writes `message.json`, `message.eml` and the
  attachments under
  `$INTAKE_WORKSPACE/intake/state/records-request-inbox/<email id>/`; updates
  `RecordsRequest` envelopes.

## Verification

- Run: `npx vitest run test/requests`
