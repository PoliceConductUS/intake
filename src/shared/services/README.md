# services

## Overview

One client for each outside service intake calls through the cache of call
results and files (ADR 0039): CourtListener, the Anthropic API, file
downloads, and the programs that read a PDF's text. A client builds the request, looks in the cache, calls the service
only when no outcome stands, records the outcome, and returns a result, a
failure of the one item asked for, or `skipped` when the service has gone
down.

The cache, time, the wait between retries and `fetch` are passed in. The
clients of one command are built by `src/cli/service-clients.ts`.

## Interface

Every client method returns one of three results:

- `{ status: "succeeded", ..., outcome }` - the value, and the `CallOutcome`
  it came from.
- `{ status: "failed", error: { kind: "item", message }, outcome }` - a
  failure of the one item. It is cached with no `retryAfter`, so it is
  returned again until the request changes.
- `{ status: "skipped", service, retryAfter }` - the service is down. The
  caller leaves alone whatever the call would have filled.

A service that is down before the first call throws
`client-base.ts:ServiceUnavailableError`.

Clients:

- `index.ts:createServiceClients` - `(deps)` returns
  `index.ts:ServiceClients`:
  `{ courtListener, inference, download, pdfText, skips() }`.
  `deps` is `client-base.ts:ClientDeps` plus `fetch`, `env` and the optional
  `runCommand` of the PDF text client; the
  CourtListener client reads `env.COURTLISTENER_API_TOKEN` and the inference
  client `env.ANTHROPIC_API_KEY`. `skips()` returns the
  `client-base.ts:ServiceSkips` of every client.
- `courtlistener-client.ts:createCourtListenerClient` - `(deps)` with
  `fetch`, `readToken` and optional `timeoutMs`; returns
  `courtlistener-client.ts:CourtListenerClient`:
  - `searchDockets({ partyName, courts, filedAfter }, { refreshAfterMs }?)` -
    succeeded: `{ results }`, the hits of every page as CourtListener gave
    them.
  - `docketEntries(docketId, { refreshAfterMs }?)` - succeeded:
    `{ entries }`, the entries of every page.
  - `skips()`.
- `courtlistener-client.ts:searchDocketsRequest`,
  `courtlistener-client.ts:docketEntriesRequest` - the `CallRequest` of each
  operation: `service: "courtlistener"`, `operation: "search"` or
  `"docket-entries"`, and the first page's `url`.
- `courtlistener-client.ts:docketIdFromUrl` - `(url)` returns the docket ID
  of `https://www.courtlistener.com/docket/<id>/...`, or `undefined`.
- `inference-client.ts:createInferenceClient` - `(deps)` with `readApiKey`
  and optional `fetch` and `timeoutMs`; returns
  `inference-client.ts:InferenceClient`:
  - `structuredAnswer({ model, prompt, text, inputName, schema, maxTokens, effort? })` -
    succeeded: `{ value, model }`, the model's answer parsed by `schema` and
    the model the response names. `prompt` is sent as the system prompt and
    `text` as the user message.
  - `skips()`.
- `inference-client.ts:structuredAnswerRequest` - the `CallRequest`:
  `service: "anthropic"`, `operation: "messages"`,
  `parameters: { maxTokens, effort?, outputSchema }`, `prompt`, and
  `inputs: [{ name: inputName, sha256 }]` with the SHA-256 of `text`. It does
  not hold `model`.
- `download-client.ts:createDownloadClient` - `(deps)` with `fetch` and
  optional `timeoutMs`; returns `download-client.ts:DownloadClient`:
  - `download(url, { fetch?, refreshAfterMs? }?)` - succeeded: `{ file }`, the
    `StoredBinaryFile` (`{ envelope, bytes, filePath }`). A `fetch` given here
    is used for this URL's host in place of the client's.
  - `skips()`.
- `download-client.ts:downloadRequest` - the `CallRequest`:
  `service: "download"`, `operation: "get"`, `url`.
- `pdf-text-client.ts:createPdfTextClient` - `(deps)` with the optional
  `runCommand`; returns `pdf-text-client.ts:PdfTextClient`:
  - `extractText(file)` - `file` is a `StoredBinaryFile`. Succeeded:
    `{ text }`, a `pdf-text-client.ts:DocumentText` (`{ pages }`, each page
    `{ page, method: "text" | "ocr", text }`), and the outcome of the last
    page read.
  - `skips()`.
