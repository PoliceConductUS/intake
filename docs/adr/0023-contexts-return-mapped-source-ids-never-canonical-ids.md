# ADR 0023: Contexts Return Mapped Source Ids, Never Canonical Ids

## Status

Proposed

> Refines [ADR 0015](0015-isolate-namespaces-and-own-cross-source-identity-at-root.md)
> (source isolation) for the case where a source must reference an intake-owned entity it
> did not create, and corrects [ADR 0022](0022-define-acquire-data-context-responsibilities.md),
> which originally had the acquire context hand a source the canonical id to
> stamp. Applies equally to the import `DataContext` ([ADR 0011](0011-define-data-context-responsibilities.md)).

## Context

A source is isolated behind its namespace (ADR 0015): it knows only its own
namespace-local ids and never an intake **canonical** id. Canonical-id
assignment and the source-id → canonical mapping live in intake-owned state — the
`SourceNameToCanonicalId` ledger (ADR 0016).

But some sources must **reference an entity another source created**.
`courtlistener` discovers federal dockets for agencies that a roster source
imported; each civil-case officer it emits must attach to one of those existing
agencies. The source therefore needs a stable handle for an agency it did not
create and cannot name canonically.

ADR 0022 first solved this by having the acquire context return the agency's
**canonical id** for the source to stamp onto its raw records. That leaks
canonical identity into a source's output, which ADR 0015 forbids: the source
now carries an intake-root id it should never see, and the boundary between
"what the source knows" and "what intake owns" is broken. A later attempt to
launder the id through a computed **fingerprint** (a normalized natural key both
sides recompute) traded the leak for a different flaw — it re-introduced lossy,
name-based resolution at import and required both sides to agree on an exact
normalization.

We need a source to reference an intake-owned entity across phases (acquire →
run) using only a namespace-local id, resolved through the one resolver path
every other foreign key already uses.

## Decision

Every entity a context returns to a source carries a **namespace-local source
id, never a canonical id**. This holds for both the acquire `AcquireDataContext`
(ADR 0022) and the import `DataContext` (ADR 0011).

- **The source id is an opaque minted cuid**, assigned once per
  `(namespace, kind, canonical)` and recorded in the ledger (ADR 0016) as an
  ordinary forward mapping `source_id → canonical`. It is not derived from the
  entity's contents; there is no fingerprint or natural key to agree on.
- **Resolution is uniform.** A source id a source stamped resolves to its
  canonical id at run through the ordinary resolver path
  (`findOrCreateCanonicalId` / `ledger.read`) — the same path every foreign key
  uses. There is no per-entity resolver and no name- or fingerprint-based
  matching (ADR 0016: one generic resolver, not entity-specific backends).
- **The reverse mapping is persisted keyed by canonical, so it is a direct
  read — never a scan.** The ledger forbids bulk directory scans (a prior
  design that bulk-loaded every record is deliberately gone and must not
  return). A forward record is keyed by source id (its filename), so
  `source_id → canonical` is a single-file read; the reverse has no such path
  and would require scanning a directory. So **every mint writes two records**:
  the forward record keyed by source id, and a reverse record keyed by the
  canonical id. `canonical → source_id` is then the same direct single-file read
  as forward. Mint is the only writer of both, so they cannot drift.
- **`sourceIdFor(namespace, kind, canonical)`** reads the reverse record; on a
  miss it mints a source id, writes both records, and returns it. Because a
  second request for the same canonical finds the existing reverse record, one
  canonical maps to exactly one source id per namespace — ambiguity cannot
  arise.
- **A live in-memory cache mirrors both directions**, updated on every mint
  (forward create or reverse mint) and populated on read, so repeated lookups
  within a session avoid re-reading the file. It is a cache over the persisted
  records, not a bulk pre-load.

This yields a **round-trip guarantee**: a source that creates an entity passes a
source id to `create`, which maps to a canonical id; any later acquire or run
call in that namespace hands back that same source id. A source that only
references an entity gets a freshly minted source id on first return, stable
forever after.

### A source resolves database-driven references only through an intake-owned context, in source-id terms

