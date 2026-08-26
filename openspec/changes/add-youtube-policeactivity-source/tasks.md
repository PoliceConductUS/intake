# Tasks

## 1. Source scaffold + acquire (per-agency channel search)

- [ ] 1.1 `sources/youtube.policeactivity/run.ts` exports `run`, `produces`
      (CoverageLinks, CoverageLinkAgencyPersonnel, CoverageLinkCivilCases),
      `description`.
- [ ] 1.2 Shared client `sources/lib/youtube.ts`: resolve `@PoliceActivity` →
      channel id; `search?channelId=…&q=…&type=video`; fetch captions (timedtext).
      `YOUTUBE_API_KEY` from env; add it to `.env.example`.
- [ ] 1.3 `acquire.ts`: page agencies via `data.agencies({ states, minOfficers })`;
      per agency, search the channel by name/place; store each hit's video +
      captions **stamped with the agency source id**; raw evidence under
      `sourceDir`.
- [ ] 1.4 Source-state records for deleted/private/unavailable/changed videos
      (fail-loud, visible). Idempotent by agency source id + videoId.

## 2. Run: resolve officers at the known agency + emit cited links

- [ ] 2.1 Officer-name candidate extraction from title+description+captions
      (library tokenizer; no hand-rolled parser).
- [ ] 2.2 Per video at its acquired agency, `resolvePersonnel({ agencyId,
    personnelName })`; docket → existing CivilCase (natural key). Emit
      CoverageLink + CoverageLinkAgencyPersonnel + CoverageLinkCivilCase for
      verified links only, each with the supporting passage in `notes`.
- [ ] 2.3 A video with no verified link emits no durable coverage record;
      `run()` is deterministic (no network/clock/randomness).

## 3. Tests + validation

- [ ] 3.1 Acquire tests (fixtures): per-agency search, agency-stamped results,
      caption provenance, source-state on unavailable/changed video, idempotent
      re-run.
- [ ] 3.2 Run tests (fixtures): supported officer/case link emitted with citation;
      unsupported / ambiguous mention → no link; determinism.
- [ ] 3.3 `npm run openspec:validate` and the narrow source tests pass.
