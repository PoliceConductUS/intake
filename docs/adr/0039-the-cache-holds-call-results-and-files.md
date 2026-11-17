# ADR 0039: The Cache Holds Call Results and Files

## Status

Proposed

> Proposed with the OpenSpec change `cache-call-results-and-files`. Extends
> **ADR 0019**, which stays in force for resolved properties. Replaces the
> source-owned caches listed under Context.

## Context

ADR 0019 gave intake one cache for resolved properties: a `ResolvedProperty`
envelope per record and property, holding one entry per fingerprint of the input
that produced the value. It is stored at
`<workspace>/state/intake/namespaces/intake/ResolvedProperty/`.

Three sources then grew caches of their own, each with its own files, keys and
rules:

- **CourtListener** keeps search results in `docket-cache.json`, summaries in
  `complaint-summaries/<hash>.json`, hand-review results in `complaint-reviews/`,
  and downloads complaint PDFs into each command folder.
- **Minnesota POST** keeps extracted text and order analysis in
  `documents/<sha256>.json` in its state folder and the order PDFs in each command
  folder.
- **Personnel photos** are files in `<workspace>/assets/PersonnelPhoto/` with no
  envelope beside them.

None of them records a failed call. A failure is either retried on every run or
stops the run. None of them records enough to reproduce a call. Two of them
re-download files that an earlier command already has.

The resolved-property cache cannot take this over as it is, for two reasons only:

1. It stores the value of a property of a record. A network response or a model
   response is not a property of a record, and several records can depend on one
   response.
2. Its values are YAML. A 2 MB PDF or a photo is not.

## Decision

**The cache gains two kinds of envelope beside `ResolvedProperty`: a call result
and a binary file. Every network call, model call and downloaded file that intake
keeps goes through them.**

**1. `CallResult`.** One envelope per distinct request, at
`<workspace>/state/intake/namespaces/<namespace>/CallResult/<fingerprint>.CallResult.yaml`.
The fingerprint is the SHA-256 of the request's stable JSON, computed the way ADR
0019 computes an input fingerprint. The request holds everything that decides the
answer and nothing else: the service, the operation, the URL or the model, the
parameters (including the reasoning level), the prompt text, and the SHA-256 of
each input. It never holds a key or an authorization header.

**2. An outcome, success or failure.** The envelope holds a list of outcomes; the
last is the current one. An outcome records its status, start and end time, the
HTTP status, the provider's request ID, the stop reason, the token counts, the
response or the error, the command that made the call, and the intake version. A
developer can reproduce the call from the envelope alone, whoever made it.

**3. One rule for when to call again.** An outcome may carry `retryAfter`, an ISO
8601 date and time. Until that time the outcome stands and no call is made. After
it, the call is made again and a new outcome is appended. An outcome with no
`retryAfter` stands until the request changes. Because the request is the key, a
changed document or a changed prompt is a different envelope: nothing is expired
by hand.

**4. `BinaryFile`.** One envelope per distinct file content, at
`.../BinaryFile/<sha256>.BinaryFile.yaml`, with the file beside it under the same
name and its own extension, for example `<sha256>.pdf`. The envelope
records the size, the content type, and where the file came from: a download (URL,
time, HTTP status) or a local file (its name, the time). A call whose answer is a
file names the binary file in its outcome. A file that fails a check is still a
binary file; what failed is recorded by whoever checked it.

**4a. Entries are kept under the namespace that asked.** `<namespace>` in both
locations is the namespace of the source whose record or acquire asked, so an
entry's path is `<namespace>/<Kind>/<name>`. ADR 0019's resolved properties stay
under `intake`.

**4b. A binary file is a record that other records point at.** `BinaryFile` is
also a record kind with a table. Its ID is resolved from its SHA-256 through the
source-name mapping (ADR 0008). A record that has a file points at it with a
foreign key, as records point at each other everywhere else, and stores nothing
else about the file. No path is stored. The file's place in the workspace follows from the file's
record. Where a file is published is the website build's decision, made in one place:
a renderer asks the build's file service for a reference to a file and is handed
the address to use. Being asked is how the service knows the build references the
file, every renderer gets the same address for the same file, and the service
writes the referenced files itself. The address is root-relative today
(`/binary-file/<sha256>.<extension>`); serving the files from their own subdomain
and bucket later changes the file service and the upload step only. `PersonnelPhoto`,
which repeated the file's facts, is retired; a person points at their photo's
file.

**4d. Different files never share a name.** A file is named by the full SHA-256 of
its bytes. A write that finds the name taken compares the bytes and fails if they
differ; a read hashes the file again and fails if the hash is not its name.

**4c. The resolver backend manages files.** Storing bytes, downloading a URL, and
giving the envelope, the bytes or the path for a reference are operations of the
backend every resolver is handed. No source reads or writes a file in the cache
itself.

**5. Failures are of two sorts.** A failure of one item (a 403 or 404 for one
document, a file that is not what it should be, a model refusal for one text) is
recorded and the command continues. A failure of the service (no response, a
connection error, throttling or server errors that outlast the retries) is
recorded with a `retryAfter` and the command stops, naming the service and the
time. Before its first call to a service in a command, intake checks that the
service answers and accepts its key, so that a service failure is found before any
record is processed.

**6. One client per service, used by every source.** Each outside service has
one client in shared code: a CourtListener client, an inference client for model
calls, a file download client. A client builds the request, reads and writes the
cache, checks the service before its first call, retries, and classifies a
failure. A pipeline stage that needs a service is passed its client. No source or
stage calls a service or the cache store directly, and none keeps its own copy of
this logic.

**7. Calls that fill a field run in `data generate`.** A model call, an API call
or a download whose result ends up in a field of a record is made by that field's
resolver during `data generate`, as geocoding already is, through the client it is
passed. `data acquire` keeps the calls that list a source's own records.

**8. A property derived only from cached call results is not cached again.** ADR
0019's rule that an absent result is never cached stands. A resolver that finds a
failed outcome returns no value and reports a finding (ADR 0040); the failure
lives in the call result, not as a cached property.

**9. No source keeps a cache of its own.** The three listed under Context move
into these two kinds, and their existing contents are moved once.

## Consequences

- `data generate` needs API keys, so it reads them from Parameter Store as
  `data acquire` does.
- The first `data generate` after a source moves is slow, because it makes the
  calls. Later ones read the cache.
- The cache holds large files. The workspace grows by the size of every document
  and photo kept.
- A cached response is evidence. It is kept when the request changes; nothing in
  this decision deletes an envelope.
- The CourtListener request log (`.api-calls.jsonl` in the command folder) is
  replaced by the call results themselves.

## Alternatives Considered

- **Store a failed result as an absent value in `ResolvedProperty`.** Rejected: an
  absent value would look like a cache hit and hide a later correction, which is
  why ADR 0019 forbids it.
- **Keep one cache per source and add failure records to each.** Rejected: three
  sets of rules for the same need, and files still downloaded per command.
- **Let each source wrap the cache itself.** Rejected: the request shape, the
  retries and the failure rules would be written once per source and drift.
- **Store files in a separate file store with no envelope.** Rejected: a file with
  no record of where it came from is not evidence.

## Revisit Trigger

Revisit when the cost of syncing the workspace to remote storage is known (the
sync is a policeconduct.org command run after `data generate`), since large files
change what a sync costs, or when a call's response is too large to keep inline in YAML.
