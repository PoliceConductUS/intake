## Implementation plan

- [x] Add failing intake contract tests with synthetic data for complete and incomplete summaries.
- [x] Add schema migration and canonical summary validator; regenerate intake contracts against disposable DB.
- [x] Add failing website validation/render tests; implement loader gate and summary component.
- [x] Import private verified summary through existing intake correction and data chain commands.
- [ ] Run full repository validation, verify loopback page and redirects, and record exact combined commits.

- [x] Distinguish sourced missing-copy states from pending and failed processing; render an honest message and donation link.

## Acquisition integration

- [x] Verify PDF acquisition, hash checking, pagination and latest-complaint selection with synthetic fixtures.
- [x] Integrate structured AI analysis and persistent analysis cache into ordinary acquire, including cached docket discovery.
- [x] Verify transform consumes saved summaries offline and repeats deterministically.
- [x] Complete final validation and source review for acquisition integration.
- [x] Support hash-bound reviewed summaries and collect evidence before analysis.
- [x] Replay all 19 retained summaries through acquisition preparation and review registration with zero model calls.

## Source-bound unsummarized reviews

- [x] Add failing synthetic receipt replay and source-binding tests.
- [x] Implement explicit unsummarized receipt registration and paired acquisition replay.
- [x] Run focused tests, typecheck, and OpenSpec validation without real state registration.
