## Cache

- [x] Add the `CallResult` and `BinaryFile` envelope kinds with canonical IO in `src/shared/io/`, with tests for strict validation, naming, earlier outcomes kept, and a file whose hash does not match its name.
- [x] Add the cache store operations for the two kinds beside the resolved-property store, with tests for the `retryAfter` rule on succeeded and failed outcomes.

- [ ] Make `data reset --no-acquire` use cached results as they are, and make the commands that skip acquire warn when a source's acquire is due; tests.

## Service clients

- [x] Add the shared client base: request fingerprint, cache read and write, the check before first call, retries, and item failure versus service failure, with tests for each.
- [x] Add the file download client, with tests.
- [x] Add the inference client, recording model, parameters, prompt, input hashes, request ID, stop reason and token counts, with tests.
- [x] Add the CourtListener client for search and docket entries, with tests.
- [x] Give `data generate`, `data update` and `data reset` the Parameter Store environment and pass clients to the import, with tests.

## Sources

- [x] CourtListener: use the CourtListener client for the agency search and stop reading or writing `docket-cache.json`, `complaint-summaries/`, `complaint-reviews/`, the command-folder complaint files and `.api-calls.jsonl`. The files already in a workspace stay until the one-time move has carried their calls over and the reset after it is verified. The rest of the source's move is in `move-complaint-summaries-to-generate`.
- [ ] Minnesota POST, after CourtListener is fully implemented and only once the owner says to start (it must be done before the next reset): download order PDFs through the file download client; move text extraction to a shared text extraction step and the order analysis to resolvers in `data generate`; remove the `documents/` state cache and the command-folder PDFs and document records, with tests.
- [ ] Add file management to the resolver backend: store bytes or download a URL and return a reference; give the envelope, the bytes or the workspace path for a reference; tests.
- [ ] Make `BinaryFile` a record kind with a `binary_file` table, its ID resolved from its SHA-256; a write that finds its name taken by different bytes fails; tests.
- [ ] Personnel photos: add `personnel.photo_id` pointing at a binary file; move each `personnel_photo` row and drop the table in one migration with explicit IDs; make `intake photo import` store the photo in the cache and record a manual update of the person's `photo_id`, the only thing that sets it; tests. This change alone retires `assets/PersonnelPhoto/`.

## Move what exists

The move is a one-time script run against a clone of the workspace, kept beside `~/dev/PoliceConductUS/intake-workspace/migration-2026-11-17/` with its own `README.md`; no migration code or command is added to intake (design section 7). Order: design section 8.

- [ ] Let a `CallResult` outcome with `producedBy` leave out `startedAt` and `intakeVersion`, and keep both required on every other outcome; tests.
- [ ] CourtListener and photo move, before the full CourtListener acquire and before `keep-state-under-one-root`'s move, which removes `assets/` once the photo is in the cache: carry the 12 searches and 85 docket entries requests over from the `.api-calls.jsonl` call logs, each request built by `searchDocketsRequest` or `docketEntriesRequest`; each outcome with `producedBy` naming its call log and no `startedAt` or `intakeVersion`; store the 25 complaint PDFs as `BinaryFile` with origin `local`; move `assets/PersonnelPhoto/` into the cache and rewrite the manual source's `PersonnelPhoto` record as the manual `photo_id` update `intake photo import` would record, pointing at that file; delete the `resume` line of CourtListener's `acquire.yaml`; run twice on one clone (the second run changes nothing) and once on a fresh clone (the same output); assert each carried-over request's fingerprint equals the client's and each moved file's SHA-256 equals its name.
- [ ] Minnesota move, after the Minnesota task and before the next reset: the order PDFs, and the page text and analyses of the 601 `*.document.json` files (530 distinct PDFs), each analysis with `requestedModel` and `model` `gpt-6-astra` and `producedBy: codex-document-review`, each PDF a `BinaryFile` with origin `local`; assert every moved file's SHA-256 and every moved analysis is found by the request `data generate` computes.
- [ ] Assert each person who had a photo has a `photo_id` whose binary file exists, with its hash and size unchanged.
- [ ] After the reset is verified, delete the `.api-calls.jsonl` files, `docket-cache.json`, the Minnesota `documents/` state folder and the command-folder files the move copied into the cache. `assets/` is removed by `keep-state-under-one-root`'s one-time move, after the photo is in the cache.
- [ ] In policeconduct.org, add one file service to the build that a renderer asks for a reference to a file: it returns the same root-relative address for the same file (today `/binary-file/<sha256>.<extension>`), records that the file is referenced, and writes the referenced files itself; renderers stop copying files or building addresses (a change in that repository, released with this one).

## Validate

- [ ] Run `npm run validate`, including OpenSpec validation, and a database reset that applies every migration.
- [ ] Run `data reset` on the dev workspace and report calls made, calls served from the cache, and failures by service.
- [ ] After the reset, sync the workspace to S3 with the policeconduct.org command.
