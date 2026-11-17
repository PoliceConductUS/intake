# Design: one cache for call results and files, reached through shared service clients

Related documents: [proposal](proposal.md), [cache spec](specs/call-and-file-cache/spec.md), [service clients spec](specs/service-clients/spec.md), [Minnesota POST spec changes](specs/mn-post-discipline-orders/spec.md), [tasks](tasks.md), [ADR 0039](../../../docs/adr/0039-the-cache-holds-call-results-and-files.md), [ADR 0019](../../../docs/adr/0019-cache-resolved-properties-validate-at-the-mutation-boundary.md).

## Problem statement

Intake calls outside services (CourtListener, the Anthropic API, websites that serve documents) and keeps what they return. Three parts of intake each keep that material in a cache of their own design:

| Part                  | What it keeps                  | Where                                              | Keyed by                                           |
| --------------------- | ------------------------------ | -------------------------------------------------- | -------------------------------------------------- |
| CourtListener source  | Search results per agency      | `<source state>/docket-cache.json`                 | Agency name                                        |
| CourtListener source  | Complaint summaries            | `<source state>/complaint-summaries/<hash>.json`   | A hash of document, text, model and prompt version |
| CourtListener source  | Hand-review results            | `<source state>/complaint-reviews/`                | Document ID and PDF hash                           |
| CourtListener source  | Docket entries, complaint PDFs | Each command folder                                | Docket ID                                          |
| Minnesota POST source | Order text and analysis        | `<source state>/documents/<sha256>.json`           | PDF hash                                           |
| Minnesota POST source | Order PDFs                     | Each command folder                                | Case number and URL hash                           |
| `photo` command       | Photo files                    | `<workspace>/assets/PersonnelPhoto/<sha256>.<ext>` | File hash                                          |

A source state folder is `<workspace>/state/<source id>/`. A command folder is `<workspace>/command/<timestamp>-<command>/<source id>/output/`.

This causes four failures:

1. **A failed call is not remembered.** It is tried again on every run, or it stops the run. On 2026-11-16 one file that failed a check stopped a CourtListener acquire of about 8,300 dockets.
2. **A call cannot be reproduced.** Nothing records the model, the parameters or the prompt that produced a result.
3. **Files are downloaded again.** PDFs live in a command folder, so the next command downloads them again, and a resumed command copies the whole previous folder.
4. **The same logic is written several times.** Each source has its own retry loop, its own request log and its own idea of when a result is stale.

The one cache intake does own, the resolved-property cache of ADR 0019, cannot hold this material as it is, for two reasons only: it stores the value of one property of one record, and its values are YAML, not files.

## Goals

- One cache holds every call result and every file intake keeps.
- A failed call is recorded with what is needed to reproduce it and when to try again.
- A source or stage that needs a service is handed a client for it. The client is written once.
- A failure of one item never stops a command. A failure of a service stops it at once, with the reason.

## Non-goals

- Changing the resolved-property cache's rules. ADR 0019 stands.
- Moving the Clearinghouse and YouTube sources' request logs or the YouTube `video-cache.json`. They are not among the three caches this change removes.
- Syncing the workspace to S3. That is a policeconduct.org command run after `data generate`.
- Deleting anything from the cache. Nothing in this design removes an envelope or a file.

## Terms

- **Cache**: the envelopes under `<workspace>/state/intake/namespaces/intake/`. Today it holds `ResolvedProperty` envelopes in a folder of that name.
- **Envelope**: a YAML file with `apiVersion`, `kind`, `metadata` and `spec`, read and written only through that kind's own code.
- **Request**: the description of one call. It holds what decides the answer and nothing else.
- **Fingerprint**: the SHA-256 of a value's stable JSON (object keys sorted), as `typedInputFingerprint` computes it today in `src/cli/state/resolved-property/index.ts`.
- **Outcome**: what one attempt at a request produced: a response, or an error.
- **Client**: shared code that makes calls to one outside service through the cache.
- **Resolver**: code in the shared import that works out the value of one field of a record during `data generate`.
- **Item failure** and **outage**: defined in section 4.

## Proposed architecture

### Overview

```
source acquire ──┐
                 ├──> client (one per service) ──> cache: CallResult, BinaryFile
resolver in      │        │
data generate ───┘        └──> outside service (only when the cache has no standing outcome)
```

A caller builds nothing itself. It asks a client for something ("the entries of docket 123", "this file", "a summary of this text with this prompt"). The client builds the request, looks in the cache, calls the service only if it must, records the outcome, and returns either the result or a failure the caller can act on.

