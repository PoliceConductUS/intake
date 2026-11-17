## Why

The CourtListener and Clearinghouse API tokens are read from a git-ignored `.env`. A new checkout or worktree does not have them, and a stale local copy is used without warning. Both tokens are already stored in AWS Systems Manager Parameter Store.

## What Changes

The `acquire` command takes `CLEARING_HOUSE_API_TOKEN` and `COURTLISTENER_API_TOKEN` from Parameter Store, as SecureString parameters named `/policeconduct/secrets/<NAME>`, the first time a source reads them. The stored value replaces any value in the environment. A token that cannot be read fails the acquire with the parameter named. `.env.example` no longer lists the two tokens. The CourtListener token is renamed from `COURT_LISTENER_API_TOKEN` to `COURTLISTENER_API_TOKEN`, the name the stored parameter and policeconduct.org already use, so one name is used everywhere.

## Capabilities

### New Capabilities

- `acquire-secrets`: Where the acquire command gets the API tokens its sources need.

## Impact

No Supabase migration, intake source, generated type or downstream app contract changes. No data reset or production migration plan is needed. Sources still read the tokens from the `env` they are given. Acquiring from CourtListener or the Clearinghouse now needs AWS credentials that can read the two parameters; the `aws` CLI is already a requirement of other sources. Other sources are unaffected.
