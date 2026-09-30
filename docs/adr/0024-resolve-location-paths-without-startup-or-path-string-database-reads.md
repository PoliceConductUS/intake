# ADR 0024: Resolve Location Paths With Lazy Cached Reads, No Startup Read

## Status

Accepted

> Applies [ADR 0016](0016-resolve-entity-properties-with-composable-resolvers.md)
> (composable resolvers), [ADR 0019](0019-cache-resolved-properties-validate-at-the-mutation-boundary.md)
> (no startup DB reads; cache resolved properties), and [ADR 0023](0023-contexts-return-mapped-source-ids-never-canonical-ids.md)
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

Location-path resolution follows the resolver + cache model, with **no
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
  cache fills as records resolve. Manual corrections use `cache set`; transforms
  do not copy cache values from source checkouts.

  Census geography classes, overlap precedence, and township coverage follow the
  boundary rules below. See also the
  [Census coverage change](../../openspec/changes/import-census-local-jurisdictions/design.md).

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
  cache, nor a live resolve can supply fails loud at the mutation boundary
  (the create spec requires it) — never silently skipped.

- **The transform-row path is deleted.** `transform.ts`, `ImportRows`, the
  transform stage, and the `readLocationPaths` / `readLocationPathAliases` startup
  reads and their pre-loaded snapshots are removed. The census dataset is reached
  only through the two resolvers above.

### Census boundaries and overlapping places

This decision was updated on 2026-09-25 to remove township clipping. It supersedes
the earlier requirement to emit only a township's area outside Census PLACE
boundaries.

For automatic address resolution, consider only boundaries containing the agency
point and use the first nonempty class in this order:

1. **City/CDP:** Census PLACE, `resolution_class: primary`.
2. **Township or other imported local county subdivision:** Census COUSUB,
   `resolution_class: county_subdivision`.
3. **Consolidated municipality:** Census CONCITY,
   `resolution_class: consolidated_city`.

Exactly one distinct canonical place must match in the winning class. Multiple
matches in that class fail loudly; a lower-priority class does not break a tie.
A point inside both a city/CDP and a township resolves to the city/CDP. A point
outside every city/CDP but inside one imported township resolves to the township.
This precedence handles overlapping boundaries without altering them.

Retained townships use their **full original Census boundaries**. The importer
does not subtract city/CDP coverage from the emitted geometry. If the union of
one or more imported PLACE polygons covers **all** of a township, the importer
omits that township and records its GEOID and exclusion reason. For example, two
cities covering opposite halves of a township can jointly cover it completely.
Such a township would never win address resolution because a city/CDP would
always take precedence. The importer does not invent an alias from the omitted
township to one of those cities.

If any township area remains outside PLACE coverage, import the township with
its entire original boundary, including the overlapping portions. Polygon
difference may be used to test complete coverage; its result must never replace
the imported township boundary. Statistical divisions remain excluded under the
Census class-code rules.

**Consolidated municipalities are source geographies, not importer-created
merges.** CONCITY includes entities such as Nashville-Davidson metropolitan
government and Louisville/Jefferson County metro government. These remain
separate from their Census PLACE balance areas and retain their own boundaries
and the third resolution priority above.

Distinct Census GEOIDs must not be combined merely because their common names
produce the same website path. Each retained entity keeps its own record and
boundary. An unresolved path collision fails visibly. For the confirmed
same-name collisions, the entity with greater Census land area (`ALAND`) retains
the common name, and the smaller entity uses its Census label through a
persistent CLI property correction. These are explicit workspace corrections,
not processing-order choices or record-specific code exceptions. See
[ADR 0019](0019-cache-resolved-properties-validate-at-the-mutation-boundary.md).

## Consequences

- No location-path database access at import startup; the address resolver's
  geocode + point-in-boundary runs only on a fingerprint-cache miss and caches
  its result, so a re-import over already-resolved addresses touches the location
  tables not at all.
- State-key references resolve exactly like every other cross-source reference
  (ADR 0023), through the ledger — no bespoke path-string lookup.
- Re-imports are stable and offline once addresses are cached; a new or
  changed address is the only thing that triggers a live geocode.
- An unresolvable location fails the import loudly, prompting a CLI cache correction,
  rather than dropping the record.
- Removing township clipping preserves Census geometry and avoids polygon defects
  introduced by subtraction. It does not repair defects already present in a raw
  Census boundary. Updated boundaries require transformation and generation;
  existing generated artifacts are not rewritten by the code change.
- `getByPath` / `LocationPathDataContext` / `transform.ts` are gone; location
  resolution lives entirely in the facade resolvers and the ledger.

## Alternatives Considered

- **Keep the startup bulk read for speed:** rejected — ADR 0019 forbids startup
  DB reads; per-reference lazy reads on cache misses are the sanctioned pattern.
- **Keep the shared `getByPath` orchestrator (transform-row + durable-state +
  snapshot + lazy read):** rejected — the field resolver owns a single lazy
  cached query by `path`; the multi-layer orchestrator and its transform-row and
  startup-snapshot inputs are the legacy being removed.
- **Forbid live geocoding entirely (manually supply everything):** rejected — a first-seen
  address should resolve live and cache; manual corrections use `cache set`.

## Revisit Trigger

Revisit if the point-in-boundary query needs to leave import (e.g. moves to
acquire), if location paths gain a non-census producer, or if state-key seeding
proves too costly to maintain.

## Census source identity and generated paths

Census source records are keyed by geography type plus GEOID: `state`,
`administrative_area`, `place`, `county_subdivision`, or `consolidated_city`,
followed by `:GEOID:<value>`. Parent and geometry references use these keys.
An alternate-county alias key combines its place key and alternate county key.
A URL or display name is not a source identity.

Transforms preserve distinct Census entities and boundaries even when names
collide. They do not load manual corrections. During generation the shared
correction stage runs before ordinary configured property resolvers derive
child paths from the resolved parent path and corrected display name. Alternate
county URLs use that same corrected name. Unresolved unique-path collisions
fail with both source identities rather than merging polygons.

Changing the source-key contract requires an explicit migration of existing
workspace identity mappings and path-addressed corrections. Canonical website
IDs are retained; the importer does not contain an old-path lookup or
record-specific identity exception. Acquired source files remain read-only.