### 1. `CallResult`

Location: `<workspace>/state/intake/namespaces/<namespace>/CallResult/<fingerprint>.CallResult.yaml`. The name is the fingerprint of `spec.request`.

`spec.request`:

| Field        | Meaning                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `service`    | The outside service, for example `courtlistener`, `anthropic`, `download`, `pdf-text`                 |
| `operation`  | What was asked, for example `docket-entries`, `messages`, `get`                                       |
| `url`        | The full URL, for an HTTP call                                                                        |
| `model`      | The model ID, for a model call                                                                        |
| `parameters` | Everything else that decides the answer: query parameters, max tokens, reasoning level, output schema |
| `prompt`     | The prompt text, for a model call                                                                     |
| `inputs`     | A list of `{ name, sha256 }` for each document or text sent                                           |

`spec.outcomes` is a list. Each outcome:

| Field                                            | Meaning                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `status`                                         | `succeeded` or `failed`                                                                                    |
| `startedAt`, `completedAt`                       | ISO 8601 times                                                                                             |
| `response`                                       | The parsed response, for a success with a JSON answer                                                      |
| `file`                                           | The SHA-256 of the binary file, for a success whose answer is a file                                       |
| `error`                                          | `{ kind, message }`, for a failure. `kind` is `item` or `service`                                          |
| `httpStatus`, `requestId`, `stopReason`, `usage` | As the service gave them                                                                                   |
| `retryAfter`                                     | When to call again; absent means never for this request                                                    |
| `producedBy`                                     | Absent for a call intake made. Set only on outcomes moved from an earlier cache, to say what produced them |
| `commandId`, `intakeVersion`                     | Which command made the call and which commit of intake                                                     |

The request never holds an API key, an `Authorization` header or a cookie. The client adds those when it calls.

### 2. `BinaryFile`

Location: `<workspace>/state/intake/namespaces/<namespace>/BinaryFile/<sha256>.BinaryFile.yaml`, with the bytes beside it as `<sha256>.<extension>`.

`spec`: `sha256`, `bytes`, `contentType`, `extension`, and `origin`, which is either `{ kind: download, url, retrievedAt, httpStatus }` or `{ kind: local, filename, importedAt }`.

The name is the content's hash, so the same file from two URLs is stored once, and a file is never overwritten by a different one. A file that later fails a caller's check (for example, it is not the document its publisher said it was) stays in the cache: it is the evidence of what was served. Reading a binary file hashes it again and fails if the hash is not its name.

Writes are ordered so that a crash leaves nothing half-described: the file is written to a temporary name and renamed, then the envelope is written the same way. An envelope without its file, or a file without its envelope, fails the read.

`<namespace>` in both locations is the namespace of the source whose record or acquire asked for the call or the file, so an entry's path is `<namespace>/<Kind>/<name>`. The same file asked for by two sources is stored once under each. That costs some disk and keeps each source's material together, which is how the rest of the workspace state is laid out.

### 2a. A binary file is a record, and other records point at it

`BinaryFile` is also a record kind with a table, `binary_file`: its ID, SHA-256, extension, content type and byte count. Its ID is a cuid resolved through the source-name mapping like every other record's, with the SHA-256 as its source name, so the same file has the same ID on every run.

A record that has a file points at the file's record with a foreign key, resolved by the standard foreign-key resolver. Nothing else about the file is copied onto the pointing record, and no path is stored anywhere. The file's path in the workspace follows from the file's own record. Where the file is published is not intake's decision.

**`PersonnelPhoto` is retired.** Everything it holds except the person it belongs to is a fact about the file: the path, hash, type, size, and where it came from. `Personnel` gains one field, `photo_id`, pointing at a `BinaryFile`. Where the file came from (the local file name, the source URL) is optional information on the file's own spec. `intake file import <file>` stores any file and prints its key, the SHA-256 and extension; attaching the file to a person is a separate manual update that sets the person's photo field to that key. The published path is lower case with a dash, `/binary-file/`, because that reads better in an address; the workspace folder keeps the kind's exact name, `BinaryFile`.

**The website's build has one file service, and a renderer only asks it for a reference.** A component that renders HTML does not copy a file or work out an address. It asks the build's file service for a reference to the file a record points at. The service answers with the address the page should use, and by being asked it learns that the build references that file. Any other renderer that asks for the same file gets the same address. The service, not the renderer, writes each referenced file to the place its address names. A file nothing asked for is not published.

