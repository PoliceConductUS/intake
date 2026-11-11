# Tasks

> **Blocked on a live database.** ADR 0025 requires every persisted model to come
> from `npm run generate:envelope-types`, which introspects a running Postgres.
> Tasks 2–4 cannot be started on a host without Docker (`supabase start`). The
> corpus is closed, so there is no deadline pressure — but the sequence is fixed:
> migration → regenerate → transform.

## 1. Change artifacts

- [x] 1.1 `proposal.md` — why, what changes, affected migrations/contracts,
      out-of-scope.
- [x] 1.2 `design.md` — verified corpus facts, D1–D8, risks.
- [x] 1.3 `specs/wapo-fatal-force-import/spec.md` — ADDED requirements.
- [x] 1.4 `npm run openspec:validate` passes.

## 2. Schema (requires a live database)

- [ ] 2.1 Additive migration creating `public.fatal_shooting` and
      `public.fatal_shooting_agency`. Explicit checked-in IDs are **not** needed:
      no seed rows are created and no migration row is referenced elsewhere, so
      this change adds **no post-seed integrity assertions**.
- [ ] 2.2 `fatal_shooting_agency.agency_id` nullable, FK to `public.agency`;
      `oricodes` stored as source-reported text (D3).
- [ ] 2.3 `npm run generate:envelope-types` to produce `FatalShootings` and
      `FatalShootingAgencies` models (ADR 0025 — no hand-written row types).
- [ ] 2.4 `npm run supabase:reset` to confirm the migration applies from scratch.
- [ ] 2.5 `npm run lint:sql` clean for the new migration.

## 3. Source module

- [ ] 3.1 `sources/org.washingtonpost.fatal-force/acquire.ts` — download both v2
      CSVs pinned to an explicit upstream **commit SHA**; preserve original bytes
      plus `sourceUrl`, `commit`, `sha256`, `byteLength`, `retrievedAt` (D5).
- [ ] 3.2 Re-acquire against an unchanged pin does not re-download and does not
      rewrite preserved evidence.
- [ ] 3.3 `transform.ts` — deterministic from saved inputs only; declares
      `produces: ["FatalShootings", "FatalShootingAgencies"]`.
- [ ] 3.4 Source-local record names are the upstream `id` values (D2); the module
      mints no canonical IDs.
- [ ] 3.5 `redistribution_class: noncommercial_sharealike` recorded on the source.

## 4. Verification

- [ ] 4.1 Transform unit tests over **synthetic** fixtures. `intake` is a public
      repository — no real decedent name, and no row of the real corpus, may be
      committed as a fixture.
- [ ] 4.2 Assert the closed-corpus invariant: a second transform of the same pin
      produces a byte-identical manifest, and `intake data generate` yields an
      empty diff **after comparison**, not a skip (D6).
- [ ] 4.3 Assert `agency_id` is null for every agency that does not resolve, and
      that no agency row is created by this source (D4).
- [ ] 4.4 Assert the full-corpus annual counts match the published figures:
      995 / 959 / 984 / 992 / 993 / 1021 / 1050 / 1097 / 1164 / 1175 for
      2015–2024, total 10,430.
- [ ] 4.5 `npm run validate`.

## 5. Out of scope — do not let these drift in

- No canonical `agency.ori` column.
- No agency creation from this source.
- No decedent-level record on any public page.
