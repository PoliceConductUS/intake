# ADR 0001: Define Intake Envelope Contract

## Status

Proposed

## Context

The Institute for Police Conduct, Inc. can have tens of thousands of upstream
data sources. Each source may need source-specific extraction, but this repo
needs a stable boundary for validating, replaying, and loading the resulting
data.

Intake uses Kubernetes-style YAML envelopes for source-produced artifacts,
intake-owned state, replay ledgers, commands, mappings, caches, and canonical
records.

## Decision

All intake YAML resources use the same envelope shape:

```yaml
apiVersion: policeconduct.org/intake/v1alpha1
kind: Artifacts
metadata:
  name: c...
  namespace: example-source
  labels: {}
  annotations: {}
spec: {}
```

The only supported API version is `policeconduct.org/intake/v1alpha1`.

Envelope identity is:

```text
apiVersion + kind + metadata.namespace + metadata.name
```

`metadata.name` and `metadata.namespace` are required. `metadata.labels` and
`metadata.annotations` may be used for non-identity metadata. Do not support
`metadata.generateName`.

This identity shape is also used when another envelope or state record needs to
refer to a source object. For inline `spec.records` items that do not have their
own envelope metadata, the effective source object identity is derived from the
fixed apiVersion, the singular record kind, the parent envelope namespace, and
the `spec.records` key.

`metadata.namespace` is the producer or consumer namespace for the resource:

- Source-produced `Artifacts` and typed artifact envelopes use the source
  producer namespace, such as `mn-post` or `us-census-gazetteer`.
- Intake-owned replay, mapping, cache, and canonical envelopes use the namespace
  needed to scope the resource they describe.

Namespace and provenance fields carry source-module identity, upstream
source-file provenance, source record identity, and SourceNameToCanonicalId concerns
explicitly.

Source-produced data is split this way:

- `Artifacts`: root source-produced envelope for a source artifact set.
- Typed artifact envelopes such as `Agencies`, `Personnel`, and
  `LocationPaths`: one record collection per kind.
- `spec.records`: object keyed by the source-local stable record name.
- `spec.records.<source-name>`: either an inline source record object or a
  `ref` to a single-record envelope.

For a typed artifact collection, every inline `spec.records.<source-name>.spec`
single-record item and every referenced single-record envelope `spec` must validate against
the same singular kind spec. For example, `Agencies.spec.records.*.spec`,
`Agency.spec`, and `AgencyCreate.spec` all use `AgencySpec` when they represent
a full agency `spec`.

The `spec.records` key is the source record name. Record-level `_metadata`
is not used. Inline record metadata is not allowed by default; if record-level
metadata becomes necessary, it should be expressed in a single-record envelope
instead of expanding inline records.

Source-produced artifacts must not contain canonical database IDs. Source fields
may be table-shaped, such as `id`, `location_path_id`, or
`parent_location_path_id`, but their values are source names until intake resolves
them through the SourceNameToCanonicalId ledger.

Intake-owned database mutation data is split this way:

- `DatabaseMutations`: replayable ordered ledger produced by compiling
  source-produced `Artifacts` into database mutation intent.
- `DatabaseMutationsDebug`: non-replayable debug artifact produced when
  mutation planning fails.
- `spec.mutations`: ordered list of database mutations, fixed at preparation
  time.
- Kind-specific mutation envelopes such as `AgencyCreate` and `AgencyUpdate`
  may be referenced from `spec.mutations` with `ref`.
- `DatabaseMutationResults`: execution report produced by applying a
  `DatabaseMutations` envelope to the database. It records success, failure, and
  database-returned values for each mutation in envelope order.

Manual corrections to source artifacts belong in command-local
`ArtifactMutations` and `ArtifactMutation` envelopes, which are applied before
transformation and before `DatabaseMutations` is written.

## Consequences

- YAML readers and writers can fail fast against one envelope model.
- Source producers do not need to understand canonical persistence IDs.
- Replay does not recalculate database dependency order; it applies the ordered
  `DatabaseMutations.spec.mutations` ledger.

## Revisit Trigger

Revisit if intake needs multiple API groups, cross-namespace references, or
record-level metadata that cannot be cleanly represented with single-record
envelopes.
