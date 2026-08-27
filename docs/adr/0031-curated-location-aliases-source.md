# ADR 0031: Curated Location Aliases Source

## Status

Proposed

## Context

The geocoder's place-snap resolves an address to a `location_path` by the county
the point falls in plus the address's city slug, through a path-then-alias lookup
(ADR: alias-aware snap). A `location_path_alias` (`alias_path → location_path_id`)
therefore corrects a misspelled or alternate city name precisely. The gazetteer
emits aliases for alternate administrative-area names, but there was no way for a
human to add a **curated** alias for a misspelling they find in the wild.

Aliases are first-class artifacts (`LocationPathAlias`, natural key `alias_path`),
so a curated alias is just a source that emits them — no new import path.

## Decision

Add a source `com.policeconduct.location-alias` whose curated data is built
interactively and accumulated in an append-only chain.

**acquire is interactive and append-only.** It prompts a human for one mistaken/
alternate location **URL** and its canonical **URL** (or takes them from
`LOCATION_ALIAS_URL` / `LOCATION_CANONICAL_URL` for non-interactive/test runs),
extracts each location path (`/state/county/place/`) from the URL, and **appends**
the pair to the current alias list. It writes a new **immutable** output (named by
its own content hash) that carries the full list plus a reference to the
**previous output's path + sha256**, then moves a mutable `latest` pointer — the
same immutable-versions-plus-movable-pointer shape as the publish handoff. The
chain makes any out-of-band edit to a prior output detectable (a sha mismatch
fails loud). A repeated `alias_path` updates its target (dedup).

**run emits the latest as artifacts.** It reads the latest output and emits one
`LocationPathAlias` record per alias, keyed by `alias_path`; `location_path_id`
carries the canonical path and **resolves-or-fails** to a real `location_path` at
import (only artifact-declared aliases are created).

The chain lives in the source's persistent `state`, so acquire and run share it
across commands.

## Consequences

- Humans get a durable, auditable place to record known misspellings/alternates;
  the alias-aware snap then corrects them automatically.
- The sha chain is integrity, not history: it detects tampering/drift, while git
  remains the real history of the committed state.
- Gated behind the full reconstruction rebuild like every new source; the source
  and its tests land now, it runs after.

## Alternatives Considered

- **A hand-edited YAML of aliases.** Rejected: no capture UX, no integrity chain,
  and easy to malform. The interactive acquire + content-hash chain is safer.
- **Ad-hoc `location_path_alias` rows.** Rejected: bypasses the artifact/import
  path and its resolve-or-fail guarantee.

## Revisit Trigger

Aliases need attributes beyond `alias_path → canonical` (e.g. provenance notes,
effective dates), or a bulk-import path is needed alongside the interactive one.
