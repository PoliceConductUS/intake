## Implementation

- [x] Add the Parameter Store environment for the acquire command, with tests.
- [x] Use it in the `acquire` command.
- [x] Rename `COURT_LISTENER_API_TOKEN` to `COURTLISTENER_API_TOKEN` in the source, its tests and `.env.example`.
- [x] Remove the two tokens from `.env.example` and say where they live.
- [x] Run `npm run validate`, including OpenSpec validation. No Supabase migration or loaded data changes, so no Supabase validation or integrity assertions apply.
