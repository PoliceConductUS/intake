## Depends on

- [ ] `cache-call-results-and-files` phases 1 and 2 (the two envelope kinds, the store and the shared clients).

## Findings (shared import)

- [ ] Add the finding schema and pass a record's metadata whole from transform to import, at each place that copies named fields today; regenerate the envelope types; tests.
- [ ] Let a resolver report a finding through its context; tests.
- [ ] Add the source-findings and resolver-findings groups in `data generate`, failing on a kind that cannot hold annotations; tests for stable IDs, two findings with one code, and resolution.

## CourtListener

- [ ] Reduce the acquire to the agency search through the CourtListener client; tests.
- [ ] In the transform, stop supplying the summary fields; log dockets left out with the reason and count them; tests.
- [ ] Report `docket-not-buildable` on the licensing authority of the agency's state, emitting that record for every state the transform processed; tests for two dockets in one state and for the last one being fixed.
- [ ] Add the civil case resolvers for `ai_complaint_summary` and `complaint_summary_unavailability`, with a test per problem code, for the message text and address rule, for evidence, and for a problem that goes away.
- [ ] Remove the review receipt functions, the complaint steps in acquire and their tests; edit `add-ai-complaint-summary`'s spec to match.

## Validate

- [ ] Run `npm run validate`, including OpenSpec validation. No Supabase migration changes, so no Supabase validation applies. Assert each new annotation's subject record exists.
- [ ] Run `data generate` for CourtListener on the dev workspace and report cases processed, summaries written, and problems by code.
