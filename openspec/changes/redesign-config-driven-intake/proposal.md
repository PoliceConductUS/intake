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
- To: add a single declarative transform-config file under `sources/<id>/`; the
  shared runtime does `raw → Artifacts` and hands off to the existing pipeline.
- Reason: collapse per-source cost to data so onboarding fits in an hour at scale.
- Impact: non-breaking; existing `import artifacts` / `replay` commands are unchanged.

**New `intake run` command**
- Add `intake run <source-id> <snapshot-ref> [--dry-run]` (auto-discovered under
  `src/cli/run/`). It loads `sources/<source-id>/source.yaml`, parses the snapshot,
  emits a typed `Artifacts` envelope keyed by source-local identity, and calls the
  existing `runImportArtifactsCommand`. `--dry-run` mirrors the existing flag.

**Snapshot parsing (new capability axis)**
- Add deterministic xlsx snapshot parsing. No raw-file parsing exists in the repo
  today; all current I/O is typed YAML envelopes.

**First source**
- Add `sources/gov.azpost.roster/` declaring `Personnel` records keyed by POST ID,
  mapping only currently-supported `PersonnelSpec` fields; `reconcile: additive`.

**Explicitly reused unchanged**: the `Artifacts` envelope contract,
`SourceNameToCanonicalId` cuid2 assignment/persistence, `DatabaseMutations` planning +
apply, and the command-directory audit trail. Slice 1 adds **no** new envelope kind,
no new durable change type (the existing `DatabaseMutations` envelope is the change
record), and no database schema/migration change.

## Capabilities

### New Capabilities

- `config-driven-source-import`: Generate a typed `Artifacts` envelope from a saved
  source snapshot using a declarative per-source transform config, then import it via
  the existing pipeline. Covers the `intake run` command, the source-config schema,
  deterministic snapshot parsing (xlsx), config-declared field mapping, source-local
  identity keying, kind-agnostic and additive emission, and reuse of the existing
  import/mutation machinery.

### Modified Capabilities

- None. `artifacts-database-import` is reused as-is; no existing requirement changes.

## Impact

- **New code**: `src/cli/run/` (command), a source-config loader/validator, a
  deterministic xlsx snapshot reader, and an `Artifacts`-envelope builder.
- **New dependency**: an xlsx reader (or a minimal hand-rolled reader) — decided in
  design/plan.
- **New data**: `sources/gov.azpost.roster/source.yaml`.
- **Reused unchanged**: `import artifacts` pipeline, `SourceNameToCanonicalId`,
  `DatabaseMutations`, command directory. Env unchanged: `INTAKE_WORKSPACE`,
  `DATABASE_URL` (same as `import artifacts` today).
- **No** database migration, seed change, or generated-type change.
- **Out of scope** (later slices): acquisition (connectors, scraping, FOIA
  request/response, schedules), any event transport, AI resolution + corrections,
  regenerate/notify, many-source scheduling, sibling-repo migration.
