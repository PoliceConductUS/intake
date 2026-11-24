# Design: one cache for call results and files, reached through shared service clients

Related documents: [proposal](proposal.md), [cache spec](specs/call-and-file-cache/spec.md), [service clients spec](specs/service-clients/spec.md), [Minnesota POST spec changes](specs/mn-post-discipline-orders/spec.md), [data request document spec changes](specs/data-request-document/spec.md), [tasks](tasks.md), [ADR 0039](../../../docs/adr/0039-the-cache-holds-call-results-and-files.md), [ADR 0019](../../../docs/adr/0019-cache-resolved-properties-validate-at-the-mutation-boundary.md), [ADR 0040](../../../docs/adr/0040-sources-and-resolvers-report-findings-that-become-annotations.md).

## Problem statement

Intake calls outside services (CourtListener, the Anthropic API, websites that serve documents) and keeps what they return. Three parts of intake each kept that material in a cache of their own design:

| Part                  | What it keeps                                                                                                        | Where                                              | Keyed by                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| CourtListener source  | Search results per agency                                                                                            | `<source state>/docket-cache.json`                 | Agency name                                        |
| CourtListener source  | Complaint summaries                                                                                                  | `<source state>/complaint-summaries/<hash>.json`   | A hash of document, text, model and prompt version |
| CourtListener source  | Hand-review results                                                                                                  | `<source state>/complaint-reviews/`                | Document ID and PDF hash                           |
| CourtListener source  | Docket entries, complaint PDFs                                                                                       | Each command folder                                | Docket ID                                          |
| CourtListener source  | Each API call and its answer                                                                                         | `.api-calls.jsonl` in each command folder          | None: a log, never read back                       |
| Minnesota POST source | Order text, and an analysis when one was made (the 89 files in the dev workspace hold text only, checked 2026-11-18) | `<source state>/documents/<sha256>.json`           | PDF hash                                           |
| Minnesota POST source | Order text and analysis                                                                                              | `documents/*.document.json` in each command folder | One file per document                              |
| Minnesota POST source | Order PDFs                                                                                                           | Each command folder                                | Case number and URL hash                           |
| `photo` command       | Photo files                                                                                                          | `<workspace>/assets/PersonnelPhoto/<sha256>.<ext>` | File hash                                          |

`<workspace>` is the folder `INTAKE_WORKSPACE` names. A source state folder is `<workspace>/state/<source id>/`; a source ID is the source's namespace. A command folder is `<workspace>/command/<timestamp>-<command ID>/<source id>/output/`, where the command ID is a cuid2.

The CourtListener rows describe the code before this change; its acquire no longer reads or writes those files (tasks). The `complaint-summaries/` and `complaint-reviews/` folders exist in no workspace (checked 2026-11-18 in `dev`, `dev-copy`, `preview` and `prod`), so the move in section 7 has nothing of theirs to carry; complaint summaries are made in `data generate` by `move-complaint-summaries-to-generate`.

This causes four failures:

1. **A failed call is not remembered.** It is tried again on every run, or it stops the run. On 2026-11-16 one file that failed a check stopped a CourtListener acquire of about 8,300 dockets.
2. **A call cannot be reproduced.** Nothing records the model, the parameters or the prompt that produced a result.
3. **Files are downloaded again.** PDFs live in a command folder, so the next command downloads them again, and a resumed command copies the whole previous folder.
4. **The same logic is written several times.** Each of these sources has its own retry loop, its own request log and its own idea of when a result is stale.

