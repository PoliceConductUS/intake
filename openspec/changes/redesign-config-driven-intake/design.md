## Context

Intake currently onboards each data source as a **separate git repository** that
re-implements the intake contract. Measured LOC (excluding `node_modules`):
`intake.census-gazetteer` ≈ 7,796; `intake.com...POSTLicenseSearch` ≈ 4,207;
`intake.net.clearinghouse.api` ≈ 2,585. The test names in those repos
(`workspace-boundary`, `evidence-preservation`, `shared-io-loading`,
`source-identity`, `command-validation`) show that most of the code re-tests the
*contract*, not the *data*. The source-specific slice (fetch + field mapping) is
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
regenerate/notify are downstream and separate. Both boundaries are handoff *contracts*,
not transports — how a run is triggered and how a change is transmitted onward is
deliberately undecided, and for now the input is a **manual trigger**.

The existing core to preserve (ADRs 0001–0014): versioned `Artifacts` envelopes,
idempotent intake, preserved raw + transformed artifacts, append-only archive
snapshots, source-local identity mapped to canonical cuid2 IDs via
`SourceNameToCanonicalId`, `ResolvedProperty` caches, deterministic
`DatabaseMutations` + replay, and ADR 0006 (create known-valid related entities).

## Goals / Non-Goals

**Goals:**

- Turn "adding a source" from *authoring a repo* into *adding data* (a transform
  registry entry), achievable in ≤1 hour for the common case.
- One shared runtime that owns all contract plumbing (identity, envelope IO, canonical
  mapping, logging), written and tested once.
- Preserve the deterministic envelope / idempotency / replay / ledger core unchanged;
  the redesign sits *above* it.
- Model this system as: *(triggered with a saved snapshot)* → TRANSFORM(map+resolve) →
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

### D1. Sources are data; the runtime is code.

A source's *transform* is a registry entry (`sources/<id>/`) containing a declarative
`source.yaml`. The runtime interprets it. A new *record kind* is a rare shared-code
change every later source reuses. Rationale: onboarding must be data to hit the
≤1-hour goal at 10k scale; the alternative (per-repo SDK plugins) keeps the ceremony
that is the actual bottleneck.

### D2. Deterministic transform; additive load.

Parse/map is deterministic (no AI). A record vanishing from a source is a no-op
(`reconcile: additive`) — data only accrues, no hard delete or soft-deactivation.
Rationale: keeps the import path deterministic and replayable; disappearance in these
sources does not reliably mean "no longer true," and evidence should not be lost.

### D3. AI belongs in resolution, as a cached decision — not in transform.

Matching source-local names onto canonical state/county/place/agency/officer may use
AI in a later slice, but the *decision* is persisted to the intake-owned mapping
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

### D7. Identity from the source when stable; documented derivation otherwise.

AZ POST has a stable **POST ID** → `identity: { from: [post_id] }`. Sources lacking a
stable ID declare a deterministic derivation with `on_collision: fail`, enforced by
the runtime rather than hand-coded per source.

### D8. The manual trigger is a new CLI front-door that reuses the existing pipeline.

The current CLI exposes `intake import artifacts [--dry-run] <artifacts-ref>` and
`intake replay database-mutations <database-mutations-ref>` (commander, auto-discovered
one-folder-per-command under `src/cli/`; depends on `DATABASE_URL` + `INTAKE_WORKSPACE`).
`import artifacts` starts *after* raw data has already been turned into a typed
`Artifacts` envelope — which is exactly the per-source producer work being deleted.

Slice 1 adds one new discovered command that sits **in front of** `import artifacts`
and performs the `raw → Artifacts` step from config:

```bash
intake run <source-id> <snapshot-ref> [--dry-run]   # command name is an open question
#  1. read sources/<source-id>/source.yaml (transform slice)
#  2. parse the saved snapshot (e.g. the AZ POST xlsx) per config
#  3. emit a typed Artifacts envelope   ← the part producers hand-code today
#  4. hand off to the EXISTING import pipeline (transform → additive load)
#  5. record the durable change
```

`<source-id> <snapshot-ref>` is the input handoff descriptor from D5, passed as CLI
args instead of an event. Rationale: reuse the proven `import artifacts`/`replay`
pipeline unchanged; the only new code is the config-driven `raw → Artifacts` front-end
and the durable change record. `--dry-run` mirrors the existing flag (plan without
applying).

### Source-definition strawman (this repo's TRANSFORM slice only, not final)

```yaml
# sources/gov.azpost.roster/source.yaml   (Slice 1 target — transform slice)
id: gov.azpost.roster
title: Arizona POST — Officer Roster
format: xlsx                    # of the saved snapshot handed in
reconcile: additive
provenance: { request_form: "AZPOST Form PR August 2025.pdf" }
records:
  - kind: Personnel
    identity: { from: [post_id] }
    map: { firstName: $.first, lastName: $.last }   # + rank/misconduct — see Open Questions
# NOTE: connector / schedule / delivery are ACQUIRE config, owned by the
# separate acquisition system — not represented here. Whether that config is a
# second registry or a shared file is an open question.
```

## Risks / Trade-offs

- **Mapping surface too weak for real sources** → Keep a per-source `parse.ts` escape
  hatch for genuinely bespoke cases; grow primitive coverage from real sources rather
  than speculatively.
- **Additive-only lets rosters drift from reality** → Accepted for now; retiring stale
  records is a separate, later concern, not disappearance-driven deletion.
- **Split config across two systems drifts out of sync** → Join by a stable `source id`;
  decide the A/B config-location question before the second system consumes it.
- **Non-deterministic AI resolution could leak into replay** → Structural guard: only
  the *cached decision* is ever read on replay; the resolver adapter must persist before
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

- **Config location under the two-system split** — (A) two registries joined by
  `source id` (leaning) vs (B) one shared `source.yaml`. Undecided.
- **AZ POST rank + misconduct flag → schema.** Map onto existing
  `Personnel`/`AgencyPersonnel` columns, add a new record kind, or defer? Resolve while
  writing the Slice 1 spec by reading the actual record schema; prefer keeping the
  tracer thin.
- **Trigger + transport for both boundaries** — deliberately undecided; manual trigger
  now. No event name baked in.
- **Minimal durable change-record payload for Slice 1** — enough to lock the seam.
- **New CLI command name** — `intake run <source-id> <snapshot-ref>` is a strawman
  (`run` / `ingest` / `transform`?); pin in the spec.
- **`source.yaml` file name + exact schema** — strawman only.
- **Registry storage at scale** — git YAML per source (recommended) vs. table; Slice 4.
- **Whether the AZ POST roster is single-agency or statewide with an agency column** —
  affects whether Slice 1 also emits `Agencies` + `AgencyPersonnel` links or only
  `Personnel`; confirm against the actual spreadsheet during spec writing.
