# ADR 0019: Cache and Seed Resolved Properties; Validate at the Mutation Boundary

## Status

Proposed

> Extends [ADR 0016](0016-resolve-entity-properties-with-composable-resolvers.md)
> (composable per-property resolvers), [ADR 0009](0009-generate-envelope-types-and-own-yaml-filenames.md)
> (generated envelope specs), and [ADR 0005](0005-use-source-specific-artifact-producers.md)
> (source-specific artifact producers).

## Context

Some entity properties are not supplied by the source — they are **resolved
during import**: an agency's `slug`, `location_path_id`, `latitude`/`longitude`,
and its street `address`/`city`/`zip_code` (which the source may lack entirely).
ADR 0016 made every such property a composable resolver on the entity's facade.

Two needs were left handled by bespoke, coordinate-only code
(`agency-coordinate-cache` + `agency-field-resolution`):

1. **Reuse + manual supply.** Geocoding is expensive and some values cannot be
   derived at all (a PO-box address the geocoder can't place; an agency whose
   source has no address). We need to cache a resolved value and to **seed** a
   value a resolver cannot produce.
2. **A partial model that is still guaranteed complete before the database.**
   A source record legitimately omits resolver-filled fields, so the artifact is
   a _partial_ model. But a database mutation must be complete and valid. Where
   does "valid" get enforced?

This ADR generalizes both, entity-agnostically, and defines exactly where a
resolver-filled field is optional versus required.

## Decision

**1. A generic `PropertyCache` lives in the resolver layer, not per entity.**
The shared `ResolvingFacade` base (in `resolver-kit.ts`) routes a **derived** set
of properties through a cache keyed by `(entity kind, subject id, property)`,
with a fixed precedence:

