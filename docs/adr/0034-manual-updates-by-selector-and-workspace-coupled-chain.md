# ADR 0034: Manual Updates Resolve by Selector; the Mutation Chain Lives in the Workspace

## Status

Proposed

> Amends ADR 0033 (Data Mutations as a Replayable Chain) — specifically its
> "the chain directory is committed" consequence and its §4 "curated mutations
> come from the manual source" — and ADR 0031 (Curated Location Aliases Source),
> which scoped the manual source to record _creates_ and put "canonical-identity
> updates out of scope for now." It builds on the selector idea only sketched in
> ADR 0023 (a reference resolves to a source id inside the data context; a
> canonical id never leaves it).

## Context

Two things we assumed in ADR 0033 turned out to be wrong once we tried to author
the first real curated _update_ — the Irving badge backfill (set
`agency_personnel.badge_number` on specific officers).

**1. A canonical id is meaningless without the cache that minted it.** ADR 0033
said "the chain directory is committed … next to the acquired snapshots." But a
chain entry's ids come from the ledger/cache (source-id → canonical-id) built
during import. Keep the chain and lose that cache and you cannot generate the
_next_ entry correctly: a fresh run mints new ids that do not match the ids
already in the chain. Chain and cache are therefore inseparable. Committing the
chain to git while its cache lives in a workspace splits a single unit in two.
The ids are only stable **within one workspace's lineage**, because reconstruction
is replay (ADR 0033) and replay never re-mints. Run the sources from scratch in a
_different_ workspace and every canonical id differs.

**2. A manual update cannot name its target by a hardcoded id.** Because ids are
not stable across workspaces/lineages, an authored update that hardcodes
`agency_personnel.id = <cuid>` is bound to exactly one lineage and breaks the
moment it is applied anywhere else (a rebuilt-from-scratch workspace, a future
environment). The intent — "set Officer Markham's badge" — is lineage-independent;
only its resolved id is lineage-specific.

## Decision

**1. The mutation chain lives in the workspace, coupled to its cache.** It moves
from the committed repo directory `./data-mutations/` to
`$INTAKE_WORKSPACE/data/mutations/`, beside the `command/` (artifacts) and
`state/` (cache/ledger) that produce and stabilize its ids. The chain is a
workspace artifact, not a committed file. Reconstruction stays "fresh database →
apply schema migrations → replay this workspace's chain" (ADR 0033) — now
explicitly _this workspace's_ chain, against _this workspace's_ cache.

