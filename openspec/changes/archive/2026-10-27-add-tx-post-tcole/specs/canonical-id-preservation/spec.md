## ADDED Requirements

### Requirement: Ledger seeded from external source-key to canonical-ID maps

A one-time ledger-seed step SHALL transcribe the prior TCOLE identity maps
(`agencies.yaml` keyed by `DEPARTMENT_NUMBER`, `personnel.yaml` keyed by
`PUBLIC_GUID`, `agency-officers.yaml` keyed by the service tuple) into the intake
`SourceNameToCanonicalId` ledger for namespace `gov.tx.tcole`, using the existing
`persistSourceNameToCanonicalIds` writer so that record naming and encoding match
what the loader reads. The ledger entry name MUST equal the source key and its
`canonicalId` MUST equal the mapped existing ID.

#### Scenario: a mapped department number seeds its existing agency ID

- **WHEN** `agencies.yaml` maps `DEPARTMENT_NUMBER` `101100` to agency ID
  `cm76wpxb601c7vrvgow6oyt53`
- **THEN** the ledger contains an Agency `SourceNameToCanonicalId` record whose
  `metadata.name` is `101100` and whose `spec.canonicalId` is
  `cm76wpxb601c7vrvgow6oyt53` under namespace `gov.tx.tcole`

#### Scenario: seeded map round-trips through the loader

- **WHEN** the seed step runs and `loadSourceNameToCanonicalIds("gov.tx.tcole")`
  is then called
- **THEN** the returned agencies/personnel/agencyPersonnel maps contain every
  seeded key mapped to its original canonical ID

### Requirement: Reconstruction reuses seeded IDs and mints only for new entities

When `intake run` imports the TCOLE artifacts, the pipeline SHALL reuse a
pre-seeded canonical ID for any entity whose source key is already in the ledger
and SHALL mint a fresh `cuid2` only for entities with no seeded mapping. Existing
canonical IDs MUST NOT change.

#### Scenario: a previously-seeded officer keeps its ID

- **WHEN** a Personnel record keyed `1000033` is imported and `1000033` is already
  seeded to `cm7a0bgot04alewvgibyq384j`
- **THEN** the officer row is written with ID `cm7a0bgot04alewvgibyq384j` (no new ID minted)

#### Scenario: a brand-new officer gets a fresh ID

- **WHEN** a Personnel record keyed by a `PUBLIC_GUID` absent from all seed maps
  is imported
- **THEN** a new `cuid2` is minted and persisted for it, leaving all seeded IDs unchanged
