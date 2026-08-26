# Tasks — Slice 1: config-driven source run (AZ POST tracer)

Scope: `intake run <source-id> <path...>` invokes `sources/<id>/config.ts`'s `run`,
which returns an `Artifacts` manifest; the command imports it via the existing pipeline.
First source: `gov.azpost.roster` → `Personnel` only, keyed by POST ID, additive.
No new envelope kind, durable change type, DB migration, or event transport.

## 1. Injected xlsx parse capability (`readXlsx`)

- [x] 1.1 Decide + wire the xlsx reader behind a single `readXlsx(path)` adapter (returns
      `Array<Record<string,string>>` from sheet 1, keyed by the header row; deterministic).
      Reader lib choice (exceljs vs SheetJS vs minimal hand-rolled) is isolated to this
      one adapter — the source module never imports it. **Confirm dep choice.**
- [x] 1.2 Unit tests for `readXlsx` against a small AZ POST fixture workbook: correct
      headers (`AGENCY`, `POST ID`, `LAST`, `FIRST`, `MIDDLE`, …), row values, and
      deterministic output on repeat reads.

## 2. Run contract + manifest → Artifacts builder

- [x] 2.1 Define the `run` contract types: injected `RunDeps` (paths + `readXlsx`; surface
      kept minimal, no service-locator context) and the returned `Manifest`
      (kinds + records keyed by source-local id).
- [x] 2.2 Implement the manifest → inline `Artifacts` envelope builder (namespace = source
      id; name = source id + snapshot digest; records inline). Unit-test it produces a
      valid `Artifacts` envelope for a Personnel manifest and rejects an invalid record
      via the existing envelope schema.

## 3. `intake run` command (composition root)

- [x] 3.1 Add `src/cli/run/index.ts` exporting `registerCliCommand` for
      `intake run <source-id> <path...> [--dry-run]` (auto-discovered under `src/cli/`);
      validate required args; unknown source id / missing `config.ts` fails before any DB
      read or write.
- [x] 3.2 Composition root: load `sources/<id>/config.ts`, fail early if it does not export
      `run`, construct the injected deps (`readXlsx`), invoke `run(deps)`, get the manifest.
- [x] 3.3 Build the `Artifacts` envelope from the returned manifest and hand it to the
      existing `runImportArtifactsCommand`; pass `--dry-run` through unchanged.
- [x] 3.4 Command-level tests: happy path, multiple paths, `--dry-run`, arg validation,
      unknown source id, missing `run` export.

## 4. AZ POST source module

- [x] 4.1 Add `sources/gov.azpost.roster/config.ts`: `run` reads each path via injected
      `readXlsx`, skips rows without a `POST ID`, dedups by `POST ID`, and returns
      `Personnel` records (`id` = POST ID, `first_name` = FIRST, `last_name` = LAST,
      `middle_name` = MIDDLE or null).
- [x] 4.2 Unit-test `run` with a fake `readXlsx`: asserts the returned Personnel manifest,
      the POST-ID filter, dedup of repeated POST IDs, and determinism on repeat.

## 5. End-to-end + verification

- [x] 5.1 Integration test: `intake run gov.azpost.roster <fixture.xlsx> --dry-run`
      produces a `DatabaseMutations` envelope with the expected `Personnel` creates (small
      fixture; Personnel-only ⇒ dry-run needs no live DB).
- [x] 5.2 Idempotency test: re-running the same snapshot is stopped by the existing-import
      guard rather than creating conflicting rows.
- [x] 5.3 `npm run validate` green (format, lint/typecheck, vitest, build, openspec).
- [x] 5.4 Doc note: add `intake run` to README command vocabulary and a one-line source
      authoring pointer (no `AGENTS.md` behavior change).

## Deferred (not Slice 1) — recorded so they aren't lost

- Agencies + AgencyPersonnel from AZ POST (AGENCY + APPOINTED/TERMINATED columns) — data
  supports it; next increment.
- Exact injected-dep surface beyond `readXlsx`; workspace/state injection when a source
  needs it; inline-vs-file manifest form (inline chosen for Slice 1).
- Acquisition, transport/events, AI resolution, corrections, regenerate/notify,
  scheduling/scale, Temporal orchestration.
