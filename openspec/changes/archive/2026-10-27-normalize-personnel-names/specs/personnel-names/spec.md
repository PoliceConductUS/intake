## ADDED Requirements

### Requirement: Consistent generational suffix display

Every source's Personnel suffix resolver SHALL normalize case-insensitive JR with
zero or more trailing periods to Jr., and SR with zero or more trailing periods
to Sr., after trimming whitespace. Blank or absent
suffixes SHALL remain null. Other suffixes SHALL retain existing normalization.
Raw acquired data, canonical IDs and established slugs SHALL remain unchanged.

#### Scenario: Junior variants converge

- **WHEN** a source supplies JR, JR., Jr.., jr, jr., Jr, or Jr.
- **THEN** the resolved suffix is Jr.

#### Scenario: Senior variants converge

- **WHEN** a source supplies SR, SR., Sr.., sr, sr., Sr, or Sr.
- **THEN** the resolved suffix is Sr.

#### Scenario: Other suffixes and missing values

- **WHEN** a source supplies III or no suffix
- **THEN** the resolved suffix is III or null respectively

### Requirement: Preserve explicit source name capitalization

Personal name normalization SHALL preserve mixed-case source spelling after
whitespace normalization. It SHALL NOT overwrite capitals already supplied by the
source with prefix or particle guesses. Generational suffix canonicalization is
applied independently through the suffix resolver.

#### Scenario: Source supplies significant internal capitals

- **WHEN** the source name is DeHoyos, LaRell, DeSylva, DeLosSantosCoy, or VanDevender
- **THEN** that spelling is preserved

#### Scenario: A prefix heuristic would invent a capital

- **WHEN** the source name is Macomb
- **THEN** the resolved spelling remains Macomb

### Requirement: Preserve source word separation

Personal name casing SHALL preserve source word boundaries after whitespace
normalization. Existing display-casing heuristics for uniformly uppercase or
lowercase names remain in use; those outputs SHALL NOT be treated as verified
personal spelling.

#### Scenario: Saint prefix retains its following space

- **WHEN** source names are ST AMOUR or ST ROMAIN
- **THEN** resolved names are St Amour and St Romain

#### Scenario: Other words retain their following space

- **WHEN** the source name is MARIA Y GOMEZ
- **THEN** the resolved name is Maria y Gomez
