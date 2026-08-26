## Context

Intake currently onboards each data source as a **separate git repository** that
re-implements the intake contract. Measured LOC (excluding `node_modules`):
`intake.census-gazetteer` ≈ 7,796; `intake.com...POSTLicenseSearch` ≈ 4,207;
`intake.net.clearinghouse.api` ≈ 2,585. The test names in those repos
(`workspace-boundary`, `evidence-preservation`, `shared-io-loading`,
`source-identity`, `command-validation`) show that most of the code re-tests the
_contract_, not the _data_. The source-specific slice (fetch + field mapping) is
small. The backlog (`intake.gov.data.tempe`, `intake.gov.az.post` + `intake.gov.azpost`)
is raw files with no code — onboarding never started.

The upstream producer model (ADR 0005), `Command` envelope, and source-producer
guide institutionalize this per-repo cost. The user expects **tens of thousands of
sources** (FOIA, APIs, YouTube/portal crawling) and needs onboarding to be trivial
(≤1 hour) with recurring updates. The user is not committed to any part of the
existing intake pipeline, but the deterministic envelope/replay core has proven
value.

The wider chain is split across systems by **two boundaries**:

```
ACQUISITION (separate system)          INTAKE (this repo)               external
 REQUEST → ACQUIRE → SAVE  ─handoff─▶  TRANSFORM → LOAD → change  ─▶  REGENERATE / NOTIFY
```

**This change concerns only the middle system.** Acquisition is upstream and separate;
regenerate/notify are downstream and separate. Both boundaries are handoff _contracts_,
not transports — how a run is triggered and how a change is transmitted onward is
deliberately undecided, and for now the input is a **manual trigger**.

The existing core to preserve (ADRs 0001–0014): versioned `Artifacts` envelopes,
idempotent intake, preserved raw + transformed artifacts, append-only archive
snapshots, source-local identity mapped to canonical cuid2 IDs via
`SourceNameToCanonicalId`, `ResolvedProperty` caches, deterministic
`DatabaseMutations` + replay, and ADR 0006 (create known-valid related entities).

## Goals / Non-Goals

**Goals:**

- Turn "adding a source" from _authoring a repo_ into _adding data_ (a transform
  registry entry), achievable in ≤1 hour for the common case.
- One shared runtime that owns all contract plumbing (identity, envelope IO, canonical
  mapping, logging), written and tested once.
- Preserve the deterministic envelope / idempotency / replay / ledger core unchanged;
  the redesign sits _above_ it.
- Model this system as: _(triggered with a saved snapshot)_ → TRANSFORM(map+resolve) →
  LOAD(additive) → record a durable change. Keep both boundaries transport-agnostic.
- Ship a real vertical tracer (AZ POST) end-to-end through this system's responsibility.

**Non-Goals (this repo / Slice 1):**

- **All of acquisition** — REQUEST → ACQUIRE → SAVE, i.e. connectors, HTML scraping,
  the FOIA request/response lifecycle (automated FOIA, async email-token correlation),
  and per-source schedules. These live in a separate upstream system.
- Any transport for either boundary — event bus, queue, webhook, polling. Input is a
  manual trigger; output is a durable record. Transport is future and undecided.
- AI-assisted resolution and `MappingCorrection` ingestion (Slice 2).
- REGENERATE and NOTIFY — owned by external repos.
- Many-source scale and migrating the sibling repos (Slice 4).
- Any acquisition or website/publishing code. Intake never imports it.

## Decisions

### D1. A source is a small code module; the runtime owns all plumbing.

A source is a `sources/<id>/config.ts` module that exports `run`. It reads the
CLI-provided paths and **returns an `Artifacts` manifest** of the records it generated;
the runtime owns everything else. This reverses the earlier "sources are pure data"
framing after the prior art (`data.rebrokerlist.com/*/config.js`) showed even simple
sources need real filter + transform logic — the actual win was never "no code," it was
**deleting the ~90% duplicated plumbing**, which a thin module against a runtime SDK
preserves (AZ POST is ~15 lines). A new _record kind_ is a rare shared-code change every
later source reuses. The runtime is **kind-agnostic**: a source returns exactly the kinds
its `run` generated — no
source is assumed to produce any particular kind (a source may be location-only, e.g.
census). Rationale: onboarding must collapse to the irreducible source-specific code to
hit the ≤1-hour goal at 10k scale.

