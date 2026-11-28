# Tasks

Verified on 2026-11-14 using an isolated local Docker PostGIS database. Models
were generated from the live schema before the transform was implemented. Raw
inputs and mutation state are outside Git.

## 1. Change artifacts

- [x] 1.1 `proposal.md` — why, what changes, affected migrations/contracts,
      out-of-scope.
- [x] 1.2 `design.md` — verified corpus facts, D1–D8, risks.
- [x] 1.3 `specs/wapo-fatal-force-import/spec.md` — ADDED requirements.
- [x] 1.4 `npm run openspec:validate` passes.

## 2. Schema (requires a live database)

- [x] 2.1 Additive migration creating `public.fatal_shooting` and
      `public.fatal_shooting_agency`. Explicit checked-in IDs are **not** needed:
      no seed rows are created and no migration row is referenced elsewhere, so
      this change adds **no post-seed integrity assertions**.
- [x] 2.2 `fatal_shooting_agency.agency_id` nullable, FK to `public.agency`;
      `oricodes` stored as source-reported text (D3).
- [x] 2.3 `npm run generate:envelope-types` to produce `FatalShootings` and
      `FatalShootingAgencies` models (ADR 0025 — no hand-written row types).
- [x] 2.4 Confirm migrations apply from scratch through the Docker integration reset
      path, including the repository data-reset tests. No existing dev corpus
      was reset and no seed rows were added.
- [x] 2.5 `npm run lint:sql` clean for the new migration.

## 3. Source module

- [x] 3.1 `sources/org/washingtonpost/fatal-force/acquire.ts` — download both v2
      CSVs pinned to an explicit upstream **commit SHA**; preserve original bytes
      plus `sourceUrl`, `commit`, `sha256`, `byteLength`, `retrievedAt` (D5).
- [x] 3.2 Re-acquire against an unchanged pin does not re-download and does not
      rewrite preserved evidence.
- [x] 3.3 `transform.ts` — deterministic from saved inputs only; declares
      `produces: ["FatalShootings", "FatalShootingAgencies"]`.
- [x] 3.4 Source-local record names are the upstream `id` values (D2); the module
      mints no canonical IDs.
- [x] 3.5 `redistribution_class: noncommercial_sharealike` recorded on the source.

## 4. Verification

- [x] 4.1 Transform unit tests over **synthetic** fixtures. `intake` is a public
      repository — no real decedent name, and no row of the real corpus, may be
      committed as a fixture.
- [x] 4.2 Assert the closed-corpus invariant: a second transform of the same pin
      produces a byte-identical manifest, and `intake data generate` yields an
      empty diff **after comparison**, not a skip (D6).
- [x] 4.3 Assert `agency_id` is null for every agency that does not resolve, and
      that no agency row is created by this source (D4).
- [x] 4.4 Assert the full-corpus annual counts match the published figures:
      995 / 959 / 984 / 992 / 993 / 1021 / 1050 / 1097 / 1164 / 1175 for
      2015–2024, total 10,430.
- [x] 4.5 `npm run validate`.

## 5. Out of scope — do not let these drift in

- No canonical `agency.ori` column.
- No agency creation from this source.
- No decedent-level record on any public page.

## Verification results

- `npm run validate`: 179 files / 1,886 tests passed; build, typecheck,
  formatting and OpenSpec (48/48) passed.
- Additional source pipeline integration: 1 test passed, including changed-pin
  update, stable canonical ID, unchanged reacquisition, empty diff and no-op up.
- Final diagnostic changes: 7 source unit tests and typecheck passed.
- SQLFluff 4.1.0: new migration clean.
- Full corpus: 14,157 recorded mutations applied, 10,430 incidents and 3,727
  reported agencies. Annual counts asserted against the existing chart.
- Full-corpus rerun: empty diff; repeat up: zero pending entries.
- One missing incident agency list and 13 inconsistent reported agency totals
  retained. Transform logs total discrepancies without rewriting source values.
- Existing PNG chart URL returns HTTP 200; no new public projection or export.
