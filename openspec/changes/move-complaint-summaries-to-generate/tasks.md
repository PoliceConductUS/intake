## Depends on

- [ ] `cache-call-results-and-files` phases 1 and 2 (the two envelope kinds, the store and the shared clients).

## Findings (shared import)

- [x] Add the finding schema and pass a record's metadata whole from transform to import, at each place that copies named fields today; regenerate the envelope types; tests.
- [x] Let a resolver report a finding through its context; tests.
- [x] Add the source-findings and resolver-findings groups in `data generate`, failing on a kind that cannot hold annotations; tests for stable IDs, two findings with one code, and resolution.

## CourtListener

- [x] Reduce the acquire to the agency search through the CourtListener client; tests.
- [x] In the transform, stop supplying the summary fields; log dockets left out with the reason and count them; tests.
- [x] Report `docket-not-buildable` on the licensing authority of the agency's state, emitting that record for every state the transform processed; tests for two dockets in one state and for the last one being fixed.
- [ ] Write the Supabase migration that replaces the `civil_cases` check requiring `sha1Verified` to be true with one requiring a boolean; reset and apply every migration. Not written: `20261111230000_relax_complaint_summary_requirements.sql` already removed that requirement, and `test/import/complaint-summary.integration.test.ts` stores a summary with `sha1Verified: false` in a database built from every migration. Owner's decision: drop this task, or add a check that `sha1Verified` is a boolean when present.
- [x] Add the civil case resolvers for `ai_complaint_summary` and `complaint_summary_unavailability`, with a test per problem code, for the message text and address rule, for evidence, for a problem that goes away, and for a mismatched file that is summarized with `sha1Verified: false` and its annotation.
- [x] Remove the review receipt functions, the complaint steps in acquire and their tests; edit `add-ai-complaint-summary`'s spec to match.

## Validate

- [ ] Run `npm run validate`, including OpenSpec validation. Run the Supabase validation and a reset that applies every migration. Assert each new annotation's subject record exists.
- [ ] Run `data generate` for CourtListener on the dev workspace and report cases processed, summaries written, and problems by code.
