# ADR 0005: Use Source-Specific Artifact Producers

## Status

Accepted

## Context

Intake should validate, archive, and import standardized artifacts. Upstream
data sources can vary widely in structure, access method, and extraction needs.

Source-specific logic needed to fetch, normalize, and emit source data should
not be hidden inside the core intake import command.

## Decision

Use source-specific upstream artifact producers. A producer is a CLI/tool that
creates `apiVersion: policeconduct.org/intake/v1alpha1`, `kind: Artifacts` plus
referenced or embedded typed artifact envelopes.

Producer responsibilities:

- Fetch or read source data.
- Preserve original source artifacts unchanged.
- Produce transformed typed artifact envelopes needed by intake.
- Use the command name assigned by root intake when artifacts are produced as
  part of an intake command execution.
- Set `metadata.namespace` to the producer namespace on the root `Artifacts`
  envelope and every child typed artifact envelope.
- Use `spec.records` keys as stable source-local record keys.
- Pass through source-provided stable record IDs when present.
- Derive stable source-local record keys when source-provided IDs are absent.
- Include checksums and provenance for upstream files under explicit
  audit/provenance fields.
- Be able to regenerate the artifacts from source inputs.

Intake responsibilities remain:

- Validate the `Artifacts` envelope and child typed artifact envelopes.
- Require root and child artifact `metadata.namespace` values to match.
- Resolve `metadata.namespace` plus source record kind plus source record key to
  canonical IDs.
- Assign new canonical cuid2 IDs when a source-name mapping does not already
  exist and the artifacts can create that record kind.
- Persist source-name mappings in the intake workspace.
- Write `DatabaseMutations` replay envelopes with canonical IDs after
  transformation.
- Reject identity conflicts.
- Load deterministic derived state.

## Consequences

- Source-specific extraction can evolve independently from core intake import.
- Intake keeps a stable artifact boundary.
- The same envelope contract can support many upstream sources.
- Producers must provide stable source identity, provenance, and checksum
  invariants.
- Intake can provide feedback artifacts, such as current source-name to
  canonical-ID mappings, to make later producer runs easier without making those
  producer caches the source of truth.

## Alternatives Considered

- Build all source-specific fetching into `intake import artifacts`: rejected
  because it couples source extraction to the core load boundary.
- Manually create artifacts without a producer tool: acceptable for fixtures,
  but not for repeatable source ingestion.

## Revisit Trigger

Revisit when there are enough producers to justify a shared producer SDK or
template.
