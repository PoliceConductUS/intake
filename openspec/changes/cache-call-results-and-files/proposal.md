## Why

Intake has one cache for the values of record properties (ADR 0019). Three sources keep caches of their own beside it, each with its own files, keys and rules: CourtListener (search results, summaries, hand-review results, PDFs per command folder), Minnesota POST (document text and analysis, PDFs per command folder) and personnel photos (files with no envelope). None records a failed call, so a failure is retried on every run or stops the run. None records enough to reproduce a call. Files are downloaded again by later commands.

## What Changes

- **The cache holds call results.** A new envelope kind, `CallResult`, records one request and its outcomes, success or failure. Its name is the fingerprint of the request, so a changed document or prompt is a different entry. It holds what a developer needs to reproduce the call: the service, the model and parameters including the reasoning level, the prompt text, the hashes of the inputs, the response or the error, the provider's request ID, and the times. It never holds a key.
- **The cache holds files.** A new envelope kind, `BinaryFile`, describes one file by its SHA-256, with the file stored beside the envelope under the same name and its own extension.
- **One rule for calling again.** An outcome may carry `retryAfter`, an ISO 8601 date and time. Until then it stands; after it the call is made again. With no `retryAfter` it stands until the request changes.
- **One client per service.** A CourtListener client, an inference client and a file download client live in shared code. Each wraps the cache, checks the service before its first call in a command, retries, and tells a failure of one item from a failure of the service. A stage is passed the client it needs. Every source uses the same ones.
- **A failure of one item does not stop a command, and neither does an outage partway through.** If a service is down when a command starts, the command does not start. If it goes down during the run, the calls that need it are skipped, nothing they would have filled is changed, and the command reports what it skipped and when to try again.
- **A binary file is a record that other records point at.** `BinaryFile` gets a table. A record that has a file points at it with a foreign key, the way records point at each other everywhere else, and stores nothing else about the file. No path is stored: the file's place in the workspace follows from the file's record, and where it is published is decided by the website build's file service, which a renderer asks for a reference. File management is part of the resolver backend, so no source handles files itself.
- **`PersonnelPhoto` is retired.** A person points at their photo's binary file with `photo_id`.
- **`data generate` reads API keys from Parameter Store,** because calls that fill a field now run there.
- **The three source-owned caches are removed** and what they hold today is moved into the cache once, through a new `intake cache migrate` command: CourtListener's `docket-cache.json` and the entries and PDFs in its last command folder; Minnesota POST's `documents/` cache and order PDFs; the personnel photo files.
- **Hand-review results are no longer produced.** The functions that record a review of a document outside the pipeline are removed. Minnesota's existing reviewed analyses are moved into the cache as call results that say who produced them.

## Capabilities

### New Capabilities

- `call-and-file-cache`: The `CallResult` and `BinaryFile` envelopes and the rule for calling again.
- `service-clients`: The shared clients that wrap the cache for each outside service.

### Modified Capabilities

- `mn-post-discipline-orders`: Order documents, their text and their analysis are kept in the cache; a hand-reviewed result is no longer accepted as new input.

## Impact

Affected intake sources: `com/courtlistener/www/api`, `com/site/my/mnitservices/post-license-search`, and the `photo` command. Affected shared code: the cache store, the import's resolver context, and the `data generate`, `data update` and `data reset` commands' environment.

Supabase: one migration that creates `binary_file`, adds `personnel.photo_id`, moves the existing photo row and drops `personnel_photo`. This needs a generated type refresh.

Downstream: policeconduct.org reads `personnel_photo` to stage photos into its build, so it must change with this: its renderers ask one file service in the build for a reference to a file. The service returns the address to put in the page (root-relative for now, `/binary-file/<sha256>.<extension>`), records that the build references the file, and writes the file there itself. Later the referenced files are uploaded to their own bucket, under a folder per commit and build, behind a subdomain, while the site goes to another; that is not part of this change.

CourtListener is done first. Minnesota POST is started only after CourtListener is fully implemented and the owner says to; it must be finished before the next reset. This needs a data reset after the one-time move, so that every source is rebuilt from the cache. It needs no generated type refresh beyond the envelope types for the two new kinds. After the reset the workspace is synced to S3 by the policeconduct.org command that runs after `data generate`; that command is not part of this change.

The design is recorded in ADR 0039, proposed with this change.
