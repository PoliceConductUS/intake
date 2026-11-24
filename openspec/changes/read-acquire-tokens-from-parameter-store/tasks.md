## Implementation

- [x] Add the Parameter Store environment for the acquire command, with tests.
- [x] Use it in the `acquire` command.
- [x] Rename `COURT_LISTENER_API_TOKEN` to `COURTLISTENER_API_TOKEN` in the source, its tests and `.env.example`.
- [x] Remove the two tokens from `.env.example` and say where they live.
- [x] Run `npm run validate`, including OpenSpec validation. No Supabase migration or loaded data changes, so no Supabase validation or integrity assertions apply.
- [x] Add `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `RESEND_API_KEY_FULL_ACCESS` and `YOUTUBE_API_KEY` to the Parameter Store environment and its test.
- [x] Use the Parameter Store environment in the `requests` command, with a test.
- [x] Read `ANTHROPIC_API_KEY` in the CourtListener and Minnesota POST sources only when an analysis is needed.
- [x] Remove the four keys from `.env.example` and update `docs/records-requests.md`.
- [x] Run `npm run validate` again.
- [x] Add `SERPAPI_KEY` to the Parameter Store environment and its test.
- [x] Give the source's `daily` the Parameter Store environment in `sources daily`, with a test, and read `SERPAPI_KEY` from it in the SerpApi landing-page search.
- [x] Remove `SERPAPI_KEY` from the news discovery workflow, `.env.example` and the source README.
- [x] Do the same for `SEARCH_CONSOLE_CREDENTIALS` and `NEWS_INFERENCE_API_KEY`, with tests.
