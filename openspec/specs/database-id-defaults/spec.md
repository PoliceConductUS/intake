# database-id-defaults Specification

## Purpose

TBD - created by archiving change drop-database-generated-id-defaults. Update Purpose after archive.

## Requirements

### Requirement: The schema defines no value-generating column default

The migrated `public` schema SHALL NOT define a default that generates a value
(`generate_cuid`, `gen_random_uuid`, `uuid_generate`, or a sequence `nextval`)
on any column, and SHALL NOT define an identity column. The writer MUST supply
the ID of every durable record.

#### Scenario: Migrated schema is inspected

- **WHEN** every migration has been applied to an empty database
- **THEN** no column in the `public` schema has a value-generating default
- **AND** no column in the `public` schema is an identity column

#### Scenario: A row is inserted without an ID

- **WHEN** a row is inserted into `agency`, `agency_personnel`, `agency_phone_numbers`, `personnel`, `review_links`, `review_personnel`, or `reviews` without an `id`
- **THEN** the insert fails with a `not null` violation
- **AND** no row is written
