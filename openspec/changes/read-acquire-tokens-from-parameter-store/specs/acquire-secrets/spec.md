## ADDED Requirements

### Requirement: API keys come from Parameter Store

The acquire and requests commands SHALL take `ANTHROPIC_API_KEY`, `CLEARING_HOUSE_API_TOKEN`, `COURTLISTENER_API_TOKEN`, `RESEND_API_KEY`, `RESEND_API_KEY_FULL_ACCESS` and `YOUTUBE_API_KEY` from AWS Systems Manager Parameter Store, reading the SecureString parameter `/policeconduct/secrets/<NAME>` with decryption. The stored value SHALL replace any value of the same name in the process environment.

#### Scenario: A source reads its token

- **WHEN** a source reads `COURTLISTENER_API_TOKEN` from the environment it is given
- **THEN** it receives the value stored in `/policeconduct/secrets/COURTLISTENER_API_TOKEN`

#### Scenario: The requests command reads its keys

- **WHEN** `requests sync` runs
- **THEN** it uses the values stored in `/policeconduct/secrets/RESEND_API_KEY_FULL_ACCESS` and `/policeconduct/secrets/ANTHROPIC_API_KEY`

#### Scenario: A stale local value exists

- **WHEN** the process environment also holds a value for the key
- **THEN** the command uses the stored value, not the local one

### Requirement: Keys are read only when needed

A command SHALL contact Parameter Store only when one of the keys is needed, and SHALL read each key at most once per command.

#### Scenario: A source that needs no key

- **WHEN** a source that reads none of the keys is acquired
- **THEN** Parameter Store is not contacted

#### Scenario: Every analysis is already cached

- **WHEN** an acquire needs no new Claude analysis
- **THEN** `ANTHROPIC_API_KEY` is not read from Parameter Store

### Requirement: An unreadable key fails the command

When a key cannot be read or is empty, the command SHALL fail with a message that names the parameter, and SHALL NOT fall back to a local value.

#### Scenario: The parameter cannot be read

- **WHEN** Parameter Store returns an error or an empty value for a key a command needs
- **THEN** the command exits non-zero and its message names `/policeconduct/secrets/<NAME>`
