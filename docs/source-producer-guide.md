# Source Producer Guide

Source modules under `sources/<source-id>/` preserve upstream evidence and
transform it into typed intake artifacts. Root intake owns canonical identity,
resolved properties, database mutation generation, and replay.

This guide describes the current source-module workflow. The interfaces in
[`source-transform.ts`](../src/cli/transform/source-transform.ts) and the
canonical IO exported from [`src/shared/io/`](../src/shared/io/index.ts) define
the executable contract.

## Command Workflow

Run each phase through root intake:

```bash
intake data acquire <source-id>
intake data transform <source-id>
intake data generate <source-id>
intake data up
intake data status
intake data verify
```

`acquire` obtains the raw inputs. `transform` reads the saved inputs and produces
an `Artifacts` envelope. `generate` compares the artifacts with the database at
chain head and appends a `DatabaseMutations` entry. `up` applies pending entries
in order. `verify` checks applied-entry checksums.

`intake data update` runs transform, generate, and up for sources in dependency
order using their saved inputs. It does not acquire new inputs or apply schema
migrations. Rebuilding data uses the saved mutation chain after the database
schema has been migrated.

The old `run` and `import artifacts` command surfaces are retired. See
[ADR 0035](adr/0035-one-data-command-group-replaces-run-and-import.md).

## Source Module Interfaces

An optional `acquire.ts` exports `acquire`, implementing `SourceAcquire`. Intake
passes `sourceDir`, `state`, `env`, a read-only `data` context, and an optional
logger. Preserve downloaded or scraped raw inputs under the supplied
`sourceDir`. Reusable source-owned download state belongs under the supplied
`state` path.

`transform.ts` exports `transform`, implementing `SourceTransform`, and declares
the artifact kinds it `produces`. Intake passes the saved input `paths`, shared
readers such as `readXlsx`, source-owned `state`, an `emit` adapter, and the
available environment, data context, and logger.

The transform returns a `SourceManifest`: an `artifacts` array of entries with
`kind` and `records`. Each record is keyed by its stable source-local name and
has a `spec`. For streamed output, use the supplied `emit(kind, key, spec)`
adapter. Root intake assembles, validates, and writes the resulting envelopes.

Root intake creates the command directory and `Command` envelope. Source modules
receive typed dependencies; they do not need to construct or parse a `Command`
envelope themselves. Use the paths passed to the module rather than reconstructing
workspace paths from the working directory or finding another run's output.

## Workspace And Source Evidence

Source modules own their supplied output and source-state paths. Root intake
owns command creation, source-name mappings, canonical ID assignment,
`ResolvedProperty` caches, database writes, and the replay chain. Data-chain
entries live in `$INTAKE_WORKSPACE/data/mutations`, coupled to that workspace's
identity ledger and cache; they are not source code committed to this repository.

Preserve the original source bytes and enough provenance to identify the exact
input used: source URL or local reference, relevant request parameters,
retrieval information, file reference, and digest. Retain rejected or incomplete
source records in the saved evidence. Do not rewrite raw inputs to conceal a
correction or replace the source with its transformed representation.

Source acquisition owns network downloads. Transforms use saved inputs and
explicit injected capabilities. Sources that need existing agencies, personnel,
or cases use the supplied data context rather than direct database access.

## Stable Identity And References

Prefer source-provided stable record IDs. Otherwise derive a deterministic
source-local name from fields that identify the record, and document and test
that derivation.

Root intake maps source namespace, record kind, and source-local name to durable
canonical IDs. Sources must not mint canonical cuid2 IDs or maintain their own
canonical mapping ledgers. Reference fields such as `agency_id`, `personnel_id`,
and `agency_personnel_id` use source-local identities resolved by intake. The
injected resolver returns a reference appropriate to the source namespace.

Kinds with an explicitly defined natural identity follow that contract. For
example, civil cases use their normalized court-and-docket identity under
[ADR 0028](adr/0028-natural-key-identity-for-cross-source-entities.md), allowing different
sources to refer to the same case.

## Shared IO And Record Schemas

Every intake YAML envelope read, write, and constructor uses that kind's
canonical IO from `src/shared/io/`. Do not import generated envelope internals
in source modules or hand-roll YAML parsing, schema validation, filenames, or
resource paths.

Envelopes use `apiVersion: policeconduct.org/intake/v1alpha1`, an exact `kind`,
required `metadata.namespace` and `metadata.name`, and that kind's declared
`spec`. Canonical IO rejects wrong versions and kinds, malformed records, and
unknown fields outside declared free-form payloads. It also owns filenames;
writers receive a containing directory.

Use the current entity and relationship schemas. Do not introduce a separate
nested source-specific schema for a kind that intake already defines.

## Civil Cases Require A Resolved Officer

The redesign's Clearinghouse and CourtListener transforms retain a case only
when at least one named officer resolves through
`data.resolvePersonnel({ agencyId, personnelName })`. They emit `CivilCases`,
`CivilCasePersonnel`, and `CivilCaseLinks` using the shared schemas. Cases with
no resolved officer are skipped by those transforms; their acquired source
records remain available for inspection.

An unidentified-officer placeholder does not satisfy this requirement. The
abandoned draft's nested `involvement`, `unknownOfficer`, and mandatory
`evidence` array with attachment hashes are not the redesign CivilCase contract.
Preserving source evidence and artifact digests remains required; it is distinct
from a mandatory attachment field on every civil-case record.

## Missing Properties And Resolution

Omit a source property that is unavailable when the artifact schema permits
omission. Use `null` only when the schema permits it and clearing the value is
intended. Intake's field resolvers supply required derived values before mutation
validation; an unresolved required mutation field fails preparation.

Canonical entity properties resolved during preparation use intake's
`ResolvedProperty` cache and source evidence. Source-owned caches are for
source-owned state, not a second canonical identity or property store. Make
manual corrections explicit through the supported manual source or resolver
contract.

## Validation And Related Contracts

Test the source transform with saved fixtures, stable identity assertions, and
the relevant resolver outcomes. Validate emitted records through shared IO and
exercise acquisition separately when its behavior changes. For OpenSpec changes,
run `npm run openspec:validate`.

- [Repository rules](../AGENTS.md)
- [Canonical identity mappings](adr/0008-resolve-canonical-ids-from-source-names.md)
- [Canonical envelope IO](adr/0009-generate-envelope-types-and-own-yaml-filenames.md)
- [Namespace and identity ownership](adr/0015-isolate-namespaces-and-own-cross-source-identity-at-root.md)
- [Replayable data chain](adr/0033-data-mutations-as-a-replayable-chain.md)
- [Workspace-coupled chain](adr/0034-manual-updates-by-selector-and-workspace-coupled-chain.md)
- [Current data commands](adr/0035-one-data-command-group-replaces-run-and-import.md)