### D2. Deterministic transform; additive load.

Parse/map is deterministic (no AI). A record vanishing from a source is a no-op
(`reconcile: additive`) — data only accrues, no hard delete or soft-deactivation.
Rationale: keeps the import path deterministic and replayable; disappearance in these
sources does not reliably mean "no longer true," and evidence should not be lost.

### D3. AI belongs in resolution, as a cached decision — not in transform.

Matching source-local names onto canonical state/county/place/agency/officer may use
AI in a later slice, but the _decision_ is persisted to the intake-owned mapping
ledger with provenance (model, confidence, evidence). Replay reads the frozen mapping
and never re-runs a model. Rationale: preserves ADR 0014's deterministic/cacheable-
resolver invariant while allowing fuzzy matching; the cached decision is deterministic
even though the suggester is not.

### D4. Corrections are pre-reviewed pins that outrank AI.

A visitor correction reaches intake as an already-reviewed `MappingCorrection`
envelope and is pinned immediately (no in-intake review UI). Pins live in the mapping
ledger, survive reset/replay, and can never be overwritten by an AI suggestion.
Rationale: keeps "reconstruct derived state from artifacts + ledger" true and makes
human authority durable.

### D5. Two handoff boundaries, transport-agnostic.

This system sits between two contracts, and owns neither transport:

- **Input contract:** a run is triggered with a minimal descriptor — `source id`, a
  pointer to the saved snapshot, digest, format. Today this is a **manual CLI trigger**;
  the acquisition system produces the snapshot. No event name or transport is baked in.
- **Output contract:** a completed run records a **durable change** (source, affected
  canonical ids, kinds). Whether/how that is transmitted to regenerate/notify is
  undecided and out of scope.

Rationale: the user is unsure how events will be transmitted; committing to a transport
now would be premature. Designing to a handoff contract keeps both boundaries stable
while the transport is chosen later. Alternatives considered: a firm `NewDataAvailable`
input event and `EntitiesChanged` output event (rejected for now — locks transport
prematurely).

### D6. Acquisition is a separate upstream system.

The request/response lifecycle — issuing requests (scrape/API/download/FOIA
email/webform), receiving sync or async responses, correlating an async response back
to its originating request via a routing token, preserving evidence, and scheduling —
belongs to the acquisition system, **not this repo.** This repo begins at a saved
snapshot. A source's ACQUIRE config (connector, schedule, delivery, FOIA form) is owned
there; this repo owns only the TRANSFORM slice.

### D7. Identity is the emit key; derive it deterministically when the source lacks one.

`run` passes a `sourceKey` to `ctx.emit`; that key is the source-local identity the
existing pipeline mints the canonical cuid2 from. AZ POST uses POST ID directly. A
source lacking a stable id derives the key deterministically from stable fields inside
its own `run`, failing loudly on collisions.

### D8. The manual trigger is a new CLI front-door that reuses the existing pipeline.

The current CLI exposes `intake import artifacts [--dry-run] <artifacts-ref>` and
`intake replay database-mutations <database-mutations-ref>` (commander, auto-discovered
one-folder-per-command under `src/cli/`; depends on `DATABASE_URL` + `INTAKE_WORKSPACE`).
`import artifacts` starts _after_ raw data has already been turned into a typed
`Artifacts` envelope — which is exactly the per-source producer work being deleted.

Slice 1 adds one new discovered command that sits **in front of** `import artifacts`
and performs the `raw → Artifacts` step from config:

```bash
intake run <source-id> <path...> [--dry-run]
#  1. load sources/<source-id>/config.ts  (must export run)
#  2. invoke run(paths, <injected deps>) — it reads the path(s)
#  3. run RETURNS an Artifacts manifest of the records it generated  ← producers hand-code this today
#  4. hand the returned manifest to the EXISTING import pipeline (transform → additive load)
#  5. reuse the DatabaseMutations envelope as the durable change record
```

