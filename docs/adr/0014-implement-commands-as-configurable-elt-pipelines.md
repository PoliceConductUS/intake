# ADR 0014: Implement Commands as Configurable ELT Pipelines

## Status

Proposed

## Context

Intake commands move evidence-like data through repeatable transformations.
That work must be easy to inspect, change, test, and replay. Hidden
orchestration methods, broad reader/writer functions, and modules that know too
much about neighboring objects make command behavior fragile.

The default architecture for every intake command is a configurable ELT
pipeline unless a later ADR states a specific exception.

For this project, ELT means:

- extract: read and validate the command input envelopes or external state
- load: load the command context, mappings, resolver state, schema metadata, and
  other command-scoped state needed to transform records
- transform: run ordered, kind-dispatched pipeline steps that produce the
  command output envelope or database CRU operations

The final write of a command output envelope is a boundary effect after the
pipeline has produced the envelope instance.

## Decision

Every intake command is implemented as a configurable pipeline. A command
handler creates command identity, command folder, and logging, then delegates to
the command pipeline. The pipeline input and output are explicit. The command
handler does not hide business behavior behind broad methods.

Each pipeline is composed from explicit stages. A stage has a name, a typed
input, and a typed output. A stage accepts one input value plus the current
pipeline context or a deliberately narrow adapter, then returns a new value or
typed context update. A stage does not know which stage ran before it or which
stage will run next.

Stages should be pure where possible. A pure stage reads only its typed input
and direct context value, returns only its typed output, and performs no external
read or write. Use pure-ish stages when mutation of a deliberately scoped command
context is the smallest clear option; the mutation must be part of the stage's
typed contract.

Every side effect is a narrow adapter. A side-effect adapter exposes exactly one
capability or closely related capability set, such as exact-kind envelope IO,
database CRU, intake state reads or writes, command logging, or a geocoding
call. Stages receive those adapters directly. Stages must not discover side
effects by reaching through broad context objects, singleton modules, or
neighboring objects.

Resolvers are adapters. Resolver adapters used by intake pipelines must be pure
and cacheable. For database entity properties, a durable resolver cache is about
the canonical entity property, not the source object that happened to reveal the
value. The cache identity is canonical entity identity plus target property name.
`spec.sources` is a map keyed by source namespace. Each source entry stores the
source kind, source name, and typed source-input fingerprint as provenance and
invalidation evidence inside the cache envelope.

Any value that is resolved, derived, generated, or manually accepted to satisfy
a database row field is a resolved property unless it came directly from the
source artifact record. Resolved properties include slugs, address coordinates,
location-path IDs, postal-area choices, canonical locality decisions, and other
prepared values. A resolved property must be read from and written to the
intake-owned `ResolvedProperty` cache through the pipeline's resolved-property
adapter. Code must not make a resolved value visible to database mutation
planning unless that same pipeline path also persists the value, or has already
read it from the cache.

This is a construction rule, not a convention. New resolver-backed properties
must expose a single function or stage that performs cache read, resolution, and
cache write together. Callers should not receive a bare value from a resolver
and then remember to cache it later. If a value is not cacheable yet, the
resolver is not ready to be used by an import pipeline.

The `ResolvedProperty` cache subject for database entity fields is canonical
entity identity:

```text
apiVersion + canonical entity kind + canonical entity ID
```

The cache key also includes the target property name:

```text
apiVersion + canonical entity kind + canonical entity ID + target property
```

The source object remains important, but as evidence rather than identity. For
inline `spec.records` items, the source namespace keys the `spec.sources` entry;
that entry stores the singular record kind, source record name, and a stable
fingerprint of the typed source fields used by the resolver. The same canonical
property must resolve to the same cached value regardless of which source module
supplied the evidence. If a different source attempts to persist a different
value for the same canonical property, intake must fail loudly. This rule
applies to every entity type.

If a resolver currently depends on time, remote mutable state, randomness,
operator choice, ambient process state, or any undeclared input, that dependency
must be converted into an explicit typed input before the resolver is used in an
import pipeline. Import preparation must not add non-cacheable resolver adapters.

Pipeline composition is explicit and configurable. A command may use direct
function composition, a typed step array, or kind-dispatch dictionaries. It must
not use ambiguous methods such as `readReferencedArtifacts`, `applyRows`,
`writeRows`, `handle`, `helper`, or `utils` to hide command flow.

`process` dispatches by exact envelope `kind` using a dictionary:

```ts
const processors = {
  Artifacts: processArtifacts,
  Agencies: processAgencies,
  Personnel: processPersonnel,
  LocationPaths: processLocationPaths,
  DatabaseMutations: processDatabaseMutations,
};
```

Dictionary keys must be exact `kind` values. Adding a kind means adding an
explicit dictionary item and tests for that processor.

