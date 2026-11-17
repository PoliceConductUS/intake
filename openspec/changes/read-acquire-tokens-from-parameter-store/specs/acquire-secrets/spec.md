## ADDED Requirements

### Requirement: Acquire tokens come from Parameter Store

The acquire command SHALL provide `CLEARING_HOUSE_API_TOKEN` and `COURTLISTENER_API_TOKEN` to sources from AWS Systems Manager Parameter Store, reading the SecureString parameter `/policeconduct/secrets/<NAME>` with decryption. The stored value SHALL replace any value of the same name in the process environment.

#### Scenario: A source reads its token

- **WHEN** a source reads `COURTLISTENER_API_TOKEN` from the environment it is given
- **THEN** it receives the value stored in `/policeconduct/secrets/COURTLISTENER_API_TOKEN`

#### Scenario: A stale local value exists

- **WHEN** the process environment also holds a value for the token
- **THEN** the source receives the stored value, not the local one

### Requirement: Tokens are read only when a source asks

The acquire command SHALL contact Parameter Store only when a source reads one of the two tokens, and SHALL read each token at most once per command.

#### Scenario: A source that needs no token

- **WHEN** a source that reads neither token is acquired
- **THEN** Parameter Store is not contacted

### Requirement: An unreadable token fails the acquire

When a token cannot be read or is empty, the acquire SHALL fail with a message that names the parameter, and SHALL NOT fall back to a local value.

#### Scenario: The parameter cannot be read

- **WHEN** Parameter Store returns an error or an empty value for a token a source reads
- **THEN** the acquire exits non-zero and its message names `/policeconduct/secrets/<NAME>`
