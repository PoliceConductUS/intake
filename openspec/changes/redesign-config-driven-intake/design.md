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

The existing core to preserve (ADRs 0001–0014): versioned `Artifacts` envelopes,
idempotent intake, preserved raw + transformed artifacts, append-only archive
snapshots, source-local identity mapped to canonical cuid2 IDs via
`SourceNameToCanonicalId`, `ResolvedProperty` caches, deterministic
`DatabaseMutations` + replay, and ADR 0006 (create known-valid related entities).

## Goals / Non-Goals

**Goals:**

- Turn "adding a source" from *authoring a repo* into *adding data* (a registry
  entry), achievable in ≤1 hour for the common case.
- One shared runtime that owns all contract plumbing (evidence, identity, envelope
  IO, canonical mapping, logging), written and tested once.
- Preserve the deterministic envelope / idempotency / replay / ledger core unchanged;
  the redesign sits *above* it.
- Model intake as REQUEST → ACQUIRE → SAVE → TRANSFORM → LOAD, terminating in a
  durable `EntitiesChanged` event.
- Ship a real vertical tracer (AZ POST) end-to-end through intake's responsibility.

**Non-Goals (this change / Slice 1):**

- `scrape`/`socrata`/`arcgis`/`http` auto-pull connectors (Slice 2).
- Automated request issuance + async email-token correlation (Slice 3).
- AI-assisted resolution and `MappingCorrection` ingestion (Slice 4).
- REGENERATE and NOTIFY — owned by external repos (Slices 5–6).
- 10k-source scheduling, change detection, and migrating the sibling repos (Slice 7).
- Any website/publishing code. Intake never imports it.

## Decisions

### D1. Sources are data; the runtime is code.

A source is a registry folder (`sources/<id>/`) containing a declarative
`source.yaml`. The runtime interprets it. A new *connector type* or *record kind* is
a rare shared-code change every later source reuses. Rationale: onboarding must be
data to hit the ≤1-hour goal at 10k scale; the alternative (per-repo SDK plugins)
keeps the ceremony that is the actual bottleneck.

### D2. Deterministic extraction; additive load.

Parse is deterministic (no AI). A record vanishing from a source is a no-op
(`reconcile: additive`) — data only accrues, no hard delete or soft-deactivation.
Rationale: keeps the import path deterministic and replayable; disappearance in these
sources does not reliably mean "no longer true," and evidence should not be lost.

### D3. AI belongs in resolution, as a cached decision — not in extraction.

Matching source-local names onto canonical state/county/place/agency/officer may use
AI in a later slice, but the *decision* is persisted to the intake-owned mapping
ledger with provenance (model, confidence, evidence). Replay reads the frozen
mapping and never re-runs a model. Rationale: preserves ADR 0014's
deterministic/cacheable-resolver invariant while allowing fuzzy matching; the cached
decision is deterministic even though the suggester is not.

### D4. Corrections are pre-reviewed pins that outrank AI.

A visitor correction reaches intake as an already-reviewed `MappingCorrection`
envelope and is pinned immediately (no in-intake review UI). Pins live in the mapping
ledger, survive reset/replay, and can never be overwritten by an AI suggestion.
Rationale: keeps "reconstruct derived state from artifacts + ledger" true and makes
human authority durable.

### D5. System boundary = LOAD + emit `EntitiesChanged`.

Intake owns REQUEST→LOAD and emits a durable, replayable `EntitiesChanged` event.
REGENERATE (site page rebuild) and NOTIFY (subscribers) are external subscribers in
other repos, connected only by the event contract. Rationale: matches the multi-repo
reality; each repo owns its layer; intake stays free of rendering/notification infra.
Alternatives considered: intake triggers the site build (rejected — couples intake to
the site build); one system owns request→notify (rejected — heaviest coupling).

### D6. Delivery is a request/response lifecycle.

Acquire is synchronous (API/download/scrape) or asynchronous (FOIA email/webform
whose reply arrives later). Async responses correlate back to the originating request
via a routing token (e.g. a per-request reply address). Requests and responses are
versioned envelopes and a durable request ledger. Slice 1 uses a **manual** acquire
(operator drops the xlsx) as the stepping stone; automation is Slice 3. Rationale:
the user wants automated FOIA where the answer wires back to the request.

### D7. Identity from the source when stable; documented derivation otherwise.

AZ POST has a stable **POST ID** → `identity: { from: [post_id] }`. Sources lacking a
stable ID declare a deterministic derivation with `on_collision: fail`, enforced by
the runtime rather than hand-coded per source.

### Source-definition strawman (not final)

```yaml
# sources/gov.azpost.roster/source.yaml   (Slice 1 target)
id: gov.azpost.roster
title: Arizona POST — Officer Roster (FOIA)
delivery:  foia                 # manual drop now; automated in Slice 3
schedule:  { remind: 90d }      # re-request cadence, not a poll
connector: { type: file, format: xlsx, sheet: 1, header_row: 1 }
reconcile: additive
provenance:{ request_form: "AZPOST Form PR August 2025.pdf" }
records:
  - kind: Personnel
    identity: { from: [post_id] }
    map: { firstName: $.first, lastName: $.last }   # + rank/misconduct — see Open Questions
```

## Risks / Trade-offs

- **Mapping surface too weak for real sources** → Keep a per-source `parse.ts` escape
  hatch for genuinely bespoke cases; grow connector/primitive coverage from real
  sources rather than speculatively.
- **Additive-only lets rosters drift from reality** → Accepted for now; retiring stale
  records is a separate, later concern, not disappearance-driven deletion.
- **Non-deterministic AI resolution could leak into replay** → Structural guard: only
  the *cached decision* is ever read on replay; the resolver adapter must persist
  before exposing a value (ADR 0014 construction rule). Enforced in Slice 4, designed
  for here.
- **Intake repo grows a large `sources/` tree** → Acceptable; it is data. Storage
  model revisited at scale (Slice 7).
- **`EntitiesChanged` contract churn** → Ship the minimal terminating payload in
  Slice 1 to lock the seam; expand alongside slices 5–6 with the subscriber repos.

## Migration Plan

- **Slice 1** builds the runtime seam and onboards AZ POST as the first data-only
  source; no existing source is touched.
- Existing sibling repos are **not** migrated until Slice 7. Migration then means:
  keep each source's config + irreducible parse, delete the duplicated plumbing, and
  register it under `sources/`.
- Rollback for Slice 1 is trivial: it adds a new code path + one source folder and
  reuses the existing ledger/planner; nothing existing changes behavior.

## Open Questions

- **AZ POST rank + misconduct flag → schema.** Map onto existing
  `Personnel`/`AgencyPersonnel` columns, add a new record kind, or defer? Resolve
  while writing the Slice 1 spec by reading the actual record schema; prefer keeping
  the tracer thin.
- **`source.yaml` file name + exact schema** — strawman only.
- **Minimal `EntitiesChanged` payload for Slice 1** — enough to lock the seam.
- **Registry storage at scale** — git YAML folders (recommended) vs. table; Slice 7.
- **Whether the AZ POST roster is single-agency or statewide with an agency column** —
  affects whether Slice 1 also emits `Agencies` + `AgencyPersonnel` links or only
  `Personnel`; confirm against the actual spreadsheet during spec writing.