Side effects are allowed only through named adapters at explicit stage
boundaries:

- reading a YAML envelope through that envelope kind's IO implementation
- writing a command output envelope through that exact kind's IO implementation
- reading and writing intake-owned `SourceNameToCanonicalId` state
- reading and writing intake-owned `ResolvedProperty` cache envelopes
- database create/read/update during replay or explicit command-owned CRU steps
- command logging
- explicit external resolver calls required by the command, such as geocoding
- reading and writing reusable resolver caches for pure resolver outputs

Direct `ResolvedProperty` IO is only allowed inside the command pipeline cache
boundary and small cache adapter modules. Entity resolvers, transforms, facades,
and replay code must receive resolved values through those adapters rather than
calling `readResolvedProperty` or `writeResolvedProperty` themselves.

Side-effecting stages must not be disguised as pure transforms. The function
name and type must make the effect visible.

Each pipeline context contains only direct command state and direct capabilities
for that command. Processors receive only the context shape they need and the
typed input they process. Processors must not reach through the context to
unrelated subsystems. If a processor needs a side effect, pass the narrow adapter
as part of that processor's direct context shape.

This is a Law of Demeter rule: each step talks only to its direct input, direct
context capability, and direct output. No step reaches through an object to call
into another object's dependency.

## `import artifacts` Pipeline

`intake import artifacts <artifacts-ref>` compiles a source-produced
`Artifacts` envelope into an intake-owned `DatabaseMutations` envelope.

The high-level pipeline is:

```text
process("Artifacts", artifacts-ref)
  -> read Artifacts envelope through Artifacts.read
  -> sort typed artifact envelopes by database dependency order
  -> create DataContext
  -> for each sorted artifact envelope:
       process(dataContext, artifact.kind, artifact)
       -> dispatch to kind processor by exact kind
       -> processor asks DataContext for exact typed facades
       -> processor merges source data into facades
  -> DataContext collects facade toMutation() results into DatabaseMutations
  -> assemble DatabaseMutations envelope
  -> write DatabaseMutations envelope through exact kind IO
  -> execute DatabaseMutations when not dry-run
  -> write DatabaseMutationResults
```

The pipeline input is the validated `Artifacts` envelope returned by
`Artifacts.read`. `Artifacts.read` always resolves `Artifacts.spec.artifacts`
items into typed artifact envelopes before returning. If an item references
another file, it has shape `{ ref: { path, kind, sha256? } }`; the read resolves
`ref.path` relative to the `Artifacts` envelope and reads the file through the
exact kind IO implementation. If an item is inline, it has shape
`{ kind, spec }`; the read uses the item data plus parent `Artifacts` metadata
to create the same typed envelope shape, then validates it through the exact
kind schema before returning it.

The planning pipeline output is a validated `DatabaseMutations` envelope
instance. Envelope creation is not a writer concern. The command config
assembles the envelope data. The exact kind writer validates and writes an
already-created `DatabaseMutations` instance. Failed planning output belongs in
an exact failure/debug envelope, not in a partially valid `DatabaseMutations`
ledger.

Downstream processors do not know whether an artifact came from `ref` or inline
data. They receive only a typed envelope.

Artifact processors are responsible only for their own input kind. A processor
may:

- validate kind-specific business invariants that are not already enforced by
  envelope IO
- request typed record facades from `DataContext.fromSource(...)`
- merge source-provided values into the facade
- stop after expressing source intent

A processor must not:

- read arbitrary files
- write YAML
- call replay or database mutation execution
- call database create/read/update
- choose create, read, or update
- build `*Create`, `*Update`, `*Read`, `*Delete`, or `DatabaseMutations`
  envelopes
- resolve canonical database IDs
- compare source values to current database values
- construct update `from` values
- parse command-line arguments
- inspect raw artifacts that belong to another processor
- know the caller's parent object graph

`DataContext` owns facade registration and mutation collection.
`fromSource(apiVersion, namespace, kind, name)` returns a typed facade for the
requested source object. Repeated calls for the same source identity return the
same facade. The facade hides whether the backing database fact will become
read, create, or update. The pipeline only mutates the facade. During
`toMutation()`, setting a field to the value already present in the database
records an expected-state check, not a database mutation; setting a different
value records an update with the expected prior value; setting a field on a new
row contributes to a create mutation. Replay must refuse to apply a mutation
ledger when an expected-state check does not match the current database state.

`canonicalIdFor(apiVersion, namespace, kind, name)` returns the canonical ID for
a source object already resolved from the database, durable state, or a planned
create mutation in the current `DatabaseMutations` envelope. If the source
object has not been processed or reserved yet, `canonicalIdFor(...)` fails
loudly. This lets later processors link to records that do not exist in the
database yet but are already defined earlier in the current mutation set.

