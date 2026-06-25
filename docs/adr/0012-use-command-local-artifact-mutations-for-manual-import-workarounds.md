# ADR 0012: Use Command-Local Artifact Mutations For Manual Import Workarounds

## Status

Proposed

## Context

Source-produced `Artifacts` can fail during import because an upstream source
record needs a manual correction before intake can transform or prepare database
mutations. The preferred fix is to update the source module or source data so
the next generated `Artifacts` file is correct.

Some failures need a short-term operator workaround before the producer can be
fixed. That workaround must be auditable, command-local, and captured in the
resulting `DatabaseMutations` ledger so it does not become hidden cross-command
state.

## Decision

Manual artifact corrections use root-intake-owned command-local YAML envelopes
only. They are stored in the intake command folder for the
`intake import artifacts` command that applies them. They are not stored under
`$INTAKE_WORKSPACE/intake/state/` by default, and they do not live in
producer-owned source folders.

The command-level correction file is:

```text
$INTAKE_WORKSPACE/intake/commands/<created-at>-<import-command-name>/<import-command-name>.ArtifactMutations.yaml
```

It uses:

```yaml
apiVersion: policeconduct.org/intake/v1alpha1
kind: ArtifactMutations
metadata:
  name: <import-command-name>
  namespace: manual
spec:
  mutations:
    - target:
        namespace: <source-namespace>
        command:
          name: <source-artifacts-name>
        kind: <ExactSingularRecordKind>
        name: <source-record-name>
      operations:
        - action: set
          path: <record-property-path>
          value: <corrected-value>
          reason: <manual-reason>
```

`ArtifactMutations.spec.mutations` is an ordered list. Each item is either an
inline single-target mutation or a relative `ref` to a single-target
`ArtifactMutation` envelope:

```yaml
spec:
  mutations:
    - ref: ArtifactMutation/<encoded-mutation-name>.ArtifactMutation.yaml
```

A referenced single-target file uses:

```yaml
apiVersion: policeconduct.org/intake/v1alpha1
kind: ArtifactMutation
metadata:
  name: <source-namespace>:<source-artifacts-name>:<kind>:<record-name>
  namespace: manual
spec:
  target:
    namespace: <source-namespace>
    command:
      name: <source-artifacts-name>
    kind: <ExactSingularRecordKind>
    name: <source-record-name>
  operations:
    - action: set
      path: <record-property-path>
      value: <corrected-value>
      reason: <manual-reason>
```

`ArtifactMutation` means one target and N ordered operations. `ArtifactMutations`
means N target mutations and may include any number of targets.

When intake imports source `Artifacts`, it looks for
`<import-command-name>.ArtifactMutations.yaml` in the current root intake import
command folder. If present, intake validates it, resolves any `ref` items
relative to the `ArtifactMutations` file, verifies each target points at the
source `Artifacts` identity being imported, applies mutations in order before
transformation, and records the mutation file path and digest in the generated
`DatabaseMutations` metadata.

Manual artifact mutations are a workaround only. They must not become a standard
source-production practice. Durable corrections belong in the source module,
source configuration, or source data.

## Consequences

- Manual corrections are discoverable beside the intake command artifacts that
  apply them.
- `DatabaseMutations` captures the resulting database mutations, so correction
  envelopes do not need to become cross-command state.
- Operators can keep large correction sets readable by externalizing individual
  target mutations with `ref`.
- Re-running the source module without the manual workaround will reproduce the
  original source output, which keeps the workaround visible instead of silently
  changing producer behavior.

## Alternatives Considered

- Store manual `ArtifactMutations` or `ArtifactMutation` envelopes under
  `$INTAKE_WORKSPACE/intake/state/namespaces/manual/`: rejected for command-local
  import corrections because they are not reusable cross-command state after the
  generated `DatabaseMutations` ledger captures the final mutations.
- Put all corrections directly in `DatabaseMutations`: rejected because
  corrections must apply before source artifact transformation and before
  database mutation preparation.
- Make manual corrections standard source output: rejected because source
  modules should produce correct artifacts directly whenever possible.

## Revisit Trigger

Revisit if manual correction workflows become frequent enough to justify a
first-class review, approval, or promotion process for moving a workaround back
into a source module.
