# ADR 0001: Define Intake Package Contract

## Status

Proposed

## Context

The Institute for Police Conduct, Inc. can have tens of thousands of upstream
data sources. Each source may need source-specific extraction, but this repo
needs a stable boundary for validating, archiving, and loading the resulting
data.

The package format must evolve over time without breaking older packages. It
must also preserve original source artifacts, transformed artifacts, provenance,
checksums, and stable source identity.

## Decision

Use a Kubernetes-style manifest contract:

```yaml
apiVersion: policeconduct.org/v1alpha1
kind: IntakePackage
metadata:
  id: c...
  name: example-source-2026-05-19
  producedAt: 2026-05-19T12:00:00Z
  producer: example-importer
spec:
  source:
    namespace: example-source
  artifacts:
    raw: []
    transformed: []
    entities: []
```

The initial API group is `policeconduct.org/v1alpha1`, and the initial kind is
`IntakePackage`.

The manifest may reference local files, S3 objects, or URLs. It must not contain
intake archive locations.

Records in package artifacts must include source identity. When the upstream
source has a stable record ID, the producer should pass it through. When the
source has no stable ID, the producer must derive a stable source-local key from
the source data and include provenance for that derivation. Intake maps source
namespace plus source key to canonical IDs as described in
`docs/adr/0008-resolve-canonical-ids-from-source-keys.md`.

## Consequences

- Upstream systems can produce a mostly standard, extensible package.
- Intake can validate packages without source-specific assumptions.
- Future manifest versions can add fields while preserving old behavior.
- Package validation must be schema-aware and version-aware.

## Alternatives Considered

- `policeconduct.intake/v1alpha1`: rejected because it makes the API group feel
  implementation-scoped rather than organization-scoped.
- Ad hoc per-source file conventions: rejected because they would make package
  validation and evolution harder.

## Revisit Trigger

Revisit when there are multiple independent Institute for Police Conduct, Inc.
API groups that need separate compatibility/versioning policies.
