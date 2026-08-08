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
Adding a *source* becomes a registry folder. Adding a new *connector type* or
*record kind* is a rare shared-code change every later source reuses for free.

Intake is one stage in a longer cycle. The full cycle is:

```
REQUEST → ACQUIRE(sync|async) → SAVE(evidence) → TRANSFORM(map+resolve)
        → LOAD(additive mutations) → [emit EntitiesChanged] ⇒ REGENERATE ⇒ NOTIFY
```

This system owns **REQUEST → LOAD** and terminates by emitting a durable,
replayable `EntitiesChanged` event. REGENERATE (rebuild impacted site pages) and
NOTIFY (subscribers of changed pages) are **external subscribers in other repos**
(`policeconduct.org`, `section1983.org`), connected only by that event contract.
Intake never imports website code.

The existing envelope / idempotency / replay / `SourceName→ID` / `ResolvedProperty`
core (ADRs 0001–0014) is **preserved, not replaced.** The redesign sits *above* it:
it turns per-source code into per-source config, and adds the request lifecycle and
the terminating event.

## Alternatives Considered

### Approach A: Config registry + one shared runtime (sources are data) — CHOSEN

- **Approach**: Source definitions live as data (`sources/<id>/source.yaml`) inside
  the intake repo. One shared runtime interprets them: connectors fetch, a field-map
  layer produces typed records, the existing ledger resolves canonical IDs, the
  existing planner produces additive `DatabaseMutations`. Custom deterministic parse
  is a rare per-source `parse.ts` escape hatch, not the norm.
- **Pros**: Data-only onboarding meets the ≤1-hour goal; central scheduling of all
  sources; contract plumbing written/tested once; the 90% duplication disappears;
  the existing deterministic core is reused unchanged.
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
  drift) — realistically exceeds the 1-hour target; no central scheduling surface;
  onboarding is still "code," not "data."
- **Why not selected**: Keeps the per-repo ceremony that is the actual bottleneck at
  10k-source scale.

### Approach C: Keep status-quo (one hand-written producer repo per source)

- **Approach**: Continue building a bespoke producer module per source.
- **Pros**: Maximum per-source flexibility; no new runtime to build.
- **Cons**: ~2.5k–7.8k LOC of duplicated plumbing per source; does not scale to tens
  of thousands of sources; the backlog already proves the wall.
- **Why not selected**: This is exactly the model being replaced.

## Agreed Approach

Approach A. Build one shared runtime + a data-only source registry, delivered in
slices. The existing deterministic import/replay core is reused; the redesign adds
config-driven connectors above it, the request lifecycle in front of it, and a
terminating `EntitiesChanged` event behind it.

Deliver in 7 slices, tracer first:

| Slice | Deliverable |
|---|---|
| **1 — Vertical tracer (AZ POST)** | Manual acquire (drop xlsx) → save → transform (POST ID identity + field map) → additive load through the existing ledger → emit a thin `EntitiesChanged` event. Proves data-only onboarding + the SAVE→TRANSFORM→LOAD spine on a real source. |
| 2 — Acquire strategies | `scrape` (selectors/pagination) + `socrata`/`arcgis`/`http`/`download` auto-pull. |
| 3 — Request lifecycle | Async requests + email-token correlation (automated FOIA: issue request, correlate the async response back to the request that asked for it). |
| 4 — Resolution & corrections | AI-assisted matching as a *cached* resolver strategy + `MappingCorrection` envelope ingestion with pin precedence. |
| 5 — Regenerate | External subscriber rebuilds impacted pages from `EntitiesChanged`. |
| 6 — Notify | External subscriber notifies subscribers of changed pages. |
| 7 — Scale + migrate | 10k-source scheduling + change detection; collapse the sibling repos onto the runtime and delete duplicated plumbing. |

Only Slice 1 is specified now; slices 2–7 are the roadmap.

## Key Decisions

- **Deterministic extraction.** No AI in parse. Structured feeds and HTML scrapes
  both reduce to config. Re-importing the same snapshot yields identical
  `DatabaseMutations`.
- **Additive load.** A record disappearing from a source is a no-op; data only
  accrues. No hard deletes or soft-deactivation on disappearance. (`reconcile: additive`.)
- **AI lives only in resolution, as a cached decision.** Matching source-local names
  onto canonical state → county → place → agency → officer may use AI, but the
  *decision* is persisted to the intake-owned mapping ledger with provenance
  (model, confidence, evidence). Replay reads the frozen mapping and never re-runs a
  model, preserving ADR 0014's deterministic/cacheable-resolver invariant.
- **Corrections are pins that outrank AI.** A visitor correction arrives as an
  already-reviewed `MappingCorrection` envelope; intake pins it on sight (no in-intake
  review UI). Pinned mappings survive reset/replay and can never be overwritten by an
  AI suggestion.
- **System boundary is LOAD + emit event.** Intake owns REQUEST→LOAD and emits a
  durable `EntitiesChanged` event. REGENERATE and NOTIFY are external subscribers.
- **Delivery is a request/response lifecycle, not a static class.** Acquire may be
  synchronous (API/download/scrape) or asynchronous (FOIA email/webform whose reply
  arrives later and must be correlated to its originating request via a routing
  token). The manual xlsx drop in Slice 1 is the stepping stone to automated
  request/response in Slice 3.
- **Identity comes from the source when it has a stable ID.** AZ POST has a stable
  **POST ID**, so `identity: { from: [post_id] }`. Sources without a stable ID must
  declare a documented deterministic derivation with `on_collision: fail`.
- **Source-definition surface (strawman, not final):** `id`, `schedule`/cadence,
  `delivery`, `connector` (type + config), `records` (`kind`, `identity`, `map`,
  `links.resolve`), `resolution` strategies, `reconcile: additive`, `provenance`.
  The exact file name/shape is intentionally not locked yet.

## Open Questions

- **AZ POST rank + misconduct flag → schema.** The roster carries a Level/rank and a
  Misconduct flag (`YES`/`NO`/`Other-Unknown`). Whether these map onto existing
  `Personnel`/`AgencyPersonnel` columns, require a new record kind, or defer to a
  fast-follow will be settled while writing the Slice 1 spec by reading the actual
  record schema. Preference: keep the tracer thin.
- **Source-definition file name and exact schema** — strawman only; to be pinned in
  the spec.
- **`EntitiesChanged` event contract shape** — the minimal terminating payload for
  Slice 1 (enough to lock the seam; full contract designed alongside slices 5–6).
- **Registry storage at scale** — git-tracked YAML folders per source (recommended
  for auditability) vs. a table; revisit under Slice 7.
