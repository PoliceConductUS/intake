# Retrospective

## Evidence

Workspace audit: `/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy/audits/reconcile-production-20260927/`. See `report.md`, `final-validation.json`, root and federal independent reviews, reset/retry/continuation logs, and projection refresh log. This records the scoped correction, not full production parity.

## What worked

Exact source-ID and canonical-ID comparisons restored 16 missing production agencies without changing any retained identities or relationships. Existing canonical IO supported four cross-source mapping corrections without runtime changes. Full pre-reset capture, including geometry hashes and projections, made a precise comparison possible. All 181 source checks and 43 foreign-key checks passed.

## Misses

The first reset stopped on an external geocoder timeout; the exact retry and explicit continuation completed all remaining sources. Projection tables needed the existing separate refresh after intake. The first refresh launcher tried importing dotenv from intake, where it is not installed; native Node environment loading resolved the launcher error without dependencies or code changes. The audit initially inspected only one same-kind artifact chunk; the audit helper was corrected to aggregate all chunks before deriving expectations.

## Plan deviations

The user directed four same-agency mapping corrections instead of changing the late-source bootstrap gate. The gate remains unchanged; ICE and other unresolved omissions remain explicit findings. Refreshing the existing local projections completed the database audit; viewer implementation was not changed. A suspicious source date was reported without inventing a new date policy.

## Skill and workflow execution

OpenSpec apply, existing worktree isolation, subagent implementation and independent review, systematic debugging, and evidence-based completion checks were used. Scoped existing tests and concrete data assertions cover this data-only correction. The broader long-lived branch is not being merged, pushed, or removed by this task.

### Deliberately skipped steps

No new runtime unit tests or runtime implementation were needed: the actual changes are canonical workspace mapping/root data. Existing targeted tests passed, and independent canonical-IO assertions plus a complete database rebuild exercised the changed inputs. Full branch integration is outside this correction; preserve the existing worktree rather than treating all earlier branch work as part of this data task. Future work should apply integration tests when runtime behavior changes, not duplicate data assertions as mirrored code tests.

## Surprises

The federal source applies headquarters names, addresses, ZIP values and contact clearing while preserving canonical IDs/slugs and TCOLE status fields. FBI and Secret Service date-formatted raw Excel serial 1 becomes 1899-12-31 through the existing reader; that date's official meaning is unverified.

## Follow-up candidates

- [ ] Investigate the two suspicious status dates before representing them as verified official dates.
  - Destination: separate source-data decision.
  - Why: the raw cells do not establish genuine official status dates.
  - How: determine the source meaning, then approve and test any normalization rule explicitly.
- [ ] Resolve remaining production identities and source coverage only with supporting source evidence.
  - Destination: separate reconciliation work.
  - Why: 99 production-only routes remain with explicit dispositions, including intended exclusions and deferrals.
  - How: use the audit's per-route evidence rather than treating route count differences as uniform missing data.
