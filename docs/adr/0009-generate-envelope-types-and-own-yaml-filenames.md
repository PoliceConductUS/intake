# ADR 0009: Generate Envelope Types and Own YAML Filenames

## Status

Accepted

## Context

Intake source modules need to know which YAML envelope kinds and record shapes
are valid without copying database details into every module. The shape of
record envelopes should follow the database schema where possible so a schema
change produces a contract change that source modules can consume.

Intake also needs deterministic file names for YAML resources. Letting callers
choose arbitrary file names makes generated output harder to inspect, compare,
and reference.

## Decision

Every envelope kind that intake reads or writes must have one kind-specific IO
implementation. That implementation lives at the smallest scope that owns the
envelope. Source-facing cross-module envelopes live under the `src/shared/io/`
public surface. Root-intake command and state envelopes live under the root
command or state package that owns them. The implementation owns construction,
read, write, and validation for the complete envelope shape. Command code,
tests, and source modules must not parse YAML and then hand-check envelope
fields as a replacement for the kind-specific implementation.

Some kind-specific implementations are generated from the database schema where
the schema defines durable import record shapes. Generated modules currently
live under `src/shared/io/generated/` and are not hand-edited. Generated
source-facing modules expose plural collection envelopes, singular entity
envelopes, and singular entity specs such as `AgencySpec`.
Command-owned mutation envelopes must reuse those generated spec schemas when
they contain database entity specs.

Plural collection envelopes must validate every inline
`spec.records.<name>.spec` item against the same singular spec used by the
matching singular envelope. Referenced record envelopes must validate their
`spec` through the matching singular envelope implementation. For example,
`Agencies.spec.records.*.spec` and `Agency.spec` both validate with
`AgencySpec`; `AgencyCreate.spec` also uses `AgencySpec` because create
mutations carry a full entity spec.

Each generated or hand-written envelope type owns:

- its `apiVersion`
- its `kind`
- its metadata schema
- its spec schema
- its reader
- its writer
- its validation through read/write
- its target database table when the envelope represents a database-backed
  record

Source modules must use the supported `src/shared/io/` reader/writer/validator
surface instead of reimplementing YAML parsing or schema rules. Source modules
must not import root-intake command envelopes from `src/cli/`.

Envelope kind names follow these rules:

- Source collection kinds are plural database/domain record names, such as
  `Agencies`, `Personnel`, and `LocationPaths`.
- Source single-record envelope kinds are singular record names when needed,
  such as `Agency` or `LocationPath`.
- Import mutation envelope kinds sort by entity first and action second, such
  as `AgencyCreate`, `AgencyUpdate`, and `LocationPathCreate`. Create mutation
  specs reuse the singular generated entity spec. Update mutation specs are
  ordered operations, and every operation carries source command audit identity.
- Intake-owned ledger or state kinds use domain nouns, such as
  `DatabaseMutations`, `ArtifactMutations`, `ArtifactMutation`, and
  `SourceNameToCanonicalId`.

Writers own YAML file names. Callers may choose the output directory, but not
the file name. The default file name is:

```text
<encodeURIComponent(metadata.name)>.<kind>.yaml
```

The `kind` segment is the exact `kind` value. Do not kebab-case, lower-case, or
otherwise transform it.

Any kind-specific directory must also use the exact kind value. Do not use
pluralized, kebab-case, lower-case, or otherwise transformed directory names
where the directory means a resource or record kind.

Command directories that contain generated command output include creation time
and the command resource name:

```text
<created-at-sortable-utc>-<encodeURIComponent(metadata.name)>/
```

A large collection is bounded by splitting it into multiple **chunk files of the
same kind** — each a full inline collection envelope, all listed together in the
parent `Artifacts.spec.artifacts` and merged on read. This is the primary
size-bounding mechanism; records are inline, **not** one file per record.
Externalizing an individual item with a relative `ref` value is reserved for an
item that is itself very large (e.g. a geometry), not routine per-record
splitting. Refs must stay within the parent directory tree and must
point to another Kubernetes-style envelope with matching identity rules.
`ref` is an explicitly modeled field, not a general underscore-prefixed escape
hatch. Envelope schemas must reject unknown keys. Do not allow arbitrary
underscore-prefixed properties at the root or inside `metadata` or `spec`.

Relative paths inside YAML envelopes are resolved from the directory containing
the YAML file that declares the path. This applies to:

- `Artifacts.spec.artifacts[*].ref.path`
- source typed artifact record `ref` values
- `DatabaseMutations.spec.mutations[*].ref.path`
- any future envelope-local file reference

Envelope-local relative paths must not be resolved from the process current
working directory. Absolute paths are allowed only for command inputs or command
outputs that explicitly cross an envelope boundary, such as a CLI argument,
`Command.spec.path`, or `Command.spec.state.path`. `ref` values must be
relative, must not contain parent-directory traversal, and must resolve under
the allowed parent directory for the referencing envelope.

## Consequences

- YAML behavior is centralized in kind-specific envelope modules.
- Source modules learn about database-driven shape changes through generated
  schemas instead of duplicated hand-written validators.
- File names are stable, predictable, and derived from resource identity.
- The same reader/writer code can be used by tests, intake commands, and source
  modules.
- YAML shapes outside the current envelope contract are rejected.

## Alternatives Considered

- Let each source module define its own YAML validators: rejected because schema
  drift would be silent and hard to diagnose.
- Let callers choose file names: rejected because it breaks the resource identity
  convention and makes refs less predictable.
- Keep generated files checked in: acceptable if generated output becomes part
  of the reviewed public contract, but the current implementation treats the
  generator as the source of truth.

## Revisit Trigger

Revisit when generated envelope modules are distributed outside this repository
or when multiple API versions must be supported at the same time.
