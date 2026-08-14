# ADR 0006: Allow Artifacts to Create Known-Valid Related Entities

## Status

Proposed

> Clarified by [ADR 0015](0015-isolate-namespaces-and-own-cross-source-identity-at-root.md):
> a source refers to a shared `location_path` by a namespace-local value (e.g. a
> state) that the intake root resolves against an existing location row; the
> source never emits a canonical id or names another namespace.

## Context

Some source artifacts will provide related links, media references, or evidence
about agencies and officers that do not already exist in the database.

Audit the Audit is a desirable source of related links and references for police
conduct incidents, officers, and agencies. It is also a useful experimental
source for artifacts where the source may need to add related entities before it
can attach links or evidence.

## Decision

Allow imported `Artifacts` to create related agencies, officers, or other
supported entities when the artifacts contain enough evidence to establish that
the entity is valid.

This is not fuzzy matching by default. Entity creation must be explicit in the
source artifacts and backed by provenance.

Requirements:

- New entity source names must be stable within `metadata.namespace` and source
  record kind.
- Intake resolves `metadata.namespace` plus source record kind plus source name
  to an existing canonical ID or assigns a new canonical cuid2 ID before
  database writes.
- Source artifacts must include source references/provenance for the entity.
- Intake must validate required fields before creating the entity.
- Intake must reject ambiguous or unsupported entity creation.
- Related links in source-produced artifacts must reference explicit source
  names. Canonical IDs may appear only after intake resolution in intake-owned
  replay or state envelopes. The database must never generate IDs for durable
  records.
- `LocationPaths` artifacts may create, read, or update location paths because
  they define location path records. Other entity artifacts that link to
  `location_path_id` must resolve that link to an existing `location_path` row
  or `location_path_alias` row. If neither exists, import fails. Intake must not
  create location paths as a side effect of importing another entity kind.

## Consequences

- Artifacts can import useful related evidence even when the database lacks a
  prior agency/officer record.
- Intake remains deterministic because source-name mappings and canonical ID
  assignments are persisted by intake and replayed during reset.
- Artifact validation must understand which record kinds can be created by a
  source artifact.
- Evidence/provenance requirements for entity creation must be stronger than for
  attaching a link to an already-known entity.

## Alternatives Considered

- Require all agencies/officers to preexist before importing related links:
  rejected because it blocks valid evidence artifacts and makes source ingestion
  depend on manual preloading.
- Auto-create entities from names alone: rejected because it risks polluting the
  database with ambiguous or unsupported records.

## Revisit Trigger

Revisit when the first related-link artifact is implemented and the minimum
evidence requirements can be tested against real data.
