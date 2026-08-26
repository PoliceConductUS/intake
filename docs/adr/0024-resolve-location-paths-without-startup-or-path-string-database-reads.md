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