- `pdf-text-client.ts:pdfPageCountRequest`,
  `pdf-text-client.ts:pdfPageTextRequest` - the `CallRequest` of each
  operation: `service: "pdf-text"`, `operation: "page-count"` or
  `"page-text"` with `parameters: { page, ocrDpi, minTextLayerChars }`, and
  `inputs: [{ name: "pdf", sha256 }]`.
- `pdf-text-client.ts:extractDocumentText` - `(pdfPath, run?)` returns the
  `DocumentText` of a file with no cache; the Minnesota POST acquire uses it.
- `pdf-text-client.ts:needsOcr` - `(textLayer)`; true for a page with fewer
  than 40 characters that are not white space in its text layer.
- `pdf-text-client.ts:parsePageCount` - `(pdfinfoOutput)` returns the page
  count.
- `pdf-text-client.ts:CommandRunner` - type; `(command, args)` returns the
  command's standard output.

The base:

- `client-base.ts:createServiceClientBase` - `(deps)` with `service` and
  `check`; returns `{ service, cachedCall, jsonResponse, binaryFile, skips }`.
  - `cachedCall(request, call, { refreshAfterMs }?)` returns
    `client-base.ts:CachedCallResult`. `call` makes one attempt and returns a
    `client-base.ts:CallAttempt`: `response`, `file`, `item-failure` or
    `outage`.
  - `jsonResponse(outcome)` returns the response of a succeeded outcome.
  - `binaryFile(outcome)` returns the `StoredBinaryFile` an outcome names.
  - `skips()` returns `{ service, downAt?, skipped, retryAfter }`, or
    `undefined` when no call was skipped.
- `client-base.ts:ClientDeps` - `cache`, `commandId`, `intakeVersion()`,
  `now()`, `sleep(milliseconds)`, and optional `logger`, `maxRetries` (5) and
  `maxBackoffMs` (60,000).
- `client-base.ts:CallCache` - the cache a client is given: `readCallResult`,
  `appendOutcome`, `standingOutcome`, `readBinaryFile`, `writeBinaryFile`.
- `client-base.ts:httpGet` - `(fetch, url, { headers?, timeoutMs })` returns
  `{ kind: "answer", status, headers, body }` or `{ kind: "outage", message }`.
- `client-base.ts:httpFailure` - `(answer, url, now)` returns `undefined` for
  a 2xx status, an `outage` attempt for 429 and 5xx, and an `item-failure`
  attempt for any other status.
- `client-base.ts:retryAfterSeconds` - `(headers, now)` reads `Retry-After`
  as seconds or as a date.
- `client-base.ts:formatServiceSkips` - `(skips)` returns one line for each
  service: the service, when it went down, the calls skipped and the time to
  try again.

## Invariants

- `client-base.ts:cachedCall` - the order of work:
  1. The request is fingerprinted, which rejects a request that holds a key
     (see `CallResult` in [io](../io/README.md)).
  2. A second caller of a request that is still in progress shares the first
     caller's result.
  3. When the cache has a standing outcome, it is returned and the service is
     neither checked nor called. A standing outcome whose error is a service
     failure is returned as `skipped`.
  4. When the service is marked down, the call is `skipped`.
  5. `check` runs once for each client. When it reports the service down,
     `ServiceUnavailableError` is thrown for this and every later call, and
     nothing is recorded.
  6. `call` runs. An `outage` attempt is tried again up to `maxRetries` times
     after a wait: the service's `Retry-After`, or 1 s doubling each time,
     and never more than `maxBackoffMs`.
  7. The outcome is appended to the cache. An outage that outlasted the
     retries is recorded as a failed outcome with error kind `service` and a
     `retryAfter` of the service's `Retry-After`, or one hour, after the
     failure; the service is then marked down for the rest of the command.
     An item failure is recorded with error kind `item` and no `retryAfter`.
     A success is recorded with a `retryAfter` only when `refreshAfterMs` was
     given.
- `client-base.ts:cachedCall` - calls that reach the service run one at a
  time for each client.
