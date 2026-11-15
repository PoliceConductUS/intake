## ADDED Requirements

### Requirement: Resolve titled party names consistently

The pipeline SHALL collapse whitespace before person-name filtering, distinguish Officer from the institution word office, and score Officer and Chief prefixed parties by their personal names. It SHALL preserve existing match thresholds and anonymous-party exclusions.

#### Scenario: Titled named officer

- **WHEN** a party is `Officer  Bryan Pham` and the agency roster contains Bryan Pham
- **THEN** the party reaches matching and matches by Bryan and Pham

#### Scenario: Whitespace in chief name

- **WHEN** a party is `Chief  Mike Gudgel`
- **THEN** repeated whitespace does not exclude that party and Chief is not treated as the first name

#### Scenario: Institutions and anonymous parties

- **WHEN** a party is Office of Inspector General or Officer John Doe
- **THEN** the party remains excluded

### Requirement: Accept likely initial-based personnel matches

The matcher SHALL accept compatible first-name initials with matching surnames. Supplied middle names or initials SHALL distinguish candidates when the roster supplies them. Missing middle names SHALL increase uncertainty rather than prevent a likely match. Initial matches SHALL not require full first names, in either name order. The filter SHALL admit initial-led names.

#### Scenario: Eldreth officer initials

- **WHEN** a party is B. M. Bullin or C. C. Flores
- **THEN** the Houston roster candidates Blake M. Bullin and Christian C. Flores qualify as likely matches
- **AND** Christopher J. Flores does not qualify for C. C. Flores because the supplied middle initials conflict
