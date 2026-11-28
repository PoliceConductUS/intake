## Depends on

- [ ] `cache-call-results-and-files` steps 1 to 6 (built in commit 7275ec3), its step 8 (`BinaryFile` as a record kind and the `binary_file` table) and its step R: call results become entries of the one cache, `ResolvedProperty`; item failures get a 24-hour `retryAfter`; key, account and credit errors after the check are outages; the `intake cache` retire operation; a time limit per PDF program run, past which the file fails; the CourtListener acquire fails at its end naming each failed or skipped search.

## Findings (shared import)

- [x] Add the finding schema and pass a record's metadata whole from transform to import, at each place that copies named fields today; regenerate the envelope types; tests.
- [x] Let a resolver report a finding through its context; tests.
- [x] Add the source-findings and resolver-findings groups in `data generate`, failing on a kind that cannot hold annotations; tests for stable IDs, two findings with one code, and resolution.

## CourtListener

- [x] Add `docketIdFromUrl` to `src/shared/services/courtlistener-client.ts`; tests.
- [x] Reduce the acquire to the agency search through the CourtListener client; tests.
- [ ] Test that an empty search result is a success and that a failed or skipped search leaves the other agencies' files written and fails the acquire at its end (after step R of `cache-call-results-and-files`).
- [x] In the transform, stop supplying the summary fields; log dockets left out with the reason and count them; tests.
- [x] Report `docket-not-buildable` on the licensing authority of the agency's state, emitting that record for every state the transform processed; tests for two dockets in one state and for the last one being fixed.
- [x] Add the civil case resolvers for `ai_complaint_summary` and `complaint_summary_unavailability`, with a test per problem code, for the message text and address rule, for evidence, for a problem that goes away, and for a mismatched file that is summarized with `sha1Verified: false` and its annotation.
- [ ] Download and summarize a complaint with no recorded SHA-1, reporting the `complaint-no-check` warning with its new message and `sha1Verified: false`; tests for it and for no recorded SHA-1 with no text.
- [ ] Split `complaint-entries` into `complaint-entries` (the list could not be fetched) and `complaint-entries-unusable` (no filing in the list is a usable complaint), both warnings with their messages; tests.
- [ ] Group resolver findings by the artifact's source namespace in `visitMutations`, and stop calling `keepFindings()` for a case that is not a CourtListener docket; test that one source's run does not resolve another source's resolver annotations.
- [ ] Remove `publicationStatus`, `url`, `sha1` and `sha256` from the resolver's output, from `aiComplaintSummary` in `src/shared/ai-complaint-summary.ts` and from `test/ai-complaint-summary.test.ts`.
- [ ] Add `civil_cases.complaint_file_id`, a foreign key to `binary_file`: the entity descriptor, one Supabase migration and regenerated types; the resolver stores the downloaded file through the resolver backend, whose `BinaryFile` record is written in the same `data generate`; test against a database built from every migration that the case points at the served file's row; reset and apply every migration; assert every `complaint_file_id` names an existing `binary_file` row.
- [ ] Test that a PDF program past its time limit gives `complaint-no-text` and the run goes on.
- [ ] Test "The file later matches", both branches: a refreshed entries result records a SHA-1 equal to the file already kept, with no new download; and a refreshed entries result gives a new file address whose download matches. In each, the summary records `sha1Verified: true` and the `complaint-mismatch` annotation is resolved with its ID.
- [x] Remove CourtListener's review receipt functions, the complaint steps in acquire and their tests; edit `add-ai-complaint-summary`'s spec to match.

## Manual data

- [ ] Through the manual source, add a licensing authority for every state the workspace's agencies are in that has none: DC, Virginia and Illinois in the dev workspace.

## Validate

- [ ] Run `npm run validate`, including OpenSpec validation. Run the Supabase validation and a reset that applies every migration. Assert each new annotation's subject record exists.
- [ ] With the owner's go-ahead, and after the manual data above is added, run `data generate` for CourtListener on the dev workspace and report cases processed, summaries written, problems by code, new annotations, the model calls' total token counts and the run's peak memory.
