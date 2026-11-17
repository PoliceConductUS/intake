## Cache

- [ ] Add the `CallResult` and `BinaryFile` envelope kinds with canonical IO in `src/shared/io/`, with tests for strict validation, naming, earlier outcomes kept, and a file whose hash does not match its name.
- [ ] Add the cache store operations for the two kinds beside the resolved-property store, with tests for the `retryAfter` rule on succeeded and failed outcomes.

## Service clients

- [ ] Add the shared client base: request fingerprint, cache read and write, the check before first call, retries, and item failure versus service failure, with tests for each.
- [ ] Add the file download client, with tests.
- [ ] Add the inference client, recording model, parameters, prompt, input hashes, request ID, stop reason and token counts, with tests.
- [ ] Add the CourtListener client for search and docket entries, with tests.
- [ ] Give `data generate`, `data update` and `data reset` the Parameter Store environment and pass clients to the import, with tests.

## Sources

- [ ] CourtListener: use the CourtListener client for the agency search and remove `docket-cache.json`, `complaint-summaries/`, `complaint-reviews/`, the command-folder complaint files and `.api-calls.jsonl`. The rest of the source's move is in `move-complaint-summaries-to-generate`.
- [ ] Minnesota POST, after CourtListener is fully implemented and only once the owner says to start (it must be done before the next reset): download order PDFs through the file download client; move text extraction to a shared text extraction step and the order analysis to resolvers in `data generate`; remove the `documents/` state cache and the command-folder PDFs and document records, with tests.
- [ ] Add file management to the resolver backend: store bytes or download a URL and return a reference; give the envelope, the bytes or the workspace path for a reference; tests.
- [ ] Make `BinaryFile` a record kind with a `binary_file` table, its ID resolved from its SHA-256; a write that finds its name taken by different bytes fails; tests.
- [ ] Personnel photos: add `personnel.photo_id` pointing at a binary file; move each `personnel_photo` row and drop the table in one migration with explicit IDs; make `intake file import` record a manual update of the person's `photo_id`; tests.

## Move what exists

- [ ] Add `intake cache migrate` and run it on the dev workspace; assert every moved file's SHA-256 and every moved analysis is found by the request `data generate` computes.
- [ ] Assert each person who had a photo has a `photo_id` whose binary file exists, with its hash and size unchanged.
- [ ] In policeconduct.org, add one file service to the build that a renderer asks for a reference to a file: it returns the same root-relative address for the same file (today `/binary-file/<sha256>.<extension>`), records that the file is referenced, and writes the referenced files itself; renderers stop copying files or building addresses (a change in that repository, released with this one).

## Validate

- [ ] Run `npm run validate`, including OpenSpec validation, and a database reset that applies every migration.
- [ ] Run `data reset` on the dev workspace and report calls made, calls served from the cache, and failures by service.
- [ ] After the reset, sync the workspace to S3 with the policeconduct.org command.