- `client-base.ts:cachedCall` - an error thrown by `call` is not recorded and
  is thrown to the caller.
- `client-base.ts:cachedCall` - a JSON response over 256 KB, and every file
  answer, is stored as a `BinaryFile` with a download origin and named in the
  outcome's `file`. That needs the request's `url` and the attempt's
  `httpStatus`; without them it throws.
- `courtlistener-client.ts:createCourtListenerClient` - the check is
  `GET /api/rest/v4/courts/?page_size=1` with the token: no token, no answer,
  401, 403 or any other status that is not 2xx reports the service down. The
  token is sent only to `https://www.courtlistener.com`. A page whose `next`
  is outside the API or repeats, or whose body is not `{ results: [...] }`,
  is an item failure. `docketEntriesRequest` throws on an ID that is not all
  digits.
- `inference-client.ts:createInferenceClient` - the check lists one model:
  no key, no answer, 401, 403 or any other API error reports the service
  down. The SDK's own retries are off. A stop reason other than `end_turn`,
  an answer that is not JSON, an answer that does not fit `schema`, and an
  API error with a 4xx status other than 429 are item failures. A connection
  error, 429 and 5xx are outage attempts. Each outcome records the HTTP
  status, the request ID, the stop reason and the token counts the API gave.
- `inference-client.ts:createInferenceClient` - the model is not part of the
  request, so two calls that differ only in `model` share one cache entry and
  the second makes no call. Every outcome records `requestedModel`, the
  `model` of the input. Every outcome that had a response records `model`,
  the `model` field of that response. A response whose `model` is missing or
  blank is an item failure (`The response names no model.`). `structuredAnswer`
  throws `A succeeded anthropic outcome does not name the model that answered.`
  for a succeeded outcome with no `model`.
- `download-client.ts:createDownloadClient` - each host is its own service,
  named `download <host>`, with its own check and its own down mark. The
  check is a `GET` of the host's root; any HTTP answer passes and no answer
  reports the host down. The file's content type is the response's
  `Content-Type` without parameters, or `application/octet-stream`. Its
  extension comes from a known content type, else from the URL's path, else
  `bin`.

- `pdf-text-client.ts:createPdfTextClient` - the check runs `pdfinfo -v`,
  `pdftotext -v`, `pdftoppm -v` and `tesseract --version`, all four, and
  reports the service down when any cannot be run, with one reason that names
  every such program:
  ``<programs> cannot be run; `mise install` provides the PDF tools (<program>: <error>; ...)``.
  `mise.toml` pins `conda:poppler` and `conda:tesseract`. A file has one call result for its page
  count and one for each page, each keyed by the file's SHA-256, so no
  result is too large for the cache to keep inline. A page is read from its
  text layer with `pdftotext -layout`; a page `needsOcr` is rendered at 300
  dpi with `pdftoppm` and read with `tesseract`. The image is written under
  the real path of the temporary directory: on macOS tesseract cannot read a
  path that starts with `/tmp/`, which is what `os.tmpdir()` gives when
  `TMPDIR` is not set, as under `mise.toml`. A command that exits with a
  status other than zero is an item failure of that file; any other error is
  thrown.
- `pdf-text-client.ts:parsePageCount` - throws
  `pdfinfo did not report a page count`.
- `pdf-text-client.ts:runCommand` (not exported) - throws
  `<command> is not installed` when the command is not on the `PATH`.

## Side Effects

- Every client reads and writes `CallResult` and `BinaryFile` envelopes
  through the `cache` it was given.
- `courtlistener-client.ts:createCourtListenerClient` - HTTP GET to
  `https://www.courtlistener.com/api/rest/v4/`.
- `inference-client.ts:createInferenceClient` - `GET /v1/models` and
  `POST /v1/messages` at the Anthropic API through `@anthropic-ai/sdk`.
- `download-client.ts:createDownloadClient` - HTTP GET of the URL and of its
  host's root.
- `pdf-text-client.ts:createPdfTextClient`,
  `pdf-text-client.ts:extractDocumentText` - run `pdfinfo`, `pdftotext`,
  `pdftoppm` and `tesseract` as subprocesses on the file's path, and create
  and remove a temporary directory for a page's image.

## Verification

- Run: `npx vitest run test/shared/services`
