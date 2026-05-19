# ADR 0005: Use Source-Specific Package Producers

## Status

Proposed

## Context

Intake should validate, archive, and file standardized packages. Upstream data
sources can vary widely in structure, access method, and extraction needs.

Tempe's Police Transparency arrest dataset is a good first source to explore:

- <https://data.tempe.gov/maps/tempegov::police-transparency-arrests-all-data-related-tables-normalized/about>

The source-specific logic needed to fetch, normalize, and package Tempe data
should not be hidden inside the core intake filing command.

## Decision

Use source-specific upstream package producers. A producer is a CLI/tool that
creates an `apiVersion: policeconduct.org/v1alpha1`, `kind: IntakePackage`
manifest plus referenced artifacts.

The first candidate producer is a Tempe Police Transparency arrest-data producer.

Producer responsibilities:

- Fetch or read source data.
- Preserve original source artifacts unchanged.
- Produce transformed artifacts needed by intake.
- Assign stable package IDs.
- Pass through source-provided stable record IDs when present.
- Derive stable source-local record keys when source-provided IDs are absent.
- Produce a manifest with artifact references, checksums, provenance, and
  package metadata.
- Be able to regenerate the package from source inputs.

Intake responsibilities remain:

- Validate the package.
- Resolve source namespace plus source record key to canonical IDs.
- Assign new canonical cuid2 IDs when a source-key mapping does not already
  exist and the package is allowed to create that record kind.
- File the package into the intake-owned archive.
- Reject package identity conflicts.
- Load deterministic derived state.

## Consequences

- Source-specific extraction can evolve independently from core intake filing.
- Intake keeps a stable package boundary.
- The same package contract can support many upstream sources.
- Producers must provide stable source identity, provenance, and checksum
  invariants.
- Intake can provide feedback artifacts, such as current source-key to
  canonical-ID mappings, to make later producer runs easier without making those
  producer caches the source of truth.

## Alternatives Considered

- Build all source-specific fetching into `intake file`: rejected because it
  couples source extraction to the core archive/load boundary.
- Manually create packages without a producer tool: acceptable for fixtures, but
  not for repeatable source ingestion.

## Revisit Trigger

Revisit when there are enough producers to justify a shared producer SDK or
template.
