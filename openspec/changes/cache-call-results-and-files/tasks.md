## Built in commit 7275ec3

These were built with a `CallResult` envelope and a `BinaryFile` envelope beside the resolved-property cache. The rework below replaces that second cache mechanism (owner's ruling, 2026-11-19); the clients and the CourtListener acquire stay.

- [x] Add the `CallResult` and `BinaryFile` envelope kinds with canonical IO in `src/shared/io/`, with tests for strict validation, naming, earlier outcomes kept, and a file whose hash does not match its name. Replaced by the rework.
- [x] Add the cache store operations for the two kinds beside the resolved-property store, with tests for the `retryAfter` rule on succeeded and failed outcomes. Replaced by the rework.
- [x] Make `data reset --no-acquire` use cached successful results as they are, even after their `retryAfter`; tests.
- [x] Add the shared client base: request fingerprint, cache read and write, the check before first call, retries, and item failure versus service failure, with tests for each.
- [x] Add the file download client, with tests.
- [x] Add the inference client, recording model, parameters, prompt, input hashes, request ID, stop reason and token counts, with tests.
- [x] Add the CourtListener client for search and docket entries, with tests.
- [x] Add the PDF text client, moved from the Minnesota source's `document-text.ts`, with a check that names every one of `pdfinfo`, `pdftotext`, `pdftoppm` and `tesseract` that cannot be run; pin `conda:poppler` and `conda:tesseract` in `mise.toml`; tests.
- [x] Give `data generate`, `data update` and `data reset` the Parameter Store environment and pass clients to the import, with tests.
- [x] CourtListener: use the CourtListener client for the agency search and stop reading or writing `docket-cache.json`, `complaint-summaries/`, `complaint-reviews/`, the command-folder complaint files and `.api-calls.jsonl`. The files already in a workspace stay until the one-time move has carried their calls over and the reset after it is verified. The rest of the source's move is in `move-complaint-summaries-to-generate`.

## Rework onto one cache (design section 1 and Implementation Plan step R)

- [ ] Add the call entry (`request`, `outcomes`) to the entry schema of `src/cli/state/resolved-property/ResolvedProperty.ts`, with the credential checks; add reading an entry's standing outcome (with `keepSucceeded`) and appending an outcome to `src/cli/state/resolved-property/index.ts`; tests: each branch of the rule for calling again, the reset rule, a write that would drop an outcome fails, a request with an `Authorization` value is rejected.
- [ ] Write every `ResolvedProperty` envelope to a temporary name of its own writer (the envelope's name with the process ID, a random suffix and `.tmp`) and rename it; tests: a failed rename leaves the earlier envelope whole, and two writers never share a temporary name.
- [ ] Remove `src/shared/io/CallResult.ts`, `src/shared/io/BinaryFile.ts` and `src/cli/state/call-cache/`, their exports and their tests, and move the store tests onto the resolved-property store.
- [ ] Implement `src/shared/services/client-base.ts:CallCache` over the resolved-property store; `cachedCall` and every client operation take the subject from the caller; keep each answer inline (the 256 KB rule goes); a download's answer is the file's facts and its bytes are stored under the caller's namespace; tests.
- [ ] Build clients once per command in `src/cli/service-clients.ts:buildServiceClients`, with no namespace for the cache; pass each agency as the subject in `sources/com/courtlistener/www/api/acquire.ts` and the civil case in `src/cli/import/artifacts/facades/complaint-summary-resolvers.ts`; tests.
- [ ] Item failures get a `retryAfter` 24 hours on; 401, 403 and account or credit errors after the check are outages; after the retries the check runs again, and a call whose service answers it is an item failure; the inference check confirms the model asked for exists; an empty answer is a success; tests, one per row of the design's section 4 table.
- [ ] Make the CourtListener acquire make every other call, then exit non-zero naming each failed or skipped search, and not be recorded as completed; tests.
- [ ] Add the `intake cache` operation that retires a stored result, with the required `--message`, in `src/cli/cache/index.ts`; tests.
- [ ] Record `toolVersions` on PDF text outcomes, and give each run of `pdfinfo`, `pdftotext`, `pdftoppm` and `tesseract` a time limit, recorded as a failure of that file; tests.
- [ ] Count calls made, calls the cache answered and calls skipped in each client, and print them per service at the end of `data reset` with the size of the cache and of the `BinaryFile` folders; tests.
- [ ] Add tests that pin the fingerprint of a known request for every request builder and of `typedInputFingerprint`.

## Sources

- [ ] Write into design section 9, before the Minnesota task starts: the MODIFIED deltas for the `intake-stage-completion` requirements "Referenced disciplinary documents have an explicit processing outcome" and "Null document narratives have explicit field-level absence reasons", and how a reset replays the Minnesota command folders made before the change.
- [ ] Minnesota POST, after CourtListener is fully implemented and only once the owner says to start (it must be done before the next reset), and after the rest of its design is written into design section 9 (the task below): download order PDFs through the file download client and save each in the command folder as well; remove the acceptance of `codex-document-review` results in `document-evidence.ts` and `collect-documents.ts`; cache text extraction and analysis under the order's `BinaryFile` record and add `Discipline`'s foreign key to it; drop the server-side fallback and keep `absenceReasons` in the output schema; move the order analysis to discipline resolvers in `data generate` that fill the five order fields; remove the `documents/` state cache and the command-folder text and analysis records; tests.
- [ ] Make `BinaryFile` a generated record kind (`sha256` as its business key; `workspace_path` a resolved property cached with no input fingerprint) with a `binary_file` table, its ID from the source-name mapping with the SHA-256 as its source name; a write that finds a file's name taken by different bytes fails; tests: the same bytes from two sources are one record, and `workspace_path` keeps the first path.
- [ ] Personnel photos: add `personnel.photo_id` pointing at a `BinaryFile`; carry over each `personnel_photo` row and drop the table in one migration; add `Personnel` and `BinaryFile` to the manual source's handled kinds and remove `PersonnelPhoto`; make `intake photo import` store the bytes under `org/policeconduct/manual` and emit the `BinaryFile` record and a manual update of the person's `photo_id`, the only thing that sets it from the workspace; remove `PersonnelPhoto` from the files Implementation Plan step 8 lists and run `npm run generate:envelope-types` and `npm run generate:data-request-doc`; tests. This change alone retires `assets/PersonnelPhoto/`.

## Move what exists

The move is a one-time script run against a clone of the workspace, kept beside `~/dev/PoliceConductUS/intake-workspace/migration-2026-11-17/` with its own `README.md`; no migration code or command is added to intake (design section 7). Order: design section 8.

- [ ] Let an outcome with `producedBy` leave out `startedAt` and `intakeVersion`, and keep both required on every other outcome; tests: with `producedBy`, no `startedAt` passes and no `intakeVersion` passes; without `producedBy`, either missing fails; `commandId` missing fails with or without `producedBy`.
- [ ] After the rework, the CourtListener and photo move, before the full CourtListener acquire and before `keep-state-under-one-root`'s move: carry up to 12 searches and 85 docket entries calls over from the `.api-calls.jsonl` call logs as call entries of the agency or civil case design section 7 names, each request built by `searchDocketsRequest` or `docketEntriesRequest`, each outcome with `producedBy` naming its call log and no `startedAt` or `intakeVersion`; copy the 25 complaint PDFs' bytes under `com/courtlistener/www/api`; copy the photo's bytes under `org/policeconduct/manual` and write a new manual chain output that holds its `BinaryFile` record and the `photo_id` update and leaves out the `PersonnelPhoto` entry; clear the `resume` line of CourtListener's `acquire.yaml`; run twice on one clone (the second run changes nothing) and once on a fresh clone (the same output); assert each carried-over request's fingerprint equals the client's and each moved file's SHA-256 equals its name.
- [ ] Minnesota move, after the Minnesota task and before the next reset: the order PDFs' bytes and the page text and analyses of the 530 distinct PDFs, taken from the 601 `*.document.json` files, as call entries of the subject the Minnesota design names; each analysis with `requestedModel` and `model` `gpt-6-astra`, `producedBy: codex-document-review`, and its `absenceReasons` and `reviewReceipt` in the answer; assert every moved file's SHA-256, that every moved analysis is found by the request `data generate` computes, and that every moved page count and page text is found by the PDF text client's requests.
- [ ] Assert each person who had a photo has a `photo_id` whose `binary_file` row exists, with bytes at its `workspace_path` whose hash and size are unchanged, after the migration and after the reset.
- [ ] After the reset is verified, delete the `.api-calls.jsonl` files, `docket-cache.json` and the Minnesota `documents/` state folder. Old command folders, with their PDFs, stay. `assets/` is removed by `keep-state-under-one-root`'s one-time move, after the photo is moved. The workspace kept as the backup is kept until the next verified reset after the Minnesota move.

## ADR and the CourtListener acquire

- [ ] Bring ADR 0039 in line with this design (one cache: call entries in `ResolvedProperty`; files as records stored by namespace; when the check runs and what a failed check stops; how long a skip lasts; the four clients and the code that still calls a service itself; an acquire that fails at its end; the `ResolvedProperty` path) and accept it.
- [ ] After the rework and the CourtListener and photo move, run the full CourtListener acquire (design section 8, step 4).

## policeconduct.org

- [ ] In policeconduct.org, read `binary_file` and its `workspace_path` in place of `personnel_photo`, check each file's hash and size, and publish it at `/binary-file/<sha256>.<extension>`, so that the next website build after the migration works (a change in that repository).

## Validate

- [ ] Run `npm run validate`, including OpenSpec validation, and a database reset that applies every migration.
- [ ] Run `data reset --no-acquire` on the dev workspace and report what it prints: calls made, calls the cache answered, failures by service, and the size of the cache.
- [ ] After the reset, run the policeconduct.org command that syncs the workspace to S3 (building it is not part of this change).