A source resolves a reference to data that lives in the database **only through
an intake-owned context injected into it, and only in source ids** — it never
holds a canonical id and never queries or name-matches the database itself. The
context does all canonical work internally and returns source ids the source may
cache and reuse across the artifacts it emits. Two shapes, each injected into the
phase that needs it:

- **Roster-driven, at acquire** (`agencies(...)`): the acquire context returns
  each agency with its namespace-local `agencyId`. The source stamps it; a
  re-acquire returns the same id (reverse record), so an agency can never map
  differently between acquire, run, or successive runs. Agencies are pinned by
  id — **never resolved by name**.
- **Match-driven, at run** (`resolveOfficer({ agencyId, officerName })`): the
  source's run phase calls a resolver injected into it. Scoped by the agency
  **source id**, the resolver resolves it to the canonical agency, fuzzy-matches
  the officer name against that one roster, **decides the match itself** (the
  confidence/ambiguity gate lives here, because the accept decision is where the
  canonical is known), and — **only on a match** — mints (or reuses) the source
  id for that person-at-agency, returning `{ agencyOfficerId } | null`. The mint
  happens inside this one call: a source-initiated "mint on accept" is
  impossible, because the source has no canonical to identify the officer by. The
  source stamps the returned source id and skips the case if every name comes
  back null. (Extension point: the caller may later inject a scorer to influence
  match selection — still returning only source ids.)

This keeps the deterministic-run boundary honest (ADR 0014): the source performs
no database matching in code it owns; the intake-owned resolver does, behind an
abstraction whose entire surface is source ids. At import each stamped source id
resolves to canonical through the ordinary
ledger path; the import performs no database matching.

## Consequences

- Sources never see canonical ids — ADR 0015 isolation holds even for
  cross-source references. The acquire's output carries only namespace-local
  ids.
- One resolver path for every foreign key (the facade + resolver rule): a
  referenced entity's source id resolves exactly like a self-created one. No
  fingerprints, no import-time name resolution, no bespoke
  `resolve…ByFingerprint` method.
- The ledger gains a second record per mapping (a reverse record keyed by
  canonical) and a live in-memory cache — but **no directory scan and no bulk
  pre-load**, honoring the ledger's standing no-scan rule.
- Acquire and run are symmetric: both return source ids, and a source id round-
  trips across phases and re-runs.
- Cost is bounded: a mapping is written or read only when a source actually
  references an entity (today `courtlistener` → `Agency`, and the officer roster
  → `AgencyPersonnel`); each lookup is one file read, never a scan.
- Forward records written before this ADR have no reverse record. A one-time
  **startup audit** backfills the missing reverse files (a deliberate migration
  scan, not the forbidden runtime scan); until it runs, `sourceIdFor` on a
  pre-existing canonical mints a fresh source id rather than recovering the
  original, so the backfill must precede any reverse lookup over legacy data.

## Alternatives Considered

- **Return the canonical id for the source to stamp** (original ADR 0022):
  rejected — leaks canonical identity into a source's output, breaking ADR 0015.
- **A deterministic fingerprint / natural key as the shared id**: rejected —
  requires both sides to compute an identical normalization, is lossy and
  ambiguous, and re-introduces name-based resolution at import; an opaque minted
  id is exact and needs no agreement on fields.
- **A lazy in-memory reverse index built by scanning the `(namespace, kind)`
  directory**: rejected — it re-introduces the directory scan the ledger
  deliberately removed. Scoping the scan to one namespace and kind narrows it but
  does not honor the "no scan must ever return" rule. Persisting a reverse record
  keyed by canonical keeps every lookup a direct single-file read.
- **A bespoke per-entity resolver** (e.g. `resolveAgencyIdByFingerprint`):
  rejected — entity-specific resolution is a smell; ADR 0016 mandates one
  generic resolver path.

## Revisit Trigger

Revisit if a context must return an entity a source cannot re-resolve by source
id, if the per-mapping reverse record proves too costly at write time (batch or
index it), or if a source ever legitimately needs a canonical id (it should
not — that would signal the isolation boundary is being conflated).