`<source-id> <path...>` is the input handoff descriptor from D5, passed as CLI args
instead of an event. Rationale: reuse the proven `import artifacts`/`replay` pipeline
unchanged; the only new code is the source-module loader and the glue that imports the
returned manifest. `--dry-run` mirrors the existing flag (plan without applying).

### D9. Dependencies are injected (DI), not pulled from a service-locator context.

The runtime does **not** pass `run` a broad `ctx` object. Following ADR 0014 — _"stages
must not discover side effects by reaching through broad context objects… receive those
adapters directly"_ — and the existing `importArtifacts` precedent (injected `logger`,
`clientFactory`, `resolveAgencyCoordinates`), the `intake run` command is the
**composition root**: it constructs narrow, single-purpose adapters and injects only the
ones a module declares. `run` receives the CLI paths plus those narrow capabilities as
explicit typed parameters — for AZ POST just a deterministic parse capability; a per-run
workspace path and persistent state path (the `Command` envelope's `path`/`statePath`
grants) are injected only when a module needs them. `run` does **not** receive an `emit`
callback — it returns its manifest (see D10). `run` MUST be deterministic (no network,
clock, or randomness) so the existing replay/idempotency core keeps working. The exact
injected surface is deferred design work.

Rationale: a fat context doing emit + parse + workspace + state + logging is exactly the
service-locator god-object ADR 0014 bans; narrow injection keeps each source's real
dependencies visible and unit-testable (`run({paths, readXlsx: fake})` → assert the
returned manifest), and the runtime keeps ownership of every intake-owned envelope,
mapping, and mutation. There is no DI _framework_ in the repo (and none is added — YAGNI);
injection is manual via the command composition root, exactly as `importArtifacts` already
does it.

### D10. `run` returns a manifest; it does not emit, and it does not stream.

`run` is a value-returning function: it returns an `Artifacts` manifest of the records it
generated, and the runtime imports what is returned. It does **not** take an injected
`emit` callback (a callback sink couples the module to runtime collection and is harder to
test), and it does **not** stream. Rationale: returning a manifest maps `run` exactly onto
the existing producer→`import artifacts` boundary — the `Artifacts` envelope already _is_ a
manifest of generated records — so `intake run` is a thin wrapper over the proven pipeline,
and `run` is trivially testable (`run(deps)` → assert manifest). Streaming was considered
and rejected for now: the downstream import pipeline is inherently batch (it sorts by
dependency order and plans a _complete_ `DatabaseMutations` envelope), the manifest is the
hashable audit artifact the idempotency guard needs, and target scale (rosters, FOIA
sheets — thousands to low-hundred-thousands of rows) fits in memory trivially. The seam
stays open: a `run` can process a folder file-by-file internally, and the return type
could widen to an async-iterable later if a genuinely huge source _and_ a streaming import
path ever coexist. Whether the returned manifest carries records inline or references
files `run` wrote is a deferred plan-time detail (inline recommended for Slice 1).

### Source module strawman (Slice 1 target, not final)

```ts
// sources/gov.azpost.roster/config.ts   (exact dep + manifest types are TBD)
// deps are INJECTED by the `intake run` composition root — no service-locator ctx
export const run = async ({ paths, readXlsx }: RunDeps): Promise<Manifest> => {
  const personnel: Record<string, { spec: PersonnelSpec }> = {};
  for (const path of paths) {
    for (const row of await readXlsx(path)) {
      // injected parse capability
      if (!row["POST ID"]) continue; // filter (plain code)
      const key = String(row["POST ID"]);
      personnel[key] = {
        spec: {
          id: key,
          first_name: row["First"],
          last_name: row["Last"],
          middle_name: row["Middle"] ?? null,
        },
      };
    }
  }
  return { records: [{ kind: "Personnel", records: personnel }] }; // ← returned manifest
};
```

- `filter` and `map` are just code inside `run` (filter chain / map pipeline as plain
  functions) — no DSL to invent, and type-checked against the record specs.
- namespace + envelope name are runtime-derived (namespace = source id, name = source id
  - snapshot digest, which also drives the "already imported" guard).
- validity of each emitted record is enforced by the existing envelope schema, not by
  the runtime.
- rank/misconduct deferred (no new kinds/columns in Slice 1).
- deterministic value transforms (split/reformat) are just code in `run`; the prior art
  shows they will grow — kept as plain functions rather than a config DSL.
