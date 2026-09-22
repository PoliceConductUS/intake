# ADR 0024: Resolve Location Paths With Lazy Cached Reads, No Startup Read

## Status

Accepted

> Applies [ADR 0016](0016-resolve-entity-properties-with-composable-resolvers.md)
> (composable resolvers), [ADR 0019](0019-cache-and-seed-resolved-properties-validate-at-the-mutation-boundary.md)
> (no startup DB reads; cache-and-seed resolved properties), and [ADR 0023](0023-contexts-return-mapped-source-ids-never-canonical-ids.md)
> (references resolve through source ids) to location-path resolution, and
> retires the transform-row / `getByPath` mechanism.

## Context

Location paths are a **shared dataset the census source produces** — the state /
administrative-area / place hierarchy, with **readable path-string canonical
ids** (`/mn/`, `/mn/hennepin/minneapolis/`). Every other source references a
location path, in one of two ways:

- **By a state-level source key** (`mn-post`, `gov.tx.tcole` stamp
  `location_path_id: "mn"` / `"tx"`).
- **Derived from a street address** — an agency has no path; its place-level
  `location_path_id` (and its `latitude`/`longitude`) are resolved from the
  address.

The legacy implementation resolves both through the import `DataContext` against
the database: a bulk **startup read** of every location path (`readLocationPaths`)
plus `transform.ts` building an in-memory row set, and a `getByPath` **path-string
DB lookup** (`"mn"` → `/mn/` → `select … where path = …`) plus a point-in-boundary
spatial query. That violates ADR 0019 (no startup DB reads / bulk pre-loaded
maps) and ADR 0023 (references resolve as source ids, not by re-deriving keys and
hitting the DB).

## Decision

Location-path resolution follows the resolver + cache-and-seed model, with **no
startup read and no path-string DB lookup**.

- **A `location_path_id` source key is the full location-path string** (`"mn"`
  is `/mn/`'s key; a place is its full path). Its field-specific resolver checks
  the `ResolvedProperty` cache; on a miss it queries the `location_path` table
  **by the `path` field** — a lazy, per-reference read — caches the hit, and
  **fails fast and loud** when no row matches (resolve-or-fail; nothing minted).
  There is no startup bulk read, no transform-row snapshot, and no shared
  `getByPath` orchestrator: the resolver owns its lazy cached lookup.

- **An address-derived `location_path_id` (and `latitude`/`longitude`) is a
  single cached resolver over the address.** The resolver calls the geocode API
  and derives the containing place (point-in-boundary), and its result is cached
  keyed on the normalized-address fingerprint in the `ResolvedProperty` store
  (ADR 0019). On a cache hit the import performs **no** location database read.
  On a miss the resolver runs (geocode + point-in-boundary) and writes the result
  to the cache — this is the ordinary resolver populating its own cache, not a
  startup read; its DB access is lazy and per-reference. The `ResolvedProperty`
  cache is **never pre-seeded**: it fills as records resolve. A manual seed is the
  exception — only to fix a data-quality error, or for a value a resolver
  genuinely cannot produce for that source record.

  Census PLACE features have `resolution_class: primary`. Legal county
  subdivisions (including townships) use `county_subdivision`; consolidated
  municipalities use `consolidated_city`. Among boundaries covering the address,
  select the first nonempty class in that order and require one distinct place
  within it. Multiple matches in that class fail. Township site boundaries
  exclude imported PLACE coverage; fully covered subdivisions are omitted. The
  original Census geometry stays in the raw source, and the namespace reports
  each clipped or excluded GEOID. Class precedence also handles shared polygon
  edges without inferring a location from its name. Statistical divisions are
  excluded. See the [Census coverage change](../../openspec/changes/import-census-local-jurisdictions/design.md).

  When no place contains the address point, automatic resolution fails.
  There are no hard-coded ZIP or place exceptions. County-local city/alias
  lookup, a statewide name match, and
  nearest-place selection are not substitutes for containment. A county-only
  result is not a place result. Address coordinates must come from the address
  point, never a city/place/ZIP centroid. See the
  [address-resolution scenarios](../../openspec/specs/artifacts-database-import/spec.md).

  The manual source may create a missing community as a `LocationPath` with an
  explicitly supplied parent and no geometry. Such a record is not an automatic
  containment candidate. Creating it does not resolve any agency address; the
  existing manual resolved-property exception applies when needed. See
  [manual location creation](../manual-locations.md).

  Coordinate fingerprints contain only normalized address inputs, without a
  policy or version marker. An unchanged address reuses its cached coordinates;
  a changed address resolves again on a cache miss. The former `address-point-v1`
  coordinate marker was removed because code-policy changes must not invalidate
  unchanged addresses. Source values and explicit manual overrides retain their
  existing precedence.

  Location-assignment fingerprints contain only latitude, longitude, normalized
  city, and normalized state. No code-policy marker or separate postal ZIP
  invalidates them. Unchanged inputs reuse the cached assignment; changed inputs
  resolve containment on a cache miss using the cached address coordinates.
  Incorrect cached assignments require explicit data corrections.

- **Nothing is written that was not resolved.** A required value
  (`location_path_id`, `latitude`, `longitude`) that neither the source, the
  cache/seed, nor a live resolve can supply fails loud at the mutation boundary
  (the create spec requires it) — never silently skipped.

- **The transform-row path is deleted.** `transform.ts`, `ImportRows`, the
  transform stage, and the `readLocationPaths` / `readLocationPathAliases` startup
  reads and their pre-loaded snapshots are removed. The census dataset is reached
  only through the two resolvers above.

## Consequences

- No location-path database access at import startup; the address resolver's
  geocode + point-in-boundary runs only on a fingerprint-cache miss and caches
  its result, so a re-import over already-resolved addresses touches the location
  tables not at all.
- State-key references resolve exactly like every other cross-source reference
  (ADR 0023), through the ledger — no bespoke path-string lookup.
- Re-imports are stable and offline once addresses are cached/seeded; a new or
  changed address is the only thing that triggers a live geocode.
- An unresolvable location fails the import loudly, prompting a manual seed,
  rather than dropping the record.
- `getByPath` / `LocationPathDataContext` / `transform.ts` are gone; location
  resolution lives entirely in the facade resolvers and the ledger.

## Alternatives Considered

- **Keep the startup bulk read for speed:** rejected — ADR 0019 forbids startup
  DB reads; per-reference lazy reads on cache misses are the sanctioned pattern.
- **Keep the shared `getByPath` orchestrator (transform-row + durable-state +
  snapshot + lazy read):** rejected — the field resolver owns a single lazy
  cached query by `path`; the multi-layer orchestrator and its transform-row and
  startup-snapshot inputs are the legacy being removed.
- **Forbid live geocoding entirely (seed everything):** rejected — a first-seen
  address should resolve live and cache; only a genuine failure is seeded by
  hand.

## Revisit Trigger

Revisit if the point-in-boundary query needs to leave import (e.g. moves to
acquire), if location paths gain a non-census producer, or if state-key seeding
proves too costly to maintain.
