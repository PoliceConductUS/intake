## Design Summary

Replace the current "one git repo per source" intake model with **one shared
intake runtime plus a registry of source definitions that are data, not code.**

Today every source (`intake.census-gazetteer` ~7.8k LOC, `intake.com...POSTLicenseSearch`
~4.2k LOC, `intake.net.clearinghouse.api` ~2.6k LOC) is a separate repository that
re-implements ~90% identical contract plumbing — command-envelope validation,
workspace boundary, shared-IO loading, evidence preservation, source-digest,
logging, metadata, identity derivation. The genuinely source-specific part (fetch +
field mapping) is a small slice. Onboarding a source is the wall; the backlog
(`intake.gov.data.tempe`, `intake.gov.az.post`/`azpost`) never got past raw files.

Target: **a new source is data, added in ≤1 hour, and then updated on a cadence.**
Adding a *source* becomes a registry entry. Adding a new *record kind* is a rare
shared-code change every later source reuses for free.

Intake is one stage in a longer chain, split across systems by **two boundaries**:

```
┌ ACQUISITION (separate system) ┐          ┌ INTAKE (this repo) ┐          ┌ external ┐
 REQUEST → ACQUIRE(sync|async) → SAVE ─▶│─ TRANSFORM(map+resolve) → LOAD(additive) ─│▶─ REGENERATE
   connectors · scraping · FOIA      handoff   → record durable change        change    NOTIFY
   request/response · schedules      contract                                 record
```

**This repo owns only the middle: given a saved snapshot, TRANSFORM → LOAD → record a
durable change.** Acquisition (connectors, HTML scraping, the FOIA request/response
lifecycle, schedules) is a **separate upstream system.** REGENERATE (rebuild impacted
site pages) and NOTIFY (subscribers) are **separate downstream systems**
(`policeconduct.org`, `section1983.org`). Intake never imports acquisition or website
code.

**Both boundaries are handoff *contracts*, not transports.** How a run is triggered,
and how a completed change is transmitted onward, is deliberately undecided. **For now
the input is a manual trigger** carrying a minimal descriptor (source id, saved-snapshot
ref, digest, format); the output is a durable change record. An event bus / queue /
webhook is future work and out of scope for this repo.

The existing envelope / idempotency / replay / `SourceName→ID` / `ResolvedProperty`
core (ADRs 0001–0014) is **preserved, not replaced.** The redesign sits *above* it: it
turns per-source *transform* code into per-source config, consumed from a saved
snapshot via a manual trigger.

## Alternatives Considered

### Approach A: Config registry + one shared runtime (sources are data) — CHOSEN

- **Approach**: Source transform definitions live as data (`sources/<id>/source.yaml`)
  inside the intake repo. One shared runtime interprets them: a field-map layer
  produces typed records, the existing ledger resolves canonical IDs, the existing
  planner produces additive `DatabaseMutations`. Custom deterministic parse is a rare
  per-source `parse.ts` escape hatch, not the norm.
- **Pros**: Data-only onboarding meets the ≤1-hour goal; contract plumbing
  written/tested once; the 90% duplication disappears; the existing deterministic core
  is reused unchanged.
- **Cons**: The intake repo grows a large `sources/` tree; all sources share one
  runtime release cadence; an expressive-enough mapping surface must be designed.
- **Why selected**: It is the only option that makes onboarding *data* rather than a
  new repo, which is the entire point. The user explicitly chose "pure config
  registry, zero per-source code by default."

### Approach B: Thin plugins against a published `@intake/sdk`

- **Approach**: Sources stay separate repos/packages but import an SDK that owns all
  plumbing, shrinking each source from ~5k to ~200 lines.
- **Pros**: Preserves independent per-source ownership and release cadence; removes
  most duplication.
- **Cons**: Still a repo to stand up per source (scaffolding, CI, dependency version
  drift) — realistically exceeds the 1-hour target; onboarding is still "code," not
  "data."
- **Why not selected**: Keeps the per-repo ceremony that is the actual bottleneck at
  10k-source scale.

### Approach C: Keep status-quo (one hand-written producer repo per source)

- **Approach**: Continue building a bespoke producer module per source.
- **Pros**: Maximum per-source flexibility; no new runtime to build.
- **Cons**: ~2.5k–7.8k LOC of duplicated plumbing per source; does not scale to tens
  of thousands of sources; the backlog already proves the wall.
- **Why not selected**: This is exactly the model being replaced.

## Agreed Approach

Approach A. Build one shared runtime + a data-only source *transform* registry,
delivered in slices. The existing deterministic import/replay core is reused; the
redesign turns per-source transform code into config on top of that core, consumes a
saved snapshot via a manual trigger, and records a durable change on completion.

Deliver in slices, tracer first. **Acquisition (REQUEST → ACQUIRE → SAVE) is a separate
system with its own roadmap and is not sliced here.**