- acquisition (connector, schedule, delivery) lives in the separate system (deferred).

**Prior art (`data.rebrokerlist.com/data/*/config.js`):** each source was a `config.js`
with a `field_map` (target ← source, incl. literal constants) plus a `filter_function`
that both reshaped rows (date/phone reformatting, dropping empty fields) and returned a
keep/drop boolean. That directly motivates the `config.ts` + `run` shape here: real
sources need filter + transform _as code_, so the module owns that logic while the
runtime owns all plumbing. AZ POST needs no transform, so its `run` is a plain
read-filter-emit loop.

## Risks / Trade-offs

- **`run` executes arbitrary code and could be non-deterministic** → Determinism is a
  contract (no network/clock/randomness), enforced by convention + a required per-source
  unit test (`run({paths, emit: fake, readXlsx: fake})` → asserted records). First-party
  in-repo modules only.
- **Additive-only lets rosters drift from reality** → Accepted for now; retiring stale
  records is a separate, later concern, not disappearance-driven deletion.
- **Split config across two systems drifts out of sync** → Deferred: Slice 1 has a
  single config file. When the acquire config is added later, join by a stable `source id`.
- **Non-deterministic AI resolution could leak into replay** → Structural guard: only
  the _cached decision_ is ever read on replay; the resolver adapter must persist before
  exposing a value (ADR 0014 construction rule). Enforced in Slice 2, designed for here.
- **Change-record contract churn** → Ship the minimal durable record in Slice 1 to lock
  the seam; expand alongside the downstream regenerate/notify systems.

## Migration Plan

- **Slice 1** builds this system's transform seam and onboards AZ POST as the first
  data-only source, triggered manually against a saved snapshot; no existing source is
  touched.
- Existing sibling repos are **not** migrated until Slice 4. Migration then means: keep
  each source's transform config + irreducible parse, delete the duplicated plumbing,
  and register it under `sources/`. (Their acquisition concerns move to the acquisition
  system separately.)
- Rollback for Slice 1 is trivial: it adds a new code path + one source folder and
  reuses the existing ledger/planner; nothing existing changes behavior.

## Open Questions

- **Trigger + transport for both boundaries** — deliberately undecided; manual trigger
  now. No event name baked in.
- **xlsx snapshot parser** — no raw-file parsing exists in the repo today; Slice 1 adds
  one. Dependency (e.g. a SheetJS-style reader) vs. a minimal hand-rolled reader is a
  spec decision.
- **Injected dependency surface for `run`** — deferred design work (user's call). Fix the
  DI _style_ now (narrow injected adapters, no service-locator ctx); settle the concrete
  set in the plan, driven by what AZ POST's `run` actually needs (emit + xlsx parse, and
  workspace/state only if used) and the `RunDeps` type shape.
- **Registry storage at scale** — git-tracked `sources/` modules (recommended) vs. table;
  Slice 4.

Resolved during brainstorming / grounding against the code:

- **Config location** — Slice 1 uses a single config file (transform slice only). The
  second (acquire) config is deferred; not needed yet.
- **AZ POST rank + misconduct flag** — import only fields `PersonnelSpec` already
  supports (`first_name`, `last_name`, `middle_name`, `prefix`, `suffix`, `id`, `slug`);
  rank/misconduct are deferred (Slice 1 adds no new record kinds or columns).
- **CLI command name** — `intake run <source-id> <snapshot-ref>`.
- **Which kinds a source emits** — the runtime is kind-agnostic: a source emits exactly
  the record kinds its config declares; no source is assumed to produce agencies or
  personnel (a source may be location-only, e.g. census). AZ POST declares `Personnel`.
- **Durable change record** — reuse the existing `DatabaseMutations` envelope the import
  pipeline already writes to the command directory (there is no `DatabaseMutationResults`
  type). Slice 1 adds no new change type; a transport-facing change event is deferred.
- **Identity mechanism** — the source-local record _key_ (chosen by `identity`) is the
  `sourceName`; the existing pipeline mints and persists the canonical cuid2 under
  `intake/state/namespaces/<namespace>/`. AZ POST uses POST ID as the record key, so
  `intake run` writes no identity code of its own.
