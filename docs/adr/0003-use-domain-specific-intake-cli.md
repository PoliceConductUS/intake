# ADR 0003: Use Domain-Specific Intake CLI

## Status

Proposed

## Context

The initial system is a CLI-driven process, not a long-running service. The
commands should match the domain and make the state transition clear.

The first proposed verb was `consume`, but it is generic and does not communicate
that a package is being accepted into an official intake record.

## Decision

Use this initial CLI vocabulary:

```bash
intake validate <manifest-ref>
intake file <manifest-ref>
intake reset
intake audit
```

Command meanings:

- `validate`: check manifest schema, artifact reachability, checksums, stable
  IDs, and provenance without changing archive or database state.
- `file`: accept a valid package into the official intake record, archive
  artifacts under intake-owned storage, write package/file digests, and load
  deterministic derived state. `file` always runs full validation before
  archiving or loading.
- `reset`: rebuild derived state from the accepted archive/package index only.
- `audit`: verify archived manifests and artifacts still match recorded digests.

## Consequences

- The command surface is small and outcome-oriented.
- `file` reflects the legal/records concept of entering something into the
  official record without using arrest/jail language like `book`.
- `reset` is constrained to accepted archive state and does not pull arbitrary
  new manifests.

## Alternatives Considered

- `consume`: rejected as too generic.
- `book`: rejected because it implies arrest/jail booking.
- `docket`: rejected as too court-specific.
- `register`: acceptable but less domain-specific than `file`.

## Revisit Trigger

Revisit if the CLI becomes a service API and command names need to map to API
operation names.
