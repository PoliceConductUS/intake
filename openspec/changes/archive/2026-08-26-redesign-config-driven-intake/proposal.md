## Why

Every intake source today is a separate git repository (2.5k–7.8k LOC) that
re-implements ~90% identical contract plumbing; the source-specific slice (fetch +
field mapping) is small. Onboarding is the wall, and the backlog (Tempe, AZ POST)
never got past raw files. The project needs a new source to be **data added in ≤1
hour**, not a new repo. This change starts that redesign with the smallest real
vertical: a config-driven front-door command that turns a saved source snapshot into
a typed `Artifacts` envelope and reuses the existing, proven import pipeline —
proven end-to-end on the AZ POST officer roster.

## What Changes

**Onboarding a source**

- From: author a bespoke producer repo that hand-writes `raw → Artifacts` and all
  contract plumbing.
- To: add a small `sources/<id>/config.ts` module that exports a `run(input, ctx)`
  function emitting records; the shared runtime owns all plumbing (`Artifacts`
  envelope build, identity, import, change record) and hands off to the existing
  pipeline.
- Reason: collapse per-source cost to the irreducible source-specific code (read +
  emit), deleting the duplicated plumbing, so onboarding fits in an hour at scale.
- Impact: non-breaking; existing `import artifacts` / `replay` commands are unchanged.

**New `intake run` command**

- Add `intake run <source-id> <path...> [--dry-run]` (auto-discovered under
  `src/cli/run/`). It loads `sources/<source-id>/config.ts`, invokes its `run` with
  injected dependencies, takes the `Artifacts` manifest `run` returns, and calls the
  existing `runImportArtifactsCommand`. `--dry-run` mirrors the existing flag.

**Source module contract (returns a manifest; DI, no service locator)**

- A source is a `config.ts` exporting a deterministic `run` that reads the CLI paths and
  **returns** an `Artifacts` manifest of the records it generated — it does not emit via a
  callback and does not stream. Its dependencies are **injected** as narrow, typed
  parameters by the `intake run` command (the composition root), mirroring how
  `importArtifacts` receives injected adapters — no service-locator context, no
  intake-owned DB/mapping/mutation handles. The exact injected surface is deferred.

**Snapshot parsing (new capability axis)**

- Add deterministic xlsx parsing as an injected parse capability. No raw-file parsing
  exists in the repo today; all current I/O is typed YAML envelopes.

**First source**

- Add `sources/gov.azpost.roster/config.ts` whose `run` returns `Personnel` records keyed
  by POST ID, mapping only currently-supported `PersonnelSpec` fields; additive.

**Explicitly reused unchanged**: the `Artifacts` envelope contract,
`SourceNameToCanonicalId` cuid2 assignment/persistence, `DatabaseMutations` planning +
apply, and the command-directory audit trail. Slice 1 adds **no** new envelope kind,
no new durable change type (the existing `DatabaseMutations` envelope is the change
record), and no database schema/migration change.

## Capabilities

### New Capabilities

- `config-driven-source-import`: Generate a typed `Artifacts` manifest from a saved source
  snapshot using a per-source `config.ts` module, then import it via the existing pipeline.
  Covers the `intake run` command, the `run`-returns-a-manifest source-module contract,
  dependency injection of the module's narrow capabilities (no service-locator context),
  deterministic snapshot parsing (xlsx), source-local identity keying, kind-agnostic and
  additive records, and reuse of the existing import/mutation machinery.

### Modified Capabilities

- None. `artifacts-database-import` is reused as-is; no existing requirement changes.

## Impact

- **New code**: `src/cli/run/` (command + composition root that injects deps), a
  source-module loader, the glue that imports the returned manifest, and a deterministic
  xlsx parse capability.
- **New dependency**: an xlsx reader (or a minimal hand-rolled reader) — decided in
  design/plan.
- **New source module**: `sources/gov.azpost.roster/config.ts`.
- **Reused unchanged**: `import artifacts` pipeline, `SourceNameToCanonicalId`,
  `DatabaseMutations`, command directory. Env unchanged: `INTAKE_WORKSPACE`,
  `DATABASE_URL` (same as `import artifacts` today).
- **No** database migration, seed change, or generated-type change.
- **Out of scope** (later slices): acquisition (connectors, scraping, FOIA
  request/response, schedules), any event transport, AI resolution + corrections,
  regenerate/notify, many-source scheduling, sibling-repo migration.