**2. Only code lives in git; all acquired and generated data lives in the
workspace.** Source code — including the manual curation source (ADR 0031) — is
committed. Everything a run acquires or produces lives in the workspace:
acquired source snapshots, the manual curation records (acquired through the
manual source like any other source's data), artifacts, the cache/ledger, and the
generated chain. The manual records name their target by a _selector_, not a
canonical id (§3), because an id is neither known nor stable when the record is
authored — not because the record is committed. The workspace is the single
coupled unit of a lineage: the cache, the chain, and the data that produced them,
together.

**3. A manual update names its target by a selector, resolved at generate time.**
A manual update record supplies **no id**. Its identity column is filled by a
_selector_ — a set of field matchers, Kubernetes-style, rooted at the record's own
table. A reference (identity or foreign key) is **scalar-or-selector**: a scalar is
the shorthand (the ledger mint/find, unchanged); a selector object resolves an
existing row by the model-walk. Each selector key is a scalar column (equality) or
a foreign-key relationship (the FK column minus its `_id`) whose value is a nested
selector — so the selector's shape is derived from the model (`FK_REFERENCES`), not
hand-listed.

**The identity declares an explicit verb (POST/PUT/PATCH).** The create-vs-update
decision is _declared_, never inferred, because the default for a canonical kind
(POST) mints — silently creating a row where an update was meant:

- **POST** — a scalar/absent id: create, minting the row's canonical id and
  returning its namespace/kind/id mapping (the existing default).
- **PATCH** — `id: { patch: <selector> }`: resolve one existing row, write only the
  provided fields (a partial update). The badge case.
- **PUT** — `id: { put: <selector> }`: resolve, then replace/upsert from the full
  spec.

```yaml
# a manual AgencyPersonnel record (org.policeconduct.manual)
id:
  patch: { agency: { name: Irving Police Department }, personnel: { last_name: Markham, first_name: James } }
badge_number: "1379"
```

**Create-vs-update is decided locally, on the artifact's own table — no forward
references.** The selector resolves _backward_, to rows already created by earlier
chain entries (the model is complete and valid at that point, ADR 0033), then the
verb decides create-vs-update on the record's own table by the resolved identity —
never by peeking at a not-yet-applied entry.

The PATCH/PUT resolver is **resolve-or-fail**, exactly like a LocationPath reference
(ADR 0031): it must match **exactly one** row — zero or many fails loud, never a
guess, never a mint (an update targets an existing row). Resolution happens **at
`generate` time**, and the resolved concrete id is **materialized** into the chain
entry (`metadata.name = <that workspace's cuid>`). The selector never survives
into the replayed entry, so replay stays deterministic and never re-queries the
database (ADR 0033 §8). The selector, not a hardcoded id, is the authored form
because the canonical id is neither known nor stable when the record is authored:
it is minted inside the data context (ADR 0023) and differs across lineages. The
selector resolves at generate time against whichever workspace it runs in.

**4. This lifts ADR 0031's "canonical-identity updates out of scope."** The manual
source now handles updates to existing entities, not only creates — starting with
`AgencyPersonnel.badge_number`. Absent-field omission (ADR 0033 §4) still applies:
a manual update writes only the fields it sets, so `badge_number` is a minimal,
field-level delta that re-supplies no other column.

**5. The Liquibase-style lifecycle is general, not manual-only.** `data-mutations
generate | up | down | status | verify` is the create-and-apply lifecycle for
_every_ source's mutations (ADR 0033). A selector-resolved manual update is one
producer feeding that lifecycle, not a separate mechanism.

## Non-Goals (deferred; the design accommodates but does not build them)

- **Multiple environments.** The layout is intentionally one level shy of
  `$INTAKE_WORKSPACE/<env>/data/…`, so that later "every folder under
  `$INTAKE_WORKSPACE` is an environment" needs only to insert the `<env>` segment
  and default it. No environment registry — the folder name _is_ the env. Not
  built now; not needed soon.
- **Promotion.** Because artifacts are lineage-independent and manual records
  resolve by selector, a future `promote <from> <to>` could re-derive the target
  environment's mutations from the source environment's artifacts and manual
  records (both in the source workspace). Explicitly out of scope now.

## Consequences

- **The chain directory moves out of the repo into the workspace.** `chainDir`
  resolves under `$INTAKE_WORKSPACE/data/mutations` instead of `./data-mutations`;
  `genesis` and the (to-be-added) `reconstruct` command follow. The repo carries
  neither the chain nor the manual records — both live in the workspace with all
  other acquired and generated data. Only code is committed.
- **The manual source gains a selector-based id resolver and update support.** A
  new resolve-or-fail resolver fills the identity column from a selector; the
  handled kinds grow to include `AgencyPersonnel` updates.
- **Manual records carry a `provenance` annotation.** Unlike a source with an
  acquire manifest, a manual record's authority is a cited external document; the
  annotation is its audit trail.
- **ADR 0033 §"the chain directory is committed" is superseded** by Decision 1
  here; its §4 curated-mutations mechanism is made concrete by Decision 3.

## Alternatives Considered

- **Author the update by hardcoded canonical id.** Simplest, and safe _within_ a
  frozen lineage — but not portable across workspaces, so it could not survive a
  from-scratch rebuild or a future environment. Rejected in favor of the selector.
- **Keep the chain committed (ADR 0033 as written).** Rejected: the chain's ids
  are meaningless without the cache that minted them, and that cache is a workspace
  artifact — committing one without the other splits an inseparable unit.
- **Keep the selector in the chain entry and re-resolve on every replay.**
  Rejected: replay would re-query the database and depend on its state, breaking
  the determinism ADR 0033 §8 guarantees. The selector resolves once, at generate.
- **Resolve by business key rather than a general selector.** The selector is the
  general form (any field combination); a business key is the common case of it.

## Revisit Trigger

A second environment actually appears (insert the `<env>` segment; build
`promote`); a selector legitimately needs to match more than one row for a bulk
update (today many-match fails loud); or a manual update must target a field a
source also writes (the chain's sole-writer assumption for downgrade, ADR 0033 §9).
