# Tasks

## 1. Run capability: resolveAgency (match-only)

- [ ] 1.1 Add `resolveAgency({ name, state? }) → { agencyId } | null` to
      `RunDataContext` (`src/cli/run/source-run.ts`); never mints, returns a
      namespace-local source id or null.
- [ ] 1.2 Implement it in the run data context over the existing fuzzy agency
      matcher, gated to null below a confidence threshold. Unit test: exact hit,
      fuzzy hit, below-threshold → null, unknown → null.

## 2. Source scaffold + acquire

- [ ] 2.1 `sources/youtube.policeactivity/run.ts` exports `run`, `produces`
      (CoverageLinks, CoverageLinkAgencyPersonnel, CoverageLinkCivilCases),
      `description`.
- [ ] 2.2 `acquire.ts`: resolve `@PoliceActivity` → channel id; page uploads;
      store per-video metadata + captions as raw evidence under `sourceDir`;
      `YOUTUBE_API_KEY` from env; add it to `.env.example`.
- [ ] 2.3 Source-state records for deleted/private/unavailable/changed videos
      (fail-loud, visible). Idempotent by videoId.

## 3. Run: resolve + emit cited links

- [ ] 3.1 Agency/officer/case candidate extraction from title+description+captions
      (library tokenizer; no hand-rolled parser).
- [ ] 3.2 Resolve agency → officer → case against existing records; emit
      CoverageLink + CoverageLinkAgencyPersonnel + CoverageLinkCivilCase for
      verified links only, each with the supporting passage in `notes`.
- [ ] 3.3 A video with no verified link emits no durable coverage record;
      `run()` is deterministic (no network/clock/randomness).

## 4. Tests + validation

- [ ] 4.1 Acquire tests (fixtures): pagination, stable ids, caption provenance,
      source-state on unavailable/changed video, idempotent re-run.
- [ ] 4.2 Run tests (fixtures): supported link emitted with citation; unsupported
      / ambiguous mention → no link; determinism.
- [ ] 4.3 `npm run openspec:validate` and the narrow source tests pass.