For now the address is root-relative, `/binary-file/<sha256>.<extension>`, and the files are part of the build output. Later the files are served from their own subdomain: the upload step sends the site to one bucket, under a folder for the commit and build, and the referenced files to another bucket, under a folder for the same commit and build, that backs the subdomain. Because renderers only ever hold what the file service handed them, that change is made in the file service and the upload step alone.

File management is one part of the resolver backend, the object every resolver is already handed. It offers: store these bytes or download this URL and give back the file's record; and, for a file, the envelope, the bytes, or the workspace path.

**Two files never share a name by accident.** A file's name is the full SHA-256 of its bytes. Before writing, the store checks whether a file of that name exists; if it does, it compares the bytes, and if they differ it fails naming both and writes nothing. A read hashes the file again and fails if the hash is not its name.

### 3. When a call is made again

One rule, for successes and failures alike:

1. No envelope for this request: call.
2. The current outcome has no `retryAfter`: it stands. Do not call.
3. The current outcome's `retryAfter` is in the future: it stands. Do not call.
4. The current outcome's `retryAfter` has passed: call, and append the new outcome.

A caller sets `retryAfter` on a success when the answer can go stale (a search result, a docket's entries). A client sets it on a failure when waiting can help. A changed document, model, parameter or prompt changes the request, so it changes the fingerprint and is a new envelope. Nothing is invalidated by hand.

**A rebuild does not refresh.** `data reset --no-acquire` rebuilds the database from what is already held. During it, a successful outcome is used as it is even when its `retryAfter` has passed, so a reset alone calls no service for anything already in the cache. Only a request with no successful outcome is called: a new case, or one that failed before. Refreshing stale results is the job of an ordinary `data generate`.

### 4. Item failures and service outages

| What happened                                                                                            | Sort                  | What the client does                                                                                           |
| -------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| 4xx other than 429 for one URL                                                                           | Item                  | Record a failed outcome with no `retryAfter`; return the failure                                               |
| Model refuses, hits its token limit, or returns an answer that does not fit the schema                   | Item                  | Same                                                                                                           |
| The check before the first call gets no answer, or 401 or 403                                            | Outage at the start   | Do not start: stop the command before any record is processed; record nothing                                  |
| During the run: no answer within the timeout, a connection error, or 429 or 5xx that outlast the retries | Outage during the run | Record a failed outcome with `retryAfter`; mark the service down for the rest of the command; return "skipped" |

An item failure is returned to the caller as a value. What the caller does with it (report a finding on the record, per ADR 0040) is the caller's business.

**An outage at the start stops the command.** Each client checks its service before its first call. If the service does not answer, or rejects the key, nothing is processed.

**An outage during the run is a skip, not a stop and not a finding.** The client returns "skipped" for that call and for every later call to that service in the same command, without trying the service again. The caller leaves alone whatever that call would have filled: no value is written, no existing value is changed, and no finding is reported, because nothing is wrong with the record. The command carries on with everything that does not need that service and ends normally. Its last lines name the service that went down, the time it went down, how many calls were skipped, and the time to try again. The next run makes the skipped calls.

A skip happens only for an outage. Every other failure is an item failure.

A 403 for one file from a file host, after the check before the first call succeeded, is an item failure: some hosts answer 403 for a file that does not exist.

`retryAfter` for an outage is the service's `Retry-After` when it gives one, and otherwise one hour after the failure.

The existing catch in the CourtListener agency search that logs "search failed, skipped" for any error is removed: an outage is handled by the client as above, and anything else is a defect that should fail.

### 5. Clients

All in `src/shared/services/`, built on one base that does sections 3 and 4:

| Client                | Operations                                                                                    | Used by                                     |
| --------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `CourtListenerClient` | Search dockets by party; list a docket's entries                                              | CourtListener acquire; civil case resolvers |
| `InferenceClient`     | Ask a model for a structured answer about a text                                              | Civil case resolvers; discipline resolvers  |
| `DownloadClient`      | Get a file by URL, optionally with a caller-supplied fetch (Minnesota uses a browser session) | Any                                         |
| `PdfTextClient`       | Extract a PDF's text page by page, with OCR for a page with no text layer                     | Any                                         |

`PdfTextClient` is the Minnesota source's existing `document-text.ts` moved to shared code. It is treated as a service because it runs outside programs (`pdfinfo`, `pdftotext`, `pdftoppm`, `tesseract`) and its result is worth caching by the file's hash.

Each client has a `check()` that the base runs once per command before the client's first call. `CourtListenerClient` and `InferenceClient` call an endpoint that needs their key.

Clients are constructed in one place per command and passed down: to a source's acquire through the acquire dependencies, and to resolvers through the resolver backend that the import already passes (`resolverBackend` in `src/cli/import/artifacts/data-context.ts`).

### 6. Keys in `data generate`

`data generate`, `data update` and `data reset` pass `process.env` to the import today. They pass `withParameterStoreSecrets(process.env)` instead, as `data acquire` does. A key is read only when a client makes its first call.

### 7. Moving what exists

`intake cache migrate` reads the old locations and writes cache envelopes. It is run once per workspace and changes nothing on a second run.

| From                                                      | To                                                                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| CourtListener `docket-cache.json`                         | One `CallResult` per agency search, `retryAfter` 120 days after its `lastSearchedAt`                                                      |
| CourtListener entries and PDFs in its last command folder | `CallResult` per docket's entries; `BinaryFile` per PDF                                                                                   |
| Minnesota order PDFs in command folders                   | `BinaryFile` per distinct file                                                                                                            |
| Minnesota `documents/<sha256>.json` text                  | `CallResult` for `pdf-text` with that file as input                                                                                       |
| Minnesota `documents/<sha256>.json` analysis              | `CallResult` for `anthropic` with the request `data generate` will compute; `producedBy: codex-document-review` when a review produced it |
| `assets/PersonnelPhoto/<sha256>.<ext>`                    | `BinaryFile`, origin `local`                                                                                                              |

The command reports what it moved and anything it could not match. It does not delete the old files; removing them is a separate step after the reset is verified.

## Alternatives considered

- **Record a failure as an absent value in `ResolvedProperty`.** Rejected: ADR 0019 forbids caching an absent value, because it would look like a hit and hide a later correction.
- **Add failure records to each source's own cache.** Rejected: the four failures above would each be fixed three times.
- **One envelope kind for both calls and files.** Rejected: a photo imported from disk is a file with no call, and a file is identified by its content while a call is identified by its request.
- **Publish files under one folder such as `/files/`.** Rejected by the owner: the published path should match where the file is kept, `<Kind>/<name>`.
- **Store a workspace path and a published path on each record that has a file.** Rejected: both follow from the file's hash and extension, so storing them repeats a fact.
- **Keep `PersonnelPhoto` and repeat the file's hash and type on it.** Rejected: every kind with a file would repeat those columns, and the website would need to know each such kind to find its files.
- **Name a binary file by its URL.** Rejected: the same URL can serve different bytes over time, and one would overwrite the other.
- **Expire entries by age only.** Rejected: an unchanged complaint never needs summarizing again, and a failed download should be retried sooner than a search result goes stale. `retryAfter` per outcome covers both.
- **Let each source wrap the cache.** Rejected: that is the duplicated logic of failure 4.

## Risks and mitigations

| Risk                                                                                               | Mitigation                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The cache grows without limit: about 530 Minnesota PDFs today, and one PDF per imported civil case | Report the cache's size at the end of `intake cache migrate` and of `data reset`. No deletion in this change; a retention rule is a later decision.                                             |
| A response too large to keep inline in YAML (a docket with hundreds of entries)                    | A JSON response over 256 KB is stored as a binary file and named in `file`, like any other file.                                                                                                |
| A request that leaves out something that decides the answer returns a stale result                 | Each client's request is built in one function with a test that changing each deciding input changes the fingerprint.                                                                           |
| A moved Minnesota analysis is not found by `data generate`, so 89 documents are analyzed again     | `intake cache migrate` builds the request with the same function `data generate` uses, and a test asserts the lookup hits.                                                                      |
| A service goes down partway through a long command                                                 | The command finishes everything that does not need the service and reports what it skipped. The cache keeps what was done; the next run makes only the skipped calls.                           |
| A key or cookie ends up in a cached request                                                        | The base client builds the stored request from an allow-list of fields; a test asserts a request with an `Authorization` value is rejected.                                                     |
| Personnel photo rows point at a path that no longer exists                                         | The migration and the move are checked together: a task asserts every row's file exists after both. The website build already fails when a photo's file is missing or its hash or size differs. |
| The website reads `personnel_photo`, which this change drops                                       | The policeconduct.org change is made and released with this one; its schema contract check fails the build if the two are out of step.                                                          |
| Two different files with the same SHA-256                                                          | Not expected to occur, and not assumed: a write that finds the name taken compares the bytes and fails if they differ.                                                                          |

## Implementation Plan

Paths are from the repository root. Each step ends with `npm run validate` passing.

**Phase 1: the two kinds and the store.**

1. Create `src/shared/io/CallResult.ts` and `src/shared/io/BinaryFile.ts`: strict zod schemas as in sections 1 and 2, `new`, `read`, `write`, built on `yamlResourcePath` in `src/shared/io/resource.ts`. Export both from `src/shared/io/index.ts`. Add both to the envelope strictness test (`test/shared/io/envelope-strictness.test.ts`).
2. Create `src/cli/state/call-cache/index.ts`: `readCallResult(request)`, `appendOutcome(request, outcome)`, `standingOutcome(envelope, now)` (section 3), `readBinaryFile(sha256)`, `writeBinaryFile(bytes, origin)`. Move `typedInputFingerprint` to `src/shared/io/fingerprint.ts` and import it from both stores. Tests in `test/cli/state/call-cache.test.ts`: each branch of section 3; write order; hash mismatch on read.

**Phase 2: clients.**

3. Create `src/shared/services/client-base.ts`: `cachedCall(request, call, options)` implementing sections 3 and 4, returning a result, an item failure or "skipped"; the once-per-command check, which stops the command when the service is down at the start; the per-command "service down" mark; retries with `Retry-After`, and the request allow-list. Time and `fetch` are injected. Tests in `test/shared/services/client-base.test.ts`: one test per row of the section 4 table.
4. Create `src/shared/services/download-client.ts`, `inference-client.ts`, `courtlistener-client.ts`, `pdf-text-client.ts`. Move `sources/com/site/my/mnitservices/post-license-search/acquire/document-text.ts` into `pdf-text-client.ts`. Move the CourtListener search and entries requests out of `sources/com/courtlistener/www/api/acquire.ts` and `summary-acquisition.ts` into `courtlistener-client.ts`. Tests beside each.
5. Modify `src/cli/data/index.ts` and `src/cli/data/source-pipeline.ts` to pass `withParameterStoreSecrets(process.env)`. Modify `src/cli/import/artifacts/config.ts` (where `agencyResolutionDeps` builds the geocoder) to build the clients and `src/cli/import/artifacts/data-context.ts` to expose them on the resolver backend. Modify `src/cli/acquire/index.ts` to build the clients and add them to `AcquireDeps`. Update `openspec/changes/read-acquire-tokens-from-parameter-store/specs/acquire-secrets/spec.md` to name the three commands.

**Phase 3: sources.**

6. CourtListener acquire: replace `docket-cache.ts` and the `fetchJson` in `acquire.ts` with `CourtListenerClient`. Delete `docket-cache.ts`, the `.api-calls.jsonl` write and the agency search catch. The complaint steps are removed here and added back as resolvers in `move-complaint-summaries-to-generate`.
7. Minnesota POST: `collect-documents.ts` downloads through `DownloadClient` with its browser fetch and writes a document reference; delete the text and analysis passes, the `documents/` state cache and `document-evidence.ts`'s PDF checks that the cache now does. Add discipline resolvers that use `PdfTextClient` and `InferenceClient`. This step needs its own design section before it is started: the discipline fields are source values today, and making them resolver-filled changes the Minnesota transform.
8. Files as records and photos: add the `BinaryFile` entity and `Personnel.photo_id` to the descriptors in `scripts/lib/entity-spec-generator.ts`; write one Supabase migration that creates `binary_file`, adds `personnel.photo_id`, moves each `personnel_photo` row into them with explicit IDs, and drops `personnel_photo` (following the `empty-table-retirement` spec for a retired table). `src/cli/photo/store.ts` stores the photo through the backend's file store, and `src/cli/photo/prepare.ts` records a manual update of the person's `photo_id`. Update `test/cli/personnel-photo.test.ts`. The website's photo staging in `src/lib/personnel-photos.js` and `src/lib/personnel-photo-files.js` then reads the file's record and copies referenced files to `/binary-file/<sha256>.<extension>`; that edit is in policeconduct.org.

**Phase 4: move and verify.**

9. Create `src/cli/cache/migrate.ts` and register `intake cache migrate` in `src/cli/cache/index.ts`. Tests in `test/cli/cache-migrate.test.ts` with a fixture workspace: each row of the section 7 table; a second run changes nothing.
10. Run `intake cache migrate` on the dev workspace, then `data reset`, and report calls made, calls served from the cache, failures by service and the cache's size. This step needs the owner's go-ahead before it is run.
