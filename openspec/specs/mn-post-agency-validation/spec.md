# mn-post-agency-validation Specification

## Purpose

Preserve MN POST agencies by formatting compact ZIP+4 values before canonical validation.

## Requirements

### Requirement: MN POST formats compact ZIP+4 values

MN POST SHALL format an agency ZIP consisting of exactly nine digits into five digits, a hyphen, and four digits before canonical artifact validation. All digits including leading zeros SHALL be preserved. Five-digit and already hyphenated ZIP values SHALL remain unchanged. Raw input SHALL remain unchanged. Other malformed or placeholder ZIP values SHALL remain subject to shared schema rejection.

#### Scenario: Compact ZIP+4 from the agency export

- **WHEN** an agency supplies ZIP 551554047
- **THEN** its emitted ZIP is 55155-4047 and its agency and assignments remain in the valid artifact

#### Scenario: Leading zero in a compact ZIP+4

- **WHEN** an agency supplies ZIP 012345678
- **THEN** its emitted ZIP is 01234-5678
