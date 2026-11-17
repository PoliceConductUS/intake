## Why

API keys are read from a git-ignored `.env`. A new checkout or worktree does not have them, and a stale local copy is used without warning. Any API key or secret must come from AWS Systems Manager Parameter Store.

## What Changes

The `acquire` and `requests` commands take `ANTHROPIC_API_KEY`, `CLEARING_HOUSE_API_TOKEN`, `COURTLISTENER_API_TOKEN`, `RESEND_API_KEY`, `RESEND_API_KEY_FULL_ACCESS` and `YOUTUBE_API_KEY` from Parameter Store, as SecureString parameters named `/policeconduct/secrets/<NAME>`, the first time each is needed. The stored value replaces any value in the environment. A key that cannot be read fails the command with the parameter named. `.env.example` no longer has a line for any of the six. The CourtListener token is renamed from `COURT_LISTENER_API_TOKEN` to `COURTLISTENER_API_TOKEN`, the name the stored parameter and policeconduct.org already use, so one name is used everywhere. The CourtListener and Minnesota POST sources read `ANTHROPIC_API_KEY` only when a new Claude analysis is needed, so a cached-only acquire still needs no key.

## Capabilities

### New Capabilities

- `acquire-secrets`: Where the acquire and requests commands get their API keys.

## Impact

No Supabase migration, generated type or downstream app contract changes. No data reset or production migration plan is needed. Sources still read keys from the `env` they are given. Running a command that needs one of the six keys now needs AWS credentials that can read its parameter; the `aws` CLI is already a requirement of other sources. Not covered: the `sources daily` news discovery, which runs in GitHub Actions and still takes `SERPAPI_KEY`, `SEARCH_CONSOLE_CREDENTIALS` and `NEWS_INFERENCE_API_KEY` from GitHub secrets, and `DATABASE_URL`.
