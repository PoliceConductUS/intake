# Brainstorm

## Problem

`acquire` reads `CLEARING_HOUSE_API_TOKEN` and `COURTLISTENER_API_TOKEN` from a git-ignored `.env`. A new checkout or worktree has no `.env`, so the tokens are copied by hand, and a stale copy is used silently. The same tokens already live in AWS Systems Manager Parameter Store for policeconduct.org.

## Options considered

1. **Sources call a secret reader.** Each source asks for its token through a new `AcquireDeps` member. One explicit contract, but it changes the acquire contract and every test that passes a token.
2. **The CLI resolves the tokens when a source reads them (chosen).** The `acquire` command hands sources an `env` that takes the two tokens from Parameter Store on first read. Sources and their tests are unchanged, and a source that needs no token never contacts AWS.
3. **Fetch both tokens before every acquire.** Simple, but every acquire, including ones that read a local workbook, would need AWS credentials.

## Decision

Option 2. The stored value always wins over a local value, so there is one source for each token.