When a processor needs the canonical ID for a related object referenced by a
source property, it calls `canonicalIdFromProperty({ source, property })`.
`source` is the typed facade returned by `DataContext.fromSource(...)`, so
`apiVersion`, namespace, kind, and name come from the source object. The
processor does not pass a target kind. `DataContext` owns the source
`kind + property` resolver contract, including the target kind, typed resolver
input, resolver cache key, and target existence check.

Processors build source intent, not database mutation operations. A source
facade may already contain all fields required by the target table, or it may
need resolver-backed values. The command mutation-creation stage asks
`DataContext` to collect all touched facade `toMutation()` results into
`DatabaseMutations`. `toMutation()` resolves canonical IDs, resolver-backed
required fields, foreign-key-like properties, reusable `ResolvedProperty` cache
entries, and current database state through `DataContext`.

If the canonical row does not exist, `toMutation()` emits the exact entity
`*Create` envelope with a complete row `spec`. If the canonical row exists,
`toMutation()` emits the exact entity `*Update` envelope with ordered operations.
`set` operations require `from` and `to`; same-value assignments become `check`
operations with the expected value. If the facade cannot produce a complete
create or a valid update, it emits an invalid database mutation diagnostic
instead of a partial executable mutation.

## `replay database-mutations` Pipeline

`intake replay database-mutations <database-mutations-ref>` consumes only an
intake-owned `DatabaseMutations` envelope.

The high-level pipeline is:

```text
process("DatabaseMutations", database-mutations-ref)
  -> read DatabaseMutations envelope
  -> validate ordered mutations
  -> create replay context
  -> for each mutation in envelope order:
       dispatch by mutation kind
       -> create/read/update database record
       -> record per-mutation outcome
  -> write DatabaseMutationResults
```

Replay does not read source `Artifacts`, SourceNameToCanonicalId records,
artifact mutations, `ResolvedProperty` state, or resolver caches.

## Pipeline Contracts

All pipeline stages use explicit input and output types. A function name must
describe the transformation it performs. Names such as `handle`, `helper`,
`utils`, `applyRows`, `writeRows`, or `readReferencedArtifacts` are not
accepted because they hide the domain operation.

The preferred stage shape is:

```ts
type PipelineStage<Input, Output, Context> = (
  input: Input,
  context: Context,
) => Output | Promise<Output>;
```

The preferred side-effect adapter shape is:

```ts
type Adapter<Input, Output> = (input: Input) => Promise<Output>;
```

Concrete commands may use richer named object types when that makes the domain
contract clearer, but the same rule holds: input type, output type, and adapter
capabilities are explicit.

Each kind processor has this conceptual shape:

```ts
type KindProcessor<Context, Envelope> = (
  context: Context,
  envelope: Envelope,
) => Context;
```

The concrete implementation may use immutable return values or a deliberately
scoped mutable context, but the boundary remains the same: processor input is
context plus typed envelope, and processor output is context.

Every kind-specific envelope is read by its own IO implementation. The pipeline
may select the implementation by dictionary dispatch:

```ts
const artifactReaders = {
  Agencies: Agencies.read,
  Personnel: Personnel.read,
  LocationPaths: LocationPaths.read,
};

const artifactProcessors = {
  Agencies: processAgencies,
  Personnel: processPersonnel,
  LocationPaths: processLocationPaths,
};
```

The dictionary keys must be exact `kind` values.

## Consequences

- Command flow is inspectable as explicit ELT pipelines.
- Pipeline stages can be tested independently because their inputs, outputs, and
  side-effect adapters are explicit.
- Adding a supported artifact kind means adding a kind-specific reader item, a
  kind-specific processor, and tests for that processor.
- Source-produced envelopes, state envelopes, command output envelopes,
  mutation execution results, and replay behavior remain separate contracts.
- `DatabaseMutations` is deterministic output of the `import artifacts`
  planning pipeline and can be executed without source inputs.
- Side effects are named, isolated behind narrow adapters, and testable.
- The database module is not an import orchestrator and does not know about
  `Artifacts` or `DatabaseMutations`.
- Kind-specific IO remains the only place that validates complete envelope
  shape for that kind.

## Alternatives Considered

- Keep command orchestration in ad hoc functions: rejected because call order
  and responsibilities become implicit and hard to change.
- Put envelope assembly inside `DatabaseMutations.write`: rejected because writing
  should validate and persist an envelope, not decide how source artifacts are
  transformed into replay mutations.
- Use a generic pipeline framework immediately: rejected for now because plain
  function composition, typed step arrays, and kind dictionaries are enough.
- Let processors call each other directly: rejected because it hides dependency
  order and violates the pipeline boundary.

## Revisit Trigger

Revisit when pipeline composition needs conditional branching that cannot be
expressed clearly with direct function composition, typed step arrays, and kind
dispatch tables.
