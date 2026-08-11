# Verify — Census Gazetteer Migration, Phase 1 (Runtime Evolutions)

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS
- [ ] ❌ FAIL

Phase 1 is complete on branch `migrate-census-gazetteer` (not merged). The runtime now has
the three capabilities the gazetteer needs, each reviewed and approved; the whole-branch
review (top-tier model) returned "Ready to finish Phase 1 on branch" with no Critical/Important
findings. The only warnings are environmental (a pre-existing unrelated test-suite failure) and
deferred design notes for Phase 2. Working tree clean; typecheck clean; 226 tests pass.

Phase-1 code commits: `2df3ce8..447b826` (7 task/fix commits + formatting). Base: `1fcaa73`.

## Requirement coverage (plan Phase 1)

- **Parse helpers — met.** `parseDelimited` (pure, header-keyed), `zip` (yauzl, sole importer,
  fd-close on error), `geo` (`shapefile`, sole importer; `readShapefile` async-iterable +
  `readGeoJson`). Each deterministic + fixture-tested.
- **Injected persistent `state` — met.** `sourceStateDir` reuses `command-directory.intakeWorkspace`
  (DRY), returns `…/intake/state/sources/<id>/`, wired into `RunDeps`.
- **Streaming `emit` sink — met.** Writes each geometry per-record via the singular
  `LocationPathGeometry.write` (bounded memory), flushes a `LocationPathGeometries` envelope-of-refs,
  and splices it into the `Artifacts` envelope beside inline bounded kinds. `runSource` restructured
  (workspace-before-`run`). Integration test reads the envelope back via `Artifacts.read`.

## Checks

1. **Structural / typecheck:** `npx tsc --noEmit` clean.
2. **Tests:** `npm test` → **226 passed**; one pre-existing unrelated suite-load failure
   (`test/seed-display.test.ts`, missing local `supabase/seed.sql`) — not this branch's.
3. **Forbidden files untouched (verified):** `src/shared/io/Artifacts.ts`, `src/cli/import/`, and
   `scripts/generate-envelope-types.ts` are unmodified in `1fcaa73..HEAD`; working tree clean.
4. **Third-party isolation:** `yauzl` only in `parse/zip.ts`, `shapefile` only in `parse/geo.ts`;
   `@types/*` in devDependencies, runtime deps (`yauzl`, `shapefile`) in dependencies.
5. **Formatting:** all Phase-1 files Prettier-clean (the repo's `lint` doesn't run Prettier;
   formatted explicitly). Pre-existing unrelated format debt left untouched.
6. **Reviews:** every task task-reviewed + approved; Task 5 (centerpiece) and the whole branch
   reviewed on the top-tier model. Hardening applied post-review: duplicate-emit-key guard +
   idempotent `flush` (`37add7e`).

## Deferred to Phase 2/3 (recorded from reviews)

- **Parse helpers are direct modules, not `RunDeps` members.** Pure `parseDelimited` needs no
  injection, but `zip`/`geo` do real I/O — decide before Phase 2 whether the gazetteer `run()`
  should get them via `deps` (stubbable) or import them directly (fixture-tested). Design call.
- **`makeWorkspace` now runs before `run()`**, so a failing run leaves an empty command dir (and
  orphan per-record geometry files if `emit` ran before a throw). No output regression; consider
  cleanup-on-failure in Phase 2.
- **`state` has no real consumer yet** (AZ POST ignores it) — exercised for real in Phase 2.
- **Phase 2:** domain port (~2k LOC) into `sources/census-gazetteer/`, files-as-input, deleting
  plumbing + dead code. **Phase 3:** record-identical golden regression + full 50-state run.
- **Overrides** (`location-hierarchy-overrides`, unwired today) — decide in Phase 2/3.

## Follow-ups (non-blocking)

- `.records` directory-name convention is duplicated from the generated writer (commented;
  covered by the integration round-trip test) — would break silently if codegen changes it.