| Slice | Deliverable (this repo) |
|---|---|
| **1 — Vertical tracer (AZ POST)** | Manual trigger against a saved xlsx snapshot → transform (POST ID identity + field map) → additive load through the existing ledger → record a durable change. Proves data-only transform config + the TRANSFORM→LOAD spine on a real source. |
| 2 — Resolution & corrections | AI-assisted matching as a *cached* resolver strategy + `MappingCorrection` envelope ingestion with pin precedence. |
| 3 — Change-record contract | Firm up the durable change record a completed run produces (consumed later by regenerate/notify; transport still separate). |
| 4 — Scale + migrate | Many-source transform registry; collapse the sibling repos' transform slices onto the runtime and delete duplicated plumbing. |

Only Slice 1 is specified now; slices 2–4 are the roadmap.

## Key Decisions

- **Two handoff boundaries, transport-agnostic.** *Input:* this system is triggered
  (manually for now) with a descriptor pointing at a saved snapshot (source id,
  snapshot ref, digest, format). *Output:* it records a durable change (source, ids,
  kinds). How runs are triggered and how changes are transmitted onward is
  undecided and out of scope for this repo.
- **The manual trigger is a new CLI front-door.** Current CLI: `intake import artifacts
  [--dry-run] <artifacts-ref>` and `intake replay database-mutations <ref>` (commander,
  auto-discovered per folder). `import artifacts` starts *after* raw→typed-`Artifacts`,
  which is the producer work being deleted. Slice 1 adds one command in front of it —
  strawman `intake run <source-id> <snapshot-ref> [--dry-run]` — that does raw→`Artifacts`
  from config, then reuses the existing pipeline unchanged. The two args are the input
  handoff descriptor, passed as CLI args instead of an event.
- **Acquisition is a separate system.** REQUEST → ACQUIRE(sync|async) → SAVE —
  connectors, HTML scraping, the FOIA request/response lifecycle (incl. automated FOIA
  + async email-token correlation), and schedules — live upstream, not in this repo.
  This repo starts from a saved snapshot.
- **Deterministic transform.** No AI in parse/map. Re-running the same snapshot yields
  identical `DatabaseMutations`.
- **Additive load.** A record disappearing from a source is a no-op; data only accrues.
  No hard deletes or soft-deactivation on disappearance. (`reconcile: additive`.)
- **AI lives only in resolution, as a cached decision.** Matching source-local names
  onto canonical state → county → place → agency → officer may use AI, but the
  *decision* is persisted to the intake-owned mapping ledger with provenance (model,
  confidence, evidence). Replay reads the frozen mapping and never re-runs a model,
  preserving ADR 0014's deterministic/cacheable-resolver invariant.
- **Corrections are pins that outrank AI.** A visitor correction arrives as an
  already-reviewed `MappingCorrection` envelope; intake pins it on sight (no in-intake
  review UI). Pinned mappings survive reset/replay and can never be overwritten by an
  AI suggestion.
- **Identity comes from the source when it has a stable ID.** AZ POST has a stable
  **POST ID**, so `identity: { from: [post_id] }`. Sources without a stable ID must
  declare a documented deterministic derivation with `on_collision: fail`.
- **A source's config splits by boundary.** ACQUIRE config (connector, schedule,
  delivery, FOIA form) belongs to the acquisition system. This repo owns only the
  TRANSFORM slice (`records`, `identity`, `map`, `links.resolve`, `reconcile`). Whether
  those live as two registries joined by `source id`, or one shared file each system
  reads a slice of, is open (see below).
- **Source-definition surface (strawman, not final):** `id`, `records` (`kind`,
  `identity`, `map`, `links.resolve`), `resolution` strategies, `reconcile: additive`,
  `provenance`. The exact file name/shape is intentionally not locked yet.

## Open Questions

- **Config location under the two-system split.** (A) two registries joined by
  `source id` — each system owns its slice; leaning this way. (B) one shared
  `source.yaml` per source both systems read the relevant part of. Not yet decided.
- **AZ POST rank + misconduct flag → schema.** The roster carries a Level/rank and a
  Misconduct flag (`YES`/`NO`/`Other-Unknown`). Whether these map onto existing
  `Personnel`/`AgencyPersonnel` columns, require a new record kind, or defer to a
  fast-follow will be settled while writing the Slice 1 spec by reading the actual
  record schema. Preference: keep the tracer thin.
- **Trigger + transport for both boundaries.** Deliberately undecided; manual trigger
  now. Do not bake in an event name or transport (no `NewDataAvailable`,
  no `EntitiesChanged` as a firm event) until the transport is chosen.
- **Durable change-record shape** — the minimal record a completed Slice 1 run
  produces (source, ids, kinds); enough to lock the seam.
- **Source-definition file name and exact schema** — strawman only; to be pinned in
  the spec.
- **Registry storage at scale** — git-tracked YAML per source (recommended for
  auditability) vs. a table; revisit under Slice 4.