The cached set is **not hand-marked per resolver.** It is generated:
`RESOLVED_PROPERTIES[kind]` (emitted by the entity-spec generator, = each
entity's `createRequired`) minus `id` — so every resolved-during-import property
is cache-backed automatically the moment it is added to `createRequired`, and
`id` stays ledger-minted, never cached. **Foreign-key fields are deliberately
excluded**: an FK is resolved every run by finding the target facade and awaiting
its id (a same-source find, ADR 0016 #4/#9), never cached — a cached FK could go
stale if the reference or the target's id changed. FK fields are therefore never
in `createRequired`/`RESOLVED_PROPERTIES`. The precedence for a cached property:

> **source value > cache > live resolution**

- A source-provided value wins and is returned untouched — **never written** to
  the cache (the source is authoritative and re-read each run; persisting it
  would risk a later "already has a different value" write conflict).
- With no source value, a cache **hit** short-circuits the resolver.
- With no source value and a cache **miss**, the resolver runs live and the
  result is **written through** — unless it is `null`/`undefined` (an absent
  result is never cached, so it cannot masquerade as a hit and shadow a later
  seed).

This deletes the bespoke `agency-coordinate-cache`: coordinates are just one
cached property among several.

**2. Seeds are the same cache under version control.** A `ResolvedProperty`
envelope committed under `sources/<id>/resolved-property-seed/` is copied into
the cache at run time (`seedResolvedPropertyCache`, ADR 0018) and read as an
ordinary cache hit. Seeding is how a value a resolver cannot derive is supplied:
a missing address is **seeded**; an address that will not geocode gets its
`latitude`/`longitude` **seeded**. No per-property or per-source code is
involved — the cache is opaque to what it holds.

**3. Resolver-filled fields are optional in the artifact spec and required in
the mutation spec.** Validation is explicit (Zod `.safeParse`), and the model is
allowed to be **temporarily incomplete**:

- In the generated base spec (e.g. `AgencySpec`) a resolver-filled field is
  `.optional()` — an artifact may omit it. This is the "resolved during import"
  bucket, declared by `createRequired` in the entity-spec generator.
- In the generated `*Create` mutation spec (e.g. `AgencyCreateSpec`) the same
  field is **required**. `toMutation` parses against this spec, so completeness
  is enforced at the **one guaranteed boundary: mutation generation**. There is
  no earlier fail point, and read/write do not force completeness — a partial
  artifact is valid to read and hold.

Concretely for Agency: `address`/`city`/`zip_code` are `nonEmptyString.optional()`
in `AgencySpec` and `nonEmptyString` in `AgencyCreateSpec`; a `.cached()` required
resolver fills each from source-or-seed and fails loud at `toMutation` when
neither supplies it. `state` is the exception — always source-provided, so it
stays required at read (a missing `state` is a source defect that should fail
immediately, not something to seed).

**4. Source-config emit contract: omit an absent field; emit `null` only to set
a column null.** A source with no value for a field **omits it** (leaves it
`undefined`) — that is the temporarily-absent partial state a resolver/seed then
fills. Emitting `null` is a deliberate instruction to set the column to `null`,
so a resolver-filled/required field must **never** be emitted `null`. (This is
why the artifact spec for these fields accepts _omitted_ but rejects `null`.)

## Mandated pattern — and disallowed alternatives

This pattern is the **only** way an entity becomes a database mutation. The
following are prohibited; a reviewer must reject them:

- **No second resolution path.** Every property is derived by its facade
  resolver (ADR 0016). No transform-row resolver, no `prepare*Rows` pass, no
  separate planning pass that resolves values and hands them to a facade. A value
  is resolved once, in the facade, and held in its memo.
- **No startup database reads.** The current-row lookup (`getCurrentById`) is
  **lazy and async** — read at `toMutation`, memoized per id — so the create-vs-
  update decision is made at emission. No bulk `readDatabaseRecordsByIds` /
  pre-loaded `databaseXById` maps at construction.
- **No per-resolver cache opt-in.** Cacheability is derived from
  `RESOLVED_PROPERTIES` (generated). Do not hand-mark a resolver cacheable, and
  do not cache `id` or foreign keys.
- **No override escape hatches.** There is no per-entity, per-source, or
  per-property bypass that skips the facade/resolver/cache path or overrides a
  resolved value out-of-band. A source supplies inputs (or a seed supplies a
  resolved value via the cache); it never patches the resolution mechanism.

New entities compose from the same kit; a kind that "needs" one of the above is a
signal the kit is missing a capability, to be added generically — never bypassed.

## Consequences

- One cache mechanism for every resolved property; `agency-coordinate-cache` and
  the coordinate-only `agency-field-resolution` path are removed.
- Adding a new seedable, resolved field is uniform: add it to the entity's
  `createRequired` (generator), attach a `.cached()` resolver on the facade, and
  — if it can be manually supplied — commit a `ResolvedProperty` seed.
- An agency with no source location is a valid partial artifact; it must be
  seeded (address) or have its coordinates seeded (un-geocodable address) before
  it can become a mutation, else the import fails loud. It is never silently
  dropped, and its officers are never lost to exclusion.
- The guarantee is at `toMutation`, not at artifact read; there is intentionally
  no earlier fail-fast for resolver-filled fields.

## Alternatives Considered

- **Make the columns `NOT NULL` / required in the base artifact spec** (the first
  attempt): rejected — it validates the raw record at read, _before_ resolvers or
  seeds run, so a partial artifact is rejected before it can be completed. It
  conflates "the artifact is incomplete" with "the agency is invalid."
- **Keep caching per entity (bespoke coordinate cache):** rejected — it does not
  generalize to address/slug/location-path and duplicates the cache plumbing.
- **Emit `null` for absent fields:** rejected — `null` means "set the column
  null," which a required location field must never be; absence is `undefined`.

## Revisit Trigger

Revisit if resolved properties need per-source cache invalidation beyond
"whatever is on disk wins," or if a resolver-filled field must be enforced
earlier than mutation generation.