Intake already has one cache, the resolved-property cache of ADR 0019. There is one way to cache (owner's ruling, 2026-11-19): this change puts call results into that cache and adds no second mechanism beside it.

## Goals

- The resolved-property cache is the only cache. Every call a client makes is an entry in it.
- A failed call is recorded with what is needed to reproduce it and when to try again.
- A file is a record like any other: one kind, one spec, the standard envelope IO, source-name mapping and folders.
- A source or stage that needs a service is handed a client for it. The client is written once.
- A failure of one item never stops a command; it is recorded and, in an acquire, named when the acquire fails at its end (section 4). A service that fails its check stops the command (section 4).

## Non-goals

- Changing ADR 0019's rule for property values: a value is cached under its record and property, keyed by the fingerprint of its input. This change adds what a call entry holds; it changes no key.
- Moving the Clearinghouse and YouTube sources' request logs or the YouTube `video-cache.json`. They are not among the three caches this change removes.
- Minnesota's `agencies.yaml`, the source's record of agency name to Salesforce ID. It stays; `cache-every-acquire` makes its agency search a cached call.
- The warning that an acquire is due (owner's ruling, 2026-11-19: out of this change).
- Removing `resume` from `acquire.yaml` (`src/cli/state/command-pointer.ts`, `src/cli/acquire/index.ts`, `src/cli/acquire/acquire-from-local.ts`) and the `previousSourceDirs` passed to a source's acquire. The owner ruled (2026-11-18) that both are removed once every call result and downloaded file an acquire makes goes through the cache, and that this change keeps both: the follow-up change `cache-every-acquire` moves the four acquires below onto the cache and then removes both. With this change only CourtListener's acquire goes through the cache. The four acquires below still keep their progress in their command folder, where only `resume` (and, for Census, `previousSourceDirs`) carries it to the next run:

  | Source                                                 | How it fetches                                            | What it reuses from an earlier folder                                                                        | What removing `resume` would lose                                                    |
  | ------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
  | `gov/census/www2/gazetteer`                            | `fetch`, outside the cache                                | Gazetteer and TIGER ZIPs, checked by a range request, from the `resume` and `latest` folders                 | Every acquire downloads every ZIP again (516 MB in the dev workspace's last acquire) |
  | `net/bpl-orsnapshot/www/public-inquiry-cj`             | ASP.NET form posts in one site session, outside the cache | `manifest.json` and the saved search, employment, certificate and agency pages                               | An interrupted acquire scrapes every roster and officer again (11,601 officer files) |
  | `com/site/my/mnitservices/post-license-search`         | A Playwright browser session, outside the cache           | The agency CSV, rosters, officer details, discipline requests, and order PDFs until the Minnesota task below | An interrupted acquire scrapes every roster and officer again (11,601 officer files) |
  | `org/wikipedia/en/us-federal-law-enforcement-agencies` | `fetch`, outside the cache                                | `federal-le.html`                                                                                            | One page is downloaded again                                                         |

  The other acquires lose nothing: Clearinghouse (`net/clearinghouse/api`) and PSV (`org/psvproject/arrest-tracker`) fetch outside the cache but reuse nothing from an earlier folder, YouTube keeps its progress in `video-cache.json` in its own state, Irving reads local files, submissions syncs with the `aws` CLI into its own bucket folder, and the manual source writes its own state.

- Building the sync of the workspace to S3. That is a policeconduct.org command run after `data generate`; this change only runs it after its reset (tasks).
- Deleting anything from the cache. A bad stored result is retired by a newer outcome (section 3), never deleted.

## Terms

- **Cache**: the `ResolvedProperty` envelopes, intake's own state. The code keeps them at `<workspace>/state/intake/namespaces/intake/ResolvedProperty/` (`src/cli/state/resolved-property/index.ts:resolvedPropertyDirectory`); `keep-state-under-one-root` moves them to `<workspace>/state/intake/ResolvedProperty/`.
- **Envelope**: a YAML file with `apiVersion`, `kind`, `metadata` and `spec`, read and written only through that kind's own code.
- **Subject**: the record a cache envelope is about: `apiVersion`, kind and canonical ID (ADR 0019).
- **Request**: the description of one call. It holds what decides the answer and nothing else.
- **Fingerprint**: the SHA-256 of a value's stable JSON (object keys sorted with `localeCompare`), as `typedInputFingerprint` in `src/shared/io/fingerprint.ts` computes it.
- **Call entry**: a cache entry that holds one request and the outcomes of calling it.
- **Outcome**: what one attempt at a request produced: an answer, or an error.
- **Client**: shared code that makes calls to one outside service through the cache.
- **Resolver**: code in the shared import that works out the value of one field of a record during `data generate`.
- **Codex**: OpenAI's coding agent, which made the existing Minnesota analyses.
- **Item failure** and **outage**: defined in section 4. An outage is recorded with the error kind `service`.
- **Civil case resolvers**: the `data generate` resolvers that fill a CourtListener civil case's complaint summary (`src/cli/import/artifacts/facades/complaint-summary-resolvers.ts`, from `move-complaint-summaries-to-generate`).
- **Document reference**: the Minnesota acquire's output entry for one order document (its URL, citing actions, SHA-256 and size). It is acquire output that the transform reads, not a record.
- **Document review**: how the 601 existing Minnesota analyses were made. A Codex session read each order and wrote its analysis with page-cited evidence (`reviewReceipt`); the files name the method `codex-document-review`. The proposal's "hand-review results" are these. No new document review is accepted after this change.
- **The Minnesota task**: Implementation Plan step 7 and its task, which moves Minnesota's order text and analysis into `data generate`.
- **Resolver backend**: the object the import hands every resolver (`resolverBackend` in `src/cli/import/artifacts/data-context.ts`).
- **Source-name mapping**: intake's record of the canonical ID for each source namespace and source name (ADR 0008).
- **Dockets file**: the CourtListener acquire's output for one agency, `<agency ID>.dockets.json` in its command folder.

## Proposed architecture

### Overview

```text
source acquire ──┐
                 ├──> client (one per service) ──> ResolvedProperty: a call entry per request
resolver in      │        │
data generate ───┘        └──> outside service (only when the entry has no standing outcome)
```

A caller builds nothing itself. It asks a client for something ("the entries of docket 123", "this file", "a summary of this text with this prompt") and names the record it asks for. The client builds the request, looks for the call entry, calls the service only if it must, appends the outcome, and returns either the answer or a failure the caller can act on.

### 1. Decision: a call result is an entry of the resolved-property cache

There is one cache mechanism: `ResolvedProperty` (`src/cli/state/resolved-property/ResolvedProperty.ts`, store in `src/cli/state/resolved-property/index.ts`). A call result is an entry in it, not a kind of its own.

**Key.** As for every resolved value, an envelope is named by its subject and target property (`resolvedPropertyCacheName`: `apiVersion:kind:canonical ID:property`), and holds one entry per input fingerprint.

| Part of the key        | For a call entry                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Subject                | The record the call is made for: for the CourtListener acquire's search, the `Agency` it searches for (`AcquireAgencyRecord.agencyId`, a canonical ID); for a resolver's call, the record the resolver is resolving (the `CivilCase` of a complaint summary) |
| Target property        | The client operation that made the call: `searchDockets`, `docketEntries`, `download`, `extractText` or `structuredAnswer`. One call can fill several fields (an order analysis fills five), so the entry is not filed under any one of them                 |
| Input fingerprint      | `typedInputFingerprint` of the request                                                                                                                                                                                                                       |
| `sources[<namespace>]` | The namespace of the source that asked, as provenance (as for every entry); not part of the key                                                                                                                                                              |

**A call entry** holds `request` and `outcomes` in place of a single `value`. Its value is the answer of its latest succeeded outcome. A resolved value that comes only from call entries (a complaint summary, an order analysis's fields) is not cached a second time under its own property: the generated `RESOLVED_PROPERTIES` already leaves complaint summaries out (`src/shared/io/generated/entity-specs.ts`), and the Minnesota discipline fields stay out too. AGENTS.md's rule that a resolved value goes through `ResolvedProperty` holds, because its calls are there.

`request`:

| Field        | Meaning                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service`    | The outside service, for example `courtlistener`, `anthropic`, `download`, `pdf-text`                                                                                                             |
| `operation`  | What was asked, for example `search`, `docket-entries`, `messages`, `get`, `page-count`, `page-text`                                                                                              |
| `url`        | The full URL, for an HTTP call                                                                                                                                                                    |
| `parameters` | Everything else that decides the answer: max tokens, reasoning level (`effort`), output schema, and the PDF text client's `page`, `ocrDpi` and `minTextLayerChars`. Query parameters are in `url` |
| `prompt`     | The prompt text, for a model call                                                                                                                                                                 |
| `inputs`     | A list of `{ name, sha256 }` for each document or text sent                                                                                                                                       |

`outcomes` is a list; the last is the current one. Each outcome:

| Field                                            | Meaning                                                                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                         | `succeeded` or `failed`                                                                                                                                           |
| `startedAt`, `completedAt`                       | ISO 8601 times. An outcome with `producedBy` may leave out `startedAt`                                                                                            |
| `answer`                                         | The answer, for a success. A downloaded file's answer is its `BinaryFile` facts (section 2), never its bytes                                                      |
| `error`                                          | `{ kind, message }`, for a failure. `kind` is `item`, `service` or `retired`                                                                                      |
| `httpStatus`, `requestId`, `stopReason`, `usage` | As the service gave them                                                                                                                                          |
| `requestedModel`, `model`                        | For a model call: the model asked for, and the model the response names                                                                                           |
| `toolVersions`                                   | For a PDF text call: the poppler and tesseract versions that ran                                                                                                  |
| `retryAfter`                                     | When to call again; absent means never for this request                                                                                                           |
| `producedBy`                                     | Set only on outcomes the one-time move writes, to say what produced them or which file or call log they came from                                                 |
| `commandId`, `intakeVersion`                     | Which command made the call and which commit of intake (`git rev-parse HEAD`, `src/cli/intake-version.ts`). An outcome with `producedBy` may leave out the commit |

An answer is kept inline, whatever its size: YAML has no limit, and nothing is kept as a file only because it is large.

**Writes.** The store reads the envelope, appends the outcome to its entry, and writes the envelope to a temporary name of its own writer (the envelope's name with the process ID, a random suffix and `.tmp`) and renames it, so a crash never leaves a half-written envelope. The write fails, naming the file, when the envelope it read holds an outcome the new one would drop or change. `ResolvedProperty.write` writes in place today (tasks).

**What happens to the code already written.** The `CallResult` cache of commit 7275ec3 is replaced, not kept beside:

- `src/shared/io/CallResult.ts` is removed. Its request and outcome schemas, with the checks below, move into the entry schema of `src/cli/state/resolved-property/ResolvedProperty.ts`; `callRequestFingerprint` becomes `typedInputFingerprint` of the parsed request.
- `src/cli/state/call-cache/index.ts` is removed. Its `standingOutcome` (with `keepSucceeded`) and its append move into `src/cli/state/resolved-property/index.ts` as operations on a call entry.
- `src/shared/services/client-base.ts:CallCache` keeps its role but is implemented over the resolved-property store; `cachedCall` takes the subject with the request. Each client operation takes the subject from its caller.
- `src/cli/service-clients.ts:buildServiceClients` no longer takes a namespace for the cache, which is intake-wide. Clients are built once per command, so the service check and the down mark are per command.
- No `CallResult` or `BinaryFile` envelope exists in any workspace (`dev`, `dev-copy`, `preview` and `prod` checked 2026-11-19), so nothing already written is converted.

**The request never holds an API key, an `Authorization` header or a cookie.** The client adds those when it calls. The entry schema rejects a key at any depth of `parameters` (the output schema included) or a URL query key whose whole name is one of `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `api-key`, `api_key`, `apikey`, `token`, `password` or `secret`, in any case, and a URL with a user name or password. A credential under another name, or in a URL path, is not caught; no client puts one there.

**The request names each input by its SHA-256.** Reproducing a call therefore also needs the input itself (a model call's text is rebuilt by its caller; the complaint summary joins page text with form feeds) and, for PDF text, the tool versions its outcome records.

**The model is not part of the request** (owner's decision, 2026-11-17). Changing the model a caller asks for does not change the fingerprint, so it reuses the cached answers. Every outcome of a model call records the model asked for, and every outcome that had a response records the model that response names. A response that names no model is an item failure. The PDF tool versions are treated the same way: recorded on the outcome, not in the request.

### 2. A file is a record like any other

`BinaryFile` is one record kind with one spec, generated like every other kind (`scripts/lib/entity-spec-generator.ts`), read and written through the standard artifact envelope IO. Its fields: `id`, `sha256`, `extension`, `content_type`, `byte_count` and `workspace_path`. The database holds this row and never the bytes; the row has no namespace. There is no hand-written `BinaryFile` envelope and no separate file store or lookup: `src/shared/io/BinaryFile.ts` and the store's `readBinaryFile` and `writeBinaryFile` are removed.

**Identity.** A source that keeps a file emits a `BinaryFile` record with the file's SHA-256 as its source name. Its ID comes from the standard source-name mapping under that source's namespace and converges on the `sha256` business key, so the same bytes kept by two sources are one row.

**The bytes are stored on disk by namespace** (owner's ruling, 2026-11-19), at `<workspace>/state/intake/namespaces/<namespace>/BinaryFile/<sha256>.<extension>`: the folder where that namespace's `BinaryFile` source-name mapping files already go. A file is written to a temporary name of its own writer and renamed; when a file of that name exists, its bytes are compared and the write fails, naming the file, if they differ. An acquire also saves a file it downloads in its command folder (owner's ruling, 2026-11-17).

**`workspace_path`** is the bytes' path relative to the workspace. It is resolved, not given by the source: the first path a file was stored at, cached as the `BinaryFile` record's `workspace_path` property with no input fingerprint, so it never changes when a second source keeps the same bytes. A reader hashes the bytes again and fails if the hash or size is not the record's.

**The website gets a file the same way it gets any other property:** it reads the `binary_file` row, including `workspace_path`, and reads the bytes from the workspace, as its photo staging reads `personnel_photo.workspace_path` today (policeconduct.org `src/lib/personnel-photo-files.js`). Its published address is `/binary-file/<sha256>.<extension>`.

**A record that has a file points at the file's record** with a foreign key, resolved by the standard foreign-key resolver. Nothing else about the file is copied onto the pointing record.

**A download's answer** is the file's facts: `sha256`, `extension`, `content_type`, `byte_count` and `workspace_path`. So the cache entry of a download names the file, and the same URL downloaded twice lists both files in its outcomes. A file nothing points at needs no record; its bytes and its download entry are enough.

**`PersonnelPhoto` is retired.** `Personnel` gains `photo_id`, pointing at a `BinaryFile`. The manual source handles `Personnel` updates (owner's ruling, 2026-11-19): `intake photo import` stores the photo's bytes under `org/policeconduct/manual`, and the manual source emits its `BinaryFile` record and a manual update of the person that sets `photo_id`. That update is the only thing that sets `photo_id` from the workspace; the Supabase migration carries over the `personnel_photo` row of a database that has one, and in a reset database the replayed manual update sets `photo_id`. This change alone retires `assets/PersonnelPhoto/`; `keep-state-under-one-root` and `import-personnel-photos` refer to it. There is no release order with policeconduct.org: its change only has to make the next website build work (owner's ruling, 2026-11-19).

### 3. When a call is made again

One rule, for successes and failures alike, over the entry's current outcome:

1. No entry for this request: call.
2. The current outcome has no `retryAfter`: it stands. Do not call.
3. The current outcome's `retryAfter` is in the future: it stands. Do not call.
4. The current outcome's `retryAfter` is now or past: call, and append the new outcome.

A caller sets `retryAfter` on a success when the answer can go stale (a search result, a docket's entries: 120 days). A client sets it on an outage (section 4) and on an item failure: 24 hours after the failure (owner's ruling, 2026-11-19). A changed document, parameter or prompt changes the request, so it is a new entry. A changed model does not.

**A bad stored result is retired, not deleted.** A new `intake cache` operation takes the record by source identity (as `cache get` does), the client operation and the request fingerprint, with the required `--message`, and appends an outcome with the error kind `retired`, the message and a `retryAfter` of now. The next run calls again. This is the only change to a call entry made by hand.

**A rebuild does not refresh.** During `data reset --no-acquire` the latest succeeded outcome is used as it is, even when its `retryAfter` has passed and even when a later attempt failed (`keepSucceeded`, owner's ruling, 2026-11-19). An entry with no succeeded outcome follows the rule above.

### 4. Item failures and service outages

| What happened                                                                                                                                                     | Sort                  | What the client does                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| An empty answer (a search that finds nothing)                                                                                                                     | Success               | Record it as a succeeded outcome                                                                               |
| 4xx other than 401, 403 and 429 for one item; a model refusal, token limit or answer that does not fit the schema                                                 | Item                  | Record a failed outcome with a `retryAfter` 24 hours on; return the failure                                    |
| The check before the client's first call gets no answer, 401 or 403, or the model asked for does not exist                                                        | Outage at the start   | Stop at that call, before it is made; record nothing                                                           |
| During the run: no answer, a connection error, 429 or 5xx, or 401, 403 or an account or credit error, that outlast the retries, and the check run again fails too | Outage during the run | Record a failed outcome with `retryAfter`; mark the service down for the rest of the command; return "skipped" |
| The same, but the check run again answers                                                                                                                         | Item                  | Record a failed outcome with a `retryAfter` 24 hours on; return the failure                                    |

**The check.** Each client checks its service once per command, just before its first call that the cache does not answer, so a run that the cache answers wholly checks nothing and reads no key. `CourtListenerClient` and `InferenceClient` call an endpoint that needs their key, and fail when the key is missing; `InferenceClient`'s check also confirms that the model asked for exists. If the check fails, that call is not made and the command exits non-zero, naming the service; `data update` first goes on with its next source, and every other command runs no later source. What was done before that call is not undone.

**After the retries the client runs the check again** before it calls the service down. If the service answers, the failure belongs to the one item. A service marked down stays down for the rest of the command; the next run checks it again.

**An acquire fails at its end for every call that failed or was skipped** (owner's ruling, 2026-11-19). It makes every other call, so their answers are kept, then exits non-zero naming each failed or skipped call, and is not recorded as completed. Running it again calls only what the cache does not answer. For the CourtListener acquire, an agency whose search failed or was skipped gets no dockets file in that run.

**In `data generate`, `data update` and `data reset`, an outage is a skip.** The resolver leaves alone whatever that call would have filled, reports no finding, and states that the findings its record's resolvers reported on earlier runs are kept (ADR 0040, decision 3), so no annotation is resolved. Its last lines name the service, the time it went down when this command found it, how many calls were skipped and the time to try again, and the command exits 0 (owner's ruling, 2026-11-19: only `data acquire` fails at its end on skipped or failed calls).

`retryAfter` for an outage is the service's `Retry-After` when it gives one, and otherwise one hour after the failure.

The client tries a call up to 5 more times before it counts an outage, waiting the service's `Retry-After` or 1 second doubling each time, never more than 60 seconds per wait. A call times out after 60 seconds for CourtListener and downloads, 600 seconds for Anthropic, and a set time per PDF program run (tasks). Each client makes one call to its service at a time (the download client one per host); two callers that ask for the same request at once share one call. A retry of a paged CourtListener call starts again from its first page, and nothing is kept until every page has answered.

For downloads, each host is its own service (`download <host>`), with its own check (a `GET` of the host's root, which any HTTP answer passes) and its own down mark.

### 5. Clients

All in `src/shared/services/`, built on one base that does sections 3 and 4:

| Client                | Operations                                                                       | Used by                                     |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| `CourtListenerClient` | `searchDockets` by party; `docketEntries` of a docket                            | CourtListener acquire; civil case resolvers |
| `InferenceClient`     | `structuredAnswer`: ask a model for a structured answer about a text             | Civil case resolvers; discipline resolvers  |
| `DownloadClient`      | `download` a file by URL, optionally with a caller-supplied fetch                | Any                                         |
| `PdfTextClient`       | `extractText`: a PDF's text page by page, with OCR for a page with no text layer | Any                                         |

`PdfTextClient` is the Minnesota source's `document-text.ts` moved to shared code. It is a service because it runs outside programs (`pdfinfo`, `pdftotext`, `pdftoppm`, `tesseract`). A file has one call entry for its page count and one for each page, as built. Its check runs each of the four programs once and names every one that cannot be run. `mise.toml` pins `conda:poppler` and `conda:tesseract` (owner's decision, 2026-11-17). A program that fails for a file, or runs past its time, is a failure of that file. Until the Minnesota task, the Minnesota acquire calls `extractDocumentText` directly.

Code outside the clients that still calls a service itself, and stays so after this change: the Clearinghouse, PSV, YouTube and SerpApi fetches (Non-goals); the Census geocoder of `src/cli/import/artifacts/agency-coordinate-resolver.ts`, whose results are already `ResolvedProperty` values; the four acquires `cache-every-acquire` moves; the Minnesota acquire's order downloads, text extraction and analysis, until the Minnesota task; `requests sync` (`src/cli/requests/responses.ts`); and the news inference (`sources/lib/news-inference.ts`).

Clients are built by `buildServiceClients` in `src/cli/service-clients.ts`, once per command, and passed down: to a source's acquire through the acquire dependencies, and to resolvers through the resolver backend.

Each client counts the calls it made and the calls the cache answered, beside the calls it skipped, and `data reset` prints them per service at its end with the size of the cache and of the `BinaryFile` folders.

### 6. Keys in `data generate`

`data generate` and `data update` pass `withParameterStoreSecrets(process.env)` to the import (`src/cli/data/index.ts`), as `data acquire` does; `data reset` runs `data generate`. A key is read only when a client makes its first call that the cache does not answer. The requirement is in the `acquire-secrets` spec of `read-acquire-tokens-from-parameter-store`; this change does not repeat it.

### 7. Moving what exists

The move is not intake code and adds no command. It is a one-time script, kept outside the repository in a folder beside `~/dev/PoliceConductUS/intake-workspace/migration-2026-11-17/` and run the way that migration was: on an APFS clone that then takes the workspace's place, with the original kept as the backup; a second run on the same clone changes nothing; a run on a fresh clone gives the same output. AGENTS.md ("Cache Changes") has every cache change go through the intake CLI; the owner ruled (2026-11-17) that a workspace move is instead a one-time script run against a clone, and this move follows that ruling. The script imports intake's request builders and the resolved-property store from this change's branch, and its `README.md` names the commit.

The script builds each request with the code's own request functions (`searchDocketsRequest`, `docketEntriesRequest`, `pdfPageCountRequest`, `pdfPageTextRequest` and `structuredAnswerRequest`), so a moved entry is found by the request today's code makes; the request of a moved outcome is a lookup key, not a record of what was sent then. It writes nothing for a request whose entry already holds an outcome, and reports it. No value it writes comes from the clock; a time read from an old file is written as ISO 8601 with an offset, and the move fails, naming the file, on a time it cannot read. `producedBy` is a path relative to the workspace (a call log or a `*.document.json` file), or `codex-document-review` for an analysis. It reports what it moved and what it could not match, and deletes no file.

| From                                                   | To                                                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CourtListener searches in `.api-calls.jsonl`           | A `searchDockets` entry of the agency whose dockets file in the same command folder has that party name                                  |
| CourtListener docket entries in `.api-calls.jsonl`     | A `docketEntries` entry of the civil case the CourtListener `CivilCase` source-name mapping gives for `cl-<docket ID>`                   |
| The 25 complaint PDFs in the 2026-11-17 command folder | Bytes copied under `com/courtlistener/www/api`; no download entry, so no HTTP detail is made up                                          |
| `assets/PersonnelPhoto/<sha256>.<ext>`                 | Bytes under `org/policeconduct/manual`, its `BinaryFile` record, and the manual `photo_id` update in place of the `PersonnelPhoto` entry |
| Minnesota order PDFs, page text and analyses           | After the Minnesota task, as section 9 says                                                                                              |

**CourtListener calls come from the call logs, not from `docket-cache.json`,** which merges an agency's searches and records no query. Each log line is `{ at, url, status, body }`. A call is carried over when its log holds the first page and every page the `next` links name, each with status 200, and when the URL the code rebuilds from the logged party name, court list and `filed_after` (or docket ID) equals the logged one as a string; otherwise it is reported as unmatched. Its answer is the pages' `results` joined in order; `completedAt` is the last page's `at`; `commandId` is the ID of the command folder; `retryAfter` is 120 days after the last page's `at`. A request in both logs is carried over once, from the later log. A 429 line is a retry within one call. The dev workspace holds two logs (counted 2026-11-18): up to 12 searches and 85 docket entries calls can be carried over; the 92 entries calls of the 2026-09-28 log use a URL today's client never asks for. The logs record no start time and no commit, so these outcomes carry `producedBy` and leave out `startedAt` and `intakeVersion` (owner's decision, 2026-11-18).

The move clears the `resume` line of `state/com/courtlistener/www/api/acquire.yaml` (owner's decision, 2026-11-18), so the full acquire does not copy the old folder's 73 MB into its own output; `resume` stays a feature of intake. The manual chain cannot drop an entry, so the move writes a new chain output that holds the `photo_id` update and leaves out the `PersonnelPhoto` entry (owner's ruling, 2026-11-19). The photo's `BinaryFile` record keeps nothing of `source_filename` or `source_url`; those stay in the old chain output.

The `.api-calls.jsonl` files and `docket-cache.json` are deleted only after the move and the reset after it are verified. The workspace kept as the backup is kept until the next verified reset after the Minnesota move (owner's ruling, 2026-11-19).

### 8. Order of work

1. This change's code, including the rework of section 1 and the personnel photo task.
2. The CourtListener and photo move (section 7), on a clone of the workspace.
3. `keep-state-under-one-root`'s one-time move, then its code. That move removes `assets/` only once step 2 has put the photo under `org/policeconduct/manual`.
4. The full CourtListener acquire.
5. The Minnesota task and the Minnesota move, before the next reset.
6. `data reset --no-acquire`; once it is verified, the old files are deleted.

### 9. The Minnesota task

Owner's rulings (2026-11-19) settle its shape:

- The order's `extractText` and `structuredAnswer` call entries are cached under the order's `BinaryFile` record, and `Discipline` gains a foreign key to that record.
- The analysis request drops the server-side fallback beta of `order-analysis.ts`, which `src/shared/services/inference-client.ts:structuredAnswerRequest` cannot send, and keeps `absenceReasons` in the output schema. A moved analysis keeps `absenceReasons` and the `reviewReceipt` evidence in its answer.
- `data generate` fills the five order fields from the analysis (MODIFIED "Discipline carries what its order says").
- The two-step Salesforce fetch of `document-fetch.ts` (render a page, then download the derived URL) is one download: the request is the evidence URL with operation `get`, and the session-bound derived URL stays out of it, as `cache-every-acquire` requires. A content-delivery page in place of a PDF is an item failure that the caller's PDF check reports.

Two parts still need their design written into this section before the Minnesota task starts (tasks): MODIFIED deltas for the accepted `intake-stage-completion` requirements "Referenced disciplinary documents have an explicit processing outcome" and "Null document narratives have explicit field-level absence reasons"; and how a reset replays the Minnesota command folders made before the change, which hold `*.document.json` and no document reference. The old PDFs stay where they are; they are evidence, and the moved bytes are copied from them.

## Alternatives considered

- **A second cache kind for call results (`CallResult`) and files (`BinaryFile` envelope).** Built in commit 7275ec3 and rejected (owner's ruling, 2026-11-19): there is one way to cache. Two mechanisms meant two keys, two stores and two sets of rules for staleness, provenance and correction.
- **Record a failure as an absent value.** Rejected: ADR 0019 forbids caching an absent value, because it would look like a hit and hide a later correction. A call entry records the failure as an outcome instead.
- **File a call entry under the field it fills.** Rejected: one analysis fills five fields, and a complaint summary's calls (docket entries, download, page text, answer) fill one; the client operation is the one name every call has.
- **Keep the bytes of every file in one folder for all namespaces.** Rejected (owner's ruling, 2026-11-19): files are stored by namespace.
- **Keep a large answer as a file.** Rejected: YAML has no size limit, and a second way to hold an answer is a second mechanism.
- **Put the model in the request.** Rejected (owner's decision, 2026-11-17): a change of model would ask again for every cached answer, the 530 Minnesota analyses included.
- **Change `typedInputFingerprint` to a code-point sort or RFC 8785.** Rejected: it keys the 241,448 `ResolvedProperty` envelopes in the dev workspace (counted 2026-11-19), and every one would miss. A test pins known fingerprints instead (section 1, risks).
- **Add a CLI command for the move.** Rejected (owner's ruling, 2026-11-17): a command used once would stay in intake as dead code.
- **Expire entries by age only.** Rejected: an unchanged complaint never needs summarizing again, while a search result goes stale. `retryAfter` per outcome covers both.

## Risks and mitigations

| Risk                                                                                                                                                                                   | Mitigation                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The cache grows without limit: about 530 Minnesota PDFs today, and one PDF per imported civil case                                                                                     | `data reset` prints the size of the cache and of the `BinaryFile` folders. No deletion in this change; a retention rule is a later decision.                                                                                      |
| A cache key changes with no input changing: `localeCompare` depends on the runtime's locale data, and the inference request holds the output schema as the SDK renders it              | A test pins the fingerprint of a known request for every request builder and of `typedInputFingerprint`, so a runtime, locale or SDK change fails the build instead of missing every entry.                                       |
| A changed model or PDF tool version reuses answers another one produced                                                                                                                | Accepted (owner's decision): each outcome records the model and the tool versions that answered.                                                                                                                                  |
| Two commands append to one entry at once                                                                                                                                               | The write re-reads the envelope and fails, naming the file, when an outcome it holds would be dropped or changed. An outcome another command writes between that read and the rename can still be lost; the next run calls again. |
| A long first run: the full CourtListener acquire makes about two searches for each of 3,220 agencies under CourtListener's hourly limit, and a first Minnesota run analyzes 530 orders | Every finished call is in the cache, so a run cut short loses nothing already done; the acquire fails at its end naming what was skipped, and the next run calls only that.                                                       |
| A request leaves out something that decides the answer                                                                                                                                 | Each client's request is built in one function with a test that changing each deciding input changes the fingerprint.                                                                                                             |
| A key or cookie ends up in a cached request                                                                                                                                            | The entry schema rejects credential-named keys and URLs with a user name or password; a test asserts a request with an `Authorization` value is rejected. A credential under another name is not caught.                          |
| A malformed or hostile PDF hangs `pdftoppm` or `tesseract`                                                                                                                             | Each program run has a time limit, and running past it is a failure of that file (tasks); `mise.toml` pins the versions.                                                                                                          |
| A person's `photo_id` points at a file that is not in the workspace                                                                                                                    | A task asserts every `photo_id` names a `binary_file` row whose bytes exist at `workspace_path` with its hash and size. The website build also fails when a file is missing or its hash or size differs.                          |

## Implementation Plan

Paths are from the repository root. Each step ends with `npm run validate` passing. Steps 1 to 6 below were built with the `CallResult` cache of commit 7275ec3; step R reworks them onto the one cache. The steps are not in the order they are run; section 8 gives that order. Client tests use `test/shared/services/harness.ts`.

**Step R: one cache (rework of steps 1 to 6).**

- `src/cli/state/resolved-property/ResolvedProperty.ts`: add the call entry (`request`, `outcomes`) to the entry schema, with the credential checks of section 1. `src/cli/state/resolved-property/index.ts`: add reading an entry's standing outcome (with `keepSucceeded`) and appending an outcome; write every envelope to a per-writer temporary name and rename it.
- Remove `src/shared/io/CallResult.ts`, `src/shared/io/BinaryFile.ts` and `src/cli/state/call-cache/`, and their exports and tests; move the tests of `test/cli/state/call-cache.test.ts` onto the resolved-property store.
- `src/shared/services/client-base.ts`: `CallCache` over the resolved-property store; `cachedCall` takes the subject; item failures get a 24-hour `retryAfter`; 401, 403 and account or credit errors after the check are outages; after the retries the check runs again; the answer is kept inline (the 256 KB rule goes); calls made and calls the cache answered are counted.
- `src/shared/services/inference-client.ts`: the check confirms the model asked for exists. `src/shared/services/pdf-text-client.ts`: outcomes record `toolVersions`; each program run has a time limit. `src/shared/services/download-client.ts`: the answer is the file's facts; the bytes go under the caller's namespace.
- `src/cli/service-clients.ts`: build clients once per command. `sources/com/courtlistener/www/api/acquire.ts`: pass each agency as the subject, and fail at the end naming each failed or skipped search. `src/cli/import/artifacts/facades/complaint-summary-resolvers.ts`: pass the civil case as the subject.
- `src/cli/cache/index.ts`: add the operation of section 3 that retires a stored result, with `--message`.
- Tests that pin a known fingerprint for each request builder and for `typedInputFingerprint`.

Steps 1 to 6, as built in commit 7275ec3: the store, the client base, the four clients, `withParameterStoreSecrets` in `src/cli/data/index.ts`, clients on `AcquireDeps` and the resolver backend, and the CourtListener acquire on `CourtListenerClient` (its own cache files and the `.api-calls.jsonl` writer deleted).

7. Minnesota POST, after the rest of its design is written into section 9: `collect-documents.ts` downloads through `DownloadClient`, saves each PDF in the command folder as well (owner's ruling, 2026-11-17) and writes a document reference; text and analysis move to discipline resolvers in `data generate`; remove the `documents/` state cache and the acceptance of `codex-document-review` results in `document-evidence.ts` and `collect-documents.ts`.
8. Files as records and photos: in `scripts/lib/entity-spec-generator.ts`, add the `BinaryFile` entity (with `sha256` as its business key and `workspace_path` as a cached resolved property) and `Personnel.photo_id`, and remove the `PersonnelPhoto` descriptor; write one Supabase migration that creates `binary_file`, adds `personnel.photo_id`, carries over each `personnel_photo` row, and drops `personnel_photo`. Add `Personnel` and `BinaryFile` to `sources/org/policeconduct/manual/kinds.ts` and remove `PersonnelPhoto`. `src/cli/photo/store.ts` stores the bytes under `org/policeconduct/manual`; `src/cli/photo/prepare.ts` emits the `BinaryFile` record and the `photo_id` update. Remove `PersonnelPhoto` from `src/cli/import/artifacts/agency-graph.ts` (adding the `Personnel` to `BinaryFile` edge), `src/cli/photo/index.ts`, `scripts/lib/data-request-doc-generator.ts`, `src/shared/io/index.ts`, `docs/personnel-photos.md` and the READMEs that list it, then run `npm run generate:envelope-types` and `npm run generate:data-request-doc`. Update `test/cli/personnel-photo.test.ts` and `test/data-request-doc.test.ts`. In policeconduct.org, its photo staging reads `binary_file.workspace_path`, so the next website build works.
9. Let an outcome with `producedBy` leave out `startedAt` and `intakeVersion`, with tests. Write the one-time script of section 7 with a `README.md`, run it on a clone of the dev workspace, a second time on the same clone (no change), then on a fresh clone (the same output); check that each carried-over request's fingerprint equals the client's and each moved file's SHA-256 its name.
10. After the Minnesota task, run the Minnesota move the same way, then `data reset --no-acquire`, and report what it prints. Each run on the dev workspace needs the owner's go-ahead.
