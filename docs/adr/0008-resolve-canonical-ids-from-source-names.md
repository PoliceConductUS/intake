# ADR 0008: Resolve Canonical IDs from Source Names

## Status

Accepted

> Clarified by [ADR 0015](0015-isolate-namespaces-and-own-cross-source-identity-at-root.md):
> namespaces are isolated and mutually ignorant, so a source only ever resolves
> its own namespace's source names, and cross-source identity is unified at the
> root — not expressed by any source.
>
> Revised by [ADR 0016](0016-resolve-entity-properties-with-composable-resolvers.md):
> canonical-id assignment becomes the "id" property's resolver, and the
> intentionally-narrow `SourceNameToCanonicalId` ledger is collapsed into the one
> durable resolver cache.

## Context

Many upstream sources include stable record identifiers. When they do, intake
should preserve and use those identifiers as source-local names instead of
replacing them with producer-generated IDs.

Other sources do not include stable IDs. For those records, the upstream
producer must derive a stable source-local name from source data that uniquely
identifies the record within that source namespace and record kind.

The database must still never generate IDs for durable records. However, that
does not mean every canonical entity ID must be assigned by the upstream
producer. Intake can assign canonical cuid2 IDs as long as those assignments are
deterministic across import and reset through a durable source-name mapping.

## Decision

Separate source identity from canonical identity.

Source-produced artifacts must provide source identity for each durable record:

- `metadata.namespace` on the root `Artifacts` envelope and typed artifact
  envelope
- the typed artifact `kind`
- the `spec.records` key
- provenance showing how the source name was obtained or derived when needed

Intake resolves canonical IDs from the tuple:

```text
metadata.namespace + source record kind + spec.records key
```

The durable mapping is stored as a Kubernetes-style
`SourceNameToCanonicalId` envelope:

```yaml
apiVersion: policeconduct.org/intake/v1alpha1
kind: SourceNameToCanonicalId
metadata:
  name: agency-source-name
  namespace: mn-post
spec:
  kind: Agency
  canonicalId: c...
```

`SourceNameToCanonicalId` is intentionally narrow. It stores only the source
identity target kind and canonical ID. Type-specific cached values such as
slugs, location-path links, coordinates, or derived display fields are not part
of this ledger.

Resolution rules:

- If the source-name mapping already exists for the namespace, kind, and source
  name, intake reuses the mapped canonical ID.
- If the source-name mapping does not exist and the artifacts can create that
  kind of record, intake assigns a new cuid2 canonical ID and records the
  mapping.
- Intake-assigned canonical IDs must be stable for the command execution,
  persisted in the intake-owned mapping ledger, and replayable during reset.
- The database must not generate canonical IDs. ID assignment happens in intake
  before database writes.
- Source-produced artifacts must not contain canonical IDs.
- Table-shaped source fields such as `id`, `agency_id`, `location_path_id`, or
  `parent_location_path_id` are allowed only as source-name values until intake
  transforms them.
- Natural-key matching can be used as evidence for candidate duplicate
  detection, but not as a replacement for durable source-name mappings.

The mapping ledger is part of the intake-owned archive/rebuild contract and is
stored under the intake module workspace, not in the producer workspace. Command
folders and logs record when mappings are read, assigned, and used; see ADR 0013
for command auditability.

## Upstream Feedback

Intake should be able to produce feedback artifacts that upstream producers can
consume on later runs, such as:

- source-name to canonical-ID mappings
- canonical slugs
- duplicate or merge decisions
- rejected records with reasons
- source names that need stronger derivation or manual review

This feedback is an optimization for producer quality and repeatability. It must
not become the only source of truth. Intake remains able to rebuild from the
archive and mapping ledger without relying on a producer's local cache.

## Consequences

- Upstream producers can pass through source IDs when present.
- Producers without source IDs can still be deterministic by deriving stable
  source-local names.
- Intake owns canonical ID assignment for newly accepted records.
- Rebuilds remain deterministic because source-name mappings are durable intake
  artifacts.
- Duplicate detection can use source-name mappings, aliases, slugs, and natural
  keys as evidence without letting the database invent identity.

## Alternatives Considered

- Require upstream producers to assign all canonical cuid2 IDs: rejected because
  it pushes global identity decisions into source-specific tools.
- Let the database generate IDs: rejected because it breaks deterministic reset
  and makes import order part of identity.
- Use natural keys directly as canonical identity: rejected because names,
  dates, and URLs can change, collide, or be corrected.

## Revisit Trigger

Revisit when entity merge/split workflows require explicit mapping versioning.
