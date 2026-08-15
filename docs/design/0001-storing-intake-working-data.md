# Design Note: Storing Intake Working Data (files vs. database staging)

## Status

Draft / exploration — **no decision yet**. Captures a measured problem and the
options, to be resolved by a small spike. Relates to ADR 0002 (replayable
archive), ADR 0015 (namespace isolation), ADR 0016 (#4 canonical-id recovery),
and ADR 0017 (bespoke ORM).

## Problem

A single Texas (`gov.tx.tcole`) run **emits ~456k one-file-per-row artifact YAMLs
and then reads them all back**. Measured on a dry-run against the isolated
`dev-copy` workspace:

| artifact set         | record files                     |
| -------------------- | -------------------------------- |
| AgencyPersonnel      | 170,489                          |
| Licenses             | 152,980                          |
| Personnel            | 129,931                          |
| Agencies             | 2,955                            |
| LicensingAuthorities | 3                                |
| **total**            | **~456,358** (+ license actions) |

- Emit directory: **1.9 GB**.
- The **re-read alone** ("Reading Artifacts") ran **>36 minutes** at 100% CPU and
  had **not finished** when the run was killed; RSS climbed 1.37 → 1.8 GB holding
  the parsed set in memory.
- The same run also produces a **single 98 MB `DatabaseMutations.yaml`** monolith.

So the pipeline spends the bulk of its wall-clock serializing and deserializing
data it just produced, and the storage rule "one file per row / no large YAML"
is applied to the _opposite_ of where it helps.

## The three working stores and their access patterns

| store                                   | access pattern                               | one-file-per-row correct?   | code today                                                                                                                                               |
| --------------------------------------- | -------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Artifacts** (`*.records/*.yaml`)      | write-once → read-once, **bulk**             | ❌ pure round-trip overhead | one file per record (`Artifacts.ts:127`), read back by iterating the index                                                                               |
| **Resolver cache** (`ResolvedProperty`) | **point** lookup by derived path             | ✅                          | `readResolvedProperty` reads the single derived-path file — **matches intent**                                                                           |
| **Ledger** (`SourceNameToCanonicalId`)  | _should be_ point lookup (path is derivable) | ✅ only if point-read       | ❌ **bulk-loaded**: `loadSourceNameToCanonicalIds` `readdir`s + reads every file (~305k) into an in-memory map, up front, every run (`index.ts:153-188`) |

Two of three stores fight their access pattern: artifacts are per-row but want
bulk; the ledger is bulk but wants per-row. The cache is the one that is right.

## Options

### Artifact store (the dominant cost)

- **A. Few chunked/streamed files** — N records per file (e.g. sharded by key
  prefix), streamed on read. Smallest change; keeps plain-file provenance;
  collapses 456k files to a handful. Doesn't remove the disk round-trip.
- **B. In-process emit → import** — skip the disk entirely; the emit sink feeds
  the importer in the same process. Fastest, but couples the two stages and
  weakens the standalone `Artifacts` envelope as an inspection point.
- **C. Database staging schema** _(recommended to spike)_ — the emit sink writes
  rows into an `intake_staging` schema (namespaced by schema or column); the
  importer reads them with `SELECT`. Bulk `COPY` in / `SELECT` out; Postgres is
  already a hard dependency. See "Why C is compelling" below.

### Ledger

Point-read the single derived-path file on demand, memoized (the Identity Map's
in-memory half, ADR 0017), and delete the bulk-mint pre-pass
(`resolveArtifactsSourceNameToCanonicalIds` / `resolveSourceNamesStage`) — which
is already on the finale's demolition list. **Deferred**: for a full re-run this
is ~one read per key either way, so it is not the dominant bottleneck; the win is
bounded memory, one pass instead of two, and cheap partial runs.

### Resolver cache

No change — already point-read by derived path.

## Why the database staging schema (C) is compelling

Beyond raw speed, it may **collapse three problems into one mechanism**:

1. **Artifact I/O** — bulk load/read replaces 456k files.
2. **Ledger bulk-load** — the ledger (and cache) can become tables, point-queried
   or joined; no readdir, no file-per-key.
3. **Canonical-id recovery without a seed** — the blocker in the reconstruction
   test was that the live tables don't store source natural keys, so id-recovery
   could only come from a pre-seeded ledger (ADR 0016 #4's DB natural-key match
   was deferred, and impossible from flat files). A **staging table carries the
   natural keys** (`DEPARTMENT_NUMBER`, `PUBLIC_GUID`, the assignment tuple), so
   existing ids are recoverable in **one set-based query**:
   `LEFT JOIN staging → live ON natural_key` → reuse the matched id, mint where
   null. That is find-or-create as SQL — no ledger seed, no name-matching, no
   305k-file load.

The emit side stays clean: source `config.ts` still emits to an abstract sink
(DB-agnostic, namespace-isolated per ADR 0015); only the sink implementation
changes from files to `COPY`.

## Tension with the replayable archive (ADR 0002)

The replay _unit_ is the `DatabaseMutations` envelope, and provenance is the
source inputs plus the `Artifacts` envelope **digest** (already recorded in the
mutation metadata as `sourceArtifactsDigest`). The per-record artifact _files_ are
an intermediate, not the replay artifact. So ephemeral DB staging is likely
compatible **as long as the Artifacts digest is still recorded** (and, if we want
a durable copy, staging can be dumped to one archive file). **Confirm, don't
assume.**

## Recommendation & next step

Rank by measured impact:

1. **Fix the artifact store first** — it is the bulk of the wall-clock. Spike
   option **C** (staging schema), because it may also subsume the ledger and, more
   importantly, unblock seed-free id recovery. Fall back to **A** (chunked files)
   if the archive/isolation constraints make C too costly.
2. **Ledger point-read + memoize** — fold into the finale; deferred, not urgent.
3. **Cache** — leave as is.

**Spike scope:** stand up an `intake_staging` schema for the TX entities, write
the emit output to it, and measure (a) load + read time vs. the ~36-min file
re-read, and (b) whether a `LEFT JOIN` on natural keys recovers the existing
canonical ids — which would retire the ledger-seed dependency entirely.

## Open questions

- Does staging satisfy ADR 0002 with only the Artifacts digest retained, or do we
  need a durable dump for the archive?
- Schema-per-namespace vs. a `namespace` column — which preserves ADR 0015
  isolation more cleanly?
- If natural-key recovery moves to SQL, what remains of the durable ledger — a
  thin audit record, or nothing?
