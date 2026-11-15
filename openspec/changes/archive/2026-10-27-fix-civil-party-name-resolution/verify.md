# Verification — October 4, 2026

## Fixed behavior

The filter regression first failed five observed Chief/Officer names, with four institution/placeholder cases passing. After collapsing whitespace and anchoring office as a word, all nine passed. Two added title-scoring regressions then failed until the scorer excluded Officer and Chief prefixes. Existing acceptance and ambiguity thresholds remain unchanged. Raw acquired names remain untouched.

All 341 tests across 56 affected source/transform/name files passed. The subsequent full intake suite passed all 1,258 tests across 134 files (93 seconds); evidence: `/tmp/pc-intake-name-all-tests.log`. Typecheck, build, and OpenSpec validation passed (38 items). Read-only replay used the actual shared resolver and current database with a no-write ledger adapter: Savell now has one accepted match, Officer Bryan Pham to Galveston's Bryan T Pham (personnel cm7a0bh1g2brbewvga442qbfm; assignment cm7a0bixi4ip3ewvgqyt46px4). Clark and Eldreth pass the corrected filter but still have no accepted roster match. No match thresholds were loosened and no records were imported.

Evidence: `/tmp/pc-name-filter-red.log`, `/tmp/pc-name-match-red.log`, `/tmp/pc-civil-names-green.log`, `/tmp/pc-seven-resolver-trace-fixed.json`, `/tmp/pc-seven-fixed-summary.json`, `/tmp/pc-intake-name-typecheck.log`, `/tmp/pc-intake-name-build.log`, `/tmp/pc-intake-name-openspec.log`.

## Zero docket provenance

The retained `intake-workspace/dev-copy/state/courtlistener/docket-cache.json` Houston entry contains CourtListener ID 73112445, Van Kirk v. Officer Hernandez, docket 4:26-cv-00000, with lastSearchedAt 2026-08-22T19:02:58.902Z. It appears in both the August 25 and September 28 acquisition output. The September acquisition log reports 3194 cached agency results and six fresh searches; Houston's entry was reused. Acquisition copies docketNumber/docket_number from the API response into the cache and copies cached dockets into output without synthesizing a docket number. No zero-docket generation was found in that source's code/history.

The same CourtListener ID and zero docket are currently displayed at https://docketnexus.com/case/van-kirk-v-officer-hernandez-73112445/. This independently corroborates the bad value outside our pipeline, but is not proof of the historical raw API response. The direct CourtListener page returned 403 and its API returned 401; the current intake environment has no CourtListener API token. No preserved raw API response was located to prove who originally introduced the zero value. Do not describe it as a verified distinct case or an authoritative docket number. No docket correction was guessed or applied.

No database, source workspace, production build, or deployment mutations occurred.

## Initial matching follow-up

The user explicitly requested likely matching from initials rather than requiring full names. Nine regressions failed before implementation; 351 scoped tests then passed. Compatible first/middle initials receive a 0.9 similarity score (an algorithm score, not a statistical probability). The existing acceptance threshold is 0.85. Conflicting supplied middle names disqualify a candidate; unavailable middle parts increase uncertainty. Initial-led names now pass the source filter.

Fresh read-only replay against the current database resolves Eldreth's B. M. Bullin to Houston PD's Blake M. Bullin and C. C. Flores to Houston PD's Christian C. Flores. Savell's Bryan Pham match remains. The same replay also resolves C. C. Flores to Claudia Flores at Houston Emergency Center, where the middle name is absent: the acquired case occurs under that separate agency as well. This extra candidate is explicitly reported; no records or links have been imported. Evidence: `/tmp/pc-seven-initials-trace.json` and `/tmp/pc-seven-initials-summary.json`.

Clark's literal acquired name is `Chief  Mike Gudgel`, surname Gudgel (not Gudel). Its roster candidate is Michael A. Gudgel at Denison PD. Nickname and acquisition-scope behavior were not changed in this initials follow-up.

Final initials verification: all 1,268 tests in 134 files passed; typecheck, build, and all 38 OpenSpec validation items passed. Evidence: `/tmp/pc-initials-all-tests.log`, `/tmp/pc-initials-typecheck.log`, `/tmp/pc-initials-build.log`, `/tmp/pc-initials-openspec.log`. No acquired data or database records were changed.

## October 5 authorized rerun and update

Reran CourtListener transform using dev-copy acquired inputs. Output: 551 cases, 1,303 case-personnel links, 551 source links. Recovered Eldreth and Savell's exact prior IDs through the canonical identity ledger and preserved published slugs through the shared cache correction CLI. Receipt: `intake-workspace/dev-copy/audits/civil-name-rerun-20261005/identity-receipt.json`.

Generated and applied entry 000009: 105 CivilCaseCreate, 305 CivilCasePersonnelCreate, 105 CivilCaseLinkCreate; no updates or deletes. Database now has 570 cases; the additive pipeline retains prior cases absent from the current transform. Verified restored case IDs/slugs and four personnel links, including the disclosed Claudia Flores match. Receipt: `audits/civil-name-rerun-20261005/database-verification.json`. All applied entries verify; repeat generation returned empty diff. Website projections refreshed. No production build or deployment.

After restarting the local Astro server to refresh its enumerated routes, Eldreth and Savell each returned HTTP 200 at their canonical /civil-cases/{slug}/ paths. Rendered HTML includes the expected docket numbers and linked personnel. The initial stale-server 404s were resolved without route-code changes.

## Commit and preview delivery checks — October 5

Fresh aggregate validation passed formatting and typecheck, then the full test run encountered database-container hook timeouts and dependent fixture collisions: 127 files passed, seven failed. All seven affected files passed unchanged when rerun with one worker (23 tests). No assertions or timeouts were changed. Build and all 38 OpenSpec checks passed separately. Evidence: `/tmp/pc-intake-deploy-validate.log`, `/tmp/pc-intake-deploy-retry.log`, `/tmp/pc-intake-deploy-build.log`, `/tmp/pc-intake-deploy-openspec.log`.
