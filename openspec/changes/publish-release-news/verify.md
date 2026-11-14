# Release news verification

## Implementation under test

The website implementation is in commit `3cf5673` on `feat/publish-source-data-annotations`. The Intake implementation is on `chore/agent-guardrails`. Both used the existing project worktree. Two pre-existing local website files remain outside the implementation commit.

## Website

A clean install with Node 26.13.1 installed 511 packages. Every installed version matched the lockfile. The complete `npm run validate` command exited zero against an isolated copy of the local corpus with the Intake migration applied.

| Check                                       | Result                                                            |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Prettier, ESLint, SQLFluff and shell syntax | Passed                                                            |
| Astro type checks                           | 352 files, zero errors, warnings or hints                         |
| Database contract                           | 31 public tables passed                                           |
| OpenSpec                                    | 40 items passed                                                   |
| Personal-data scan                          | Zero findings, including a separate check of every changed file   |
| Node suites                                 | 358 tests passed, zero skips                                      |
| Playwright                                  | 216 tests passed, zero skips, including the served Pagefind index |
| Infrastructure                              | Terraform format and validation passed locally                    |

The setup check confirmed GitHub authentication and Docker availability. Its agent-workflow reminder was checked against the installed project workflow. Supabase CLI printed a newer-version notice while running the pinned project version.

## Intake

A clean install on Node 24.21.0 matched all 394 installed dependency versions to the lockfile. The isolated database ran the new migration. The focused SQLFluff check passed. The complete `npm run validate` command exited zero. Formatting, TypeScript, Vitest, compilation, generated-file reproducibility and OpenSpec all passed. All 1,970 tests in 195 files passed. OpenSpec validated 52 items. There were zero skipped tests.

## Discovery, publication and import rehearsal

- Actual Chromium navigated two search-results pages with fixture responses. The local source recorded an unavailable publisher, indexed supporting paragraphs and sent the extracted body to a local inference test endpoint. Ordinary Intake commands applied one article and two assignment links.
- The hosted discovery tests read paginated Search Console input, ignored generic landing pages, checked the free allowance and ten-new-URL boundary, and stopped on the first qualifying result. A cached hit required zero new URLs. A cited old original disqualified its current reprint.
- Two matched queries with 28 and 22 clicks produced one homepage story with 50 clicks. Tests covered the top-25 cutoff, shared stories across profiles, later ranking changes, missing position observations and the seven complete reporting days on either side of first visibility.
- A synthetic article with two officer-specific copies and one preferred original went through the standard Intake import. A second import generated no changes. Historical release and namespace cases exercised persistent article and relationship identities.
- Four actual Astro pages were compared with the publisher's output using the release roster and saved page data. Each profile displayed its supported copy. The agency displayed the article once and the homepage used the preferred source. IDs, dates, titles, summaries and order matched. The personnel-disabled build retained both assignment labels without links to absent profiles.
- Publisher, forms and routing tests exercised complete regeneration, escaped HTML, overlapping writes, a fresh runner after partial publication, cache refresh, old forms and separate preview releases. Private fixture body text and assignment notes were absent from rendered output.
- The workflow specifies 7 a.m. in `America/Chicago`. Local timezone checks covered both clock changes. Provider responses, inference and AWS operations used test services or fixtures.

## Rollout and archive

Task 4.2 remains open. At the authorized website rollout, verify the full release and sitemap, check the snapshot against the selected production release, test both public hosts for private-data denial, and confirm that CloudFront refreshes previously cached pages. Enable the Intake schedule after these checks. Local tests do not exercise actual publisher access, production credentials, IAM or CloudFront propagation.

The release-page-updates delta remains in the active change pending rollout. The implementation has local validation evidence. No remote CI run or production deployment was requested or performed.
