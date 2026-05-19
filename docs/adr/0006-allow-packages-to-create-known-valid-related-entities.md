# ADR 0006: Allow Packages to Create Known-Valid Related Entities

## Status

Proposed

## Context

Some intake packages will provide related links, media references, or evidence
about agencies and officers that do not already exist in the database.

Audit the Audit is a desirable source of related links and references for police
conduct incidents, officers, and agencies. It is also a useful experimental
source for packages where the package may need to add related entities before it
can attach links or evidence.

## Decision

Allow a filed package to create related agencies, officers, or other supported
entities when the package contains enough evidence to establish that the entity
is valid.

This is not fuzzy matching by default. Entity creation must be explicit in the
package and backed by provenance.

Requirements:

- New entity IDs must be stable cuid2 text IDs assigned upstream in the package.
- The package must include source references/provenance for the entity.
- Intake must validate required fields before creating the entity.
- Intake must reject ambiguous or unsupported entity creation.
- Related links must reference explicit package-supplied entity IDs. The
  database must never generate IDs for durable records.

## Consequences

- Packages can file useful related evidence even when the database lacks a prior
  agency/officer record.
- Intake remains deterministic because IDs are assigned upstream and validated
  before load.
- Package validation must understand which entity kinds can be created by a
  package.
- Evidence/provenance requirements for entity creation must be stronger than for
  attaching a link to an already-known entity.

## Alternatives Considered

- Require all agencies/officers to preexist before filing related links:
  rejected because it blocks valid evidence packages and makes source ingestion
  depend on manual preloading.
- Auto-create entities from names alone: rejected because it risks polluting the
  database with ambiguous or unsupported records.

## Revisit Trigger

Revisit when the first related-link package is implemented and the minimum
evidence requirements can be tested against real data.
