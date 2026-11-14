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

## Publisher URL aliases

The release importer read three chained publisher URL keys under `CoverageLink` and ignored an unrelated `AgencyPersonnel` mapping with the same source key. All three forward ledger entries pointed to the same canonical ID. The first import applied the article, its two assignments, its reporting window and its 50-click homepage placement. Importing a single-copy release and importing the first release again both produced empty diffs. Four rebuilt Astro pages matched Daily’s output. Importing the ordinary build preserved the IDs of older records and the new article. Its first import recorded source-field provenance, and repeating it produced an empty diff.

The discovery tests cover saving typed aliases during a concurrent write, choosing the first qualifying URL, retaining relationship IDs, resolving a matched URL across releases and displaying the source ID belonging to the selected copy. The import regressions cover historical and repeated imports, alias chains, conflicting canonical IDs, source namespace and record-kind isolation, and long or case-sensitive URLs. A PostgreSQL integration test exercises the normal transform, generate and apply steps against an existing article.

A clean install on Node 24.21.0 matched all 394 installed package versions to the lockfile. The cross-repository comparison used the existing website worktree and an isolated local database. No remote service or production release was used.

### Files changed for publisher URL aliases

- `design.md`, `proposal.md`, `plan.md`, `specs/release-page-updates/spec.md`, `tasks.md` and this `verify.md` in the change directory define and verify the typed alias contract.
- `sources/google.news/aliases.ts`, `daily.ts` and `publication.ts` in that directory handle private alias persistence, discovery state, ranking and displayed source IDs.
- `sources/lib/news.ts` and `src/shared/release-news.ts` carry the source pair on occurrences and expose the import grouping operation.
- `sources/org.policeconduct.release-news/acquire.ts`, `transform.ts` and `article-sources.ts` in that directory read the private file, group confirmed URLs and resolve page and ranking references.
- `sources/lib/news-import.ts` and `src/cli/transform/news-import-context.ts` resolve existing articles, merge occurrences and register source mappings during import.
- `CanonicalIdToSourceName.ts`, `SourceNameToCanonicalId.ts`, `index.ts`, `restore.ts` and `ledger-record-path.ts` under `src/cli/state/source-name-to-canonical-id/` support long and case-sensitive URL keys in forward and reverse lookups and restoration.
- `aliases.test.ts`, `daily.test.ts`, `import.test.ts`, `import-aliases.test.ts`, `publication.test.ts` and `rerank.test.ts` under `test/sources/news/` exercise discovery, publication, import and ranking with typed aliases.
- `test/cli/data/release-news-aliases.integration.test.ts` verifies permanent import and reimport through PostgreSQL.

## Local agency and officer acquisition

The full local run started in visible installed Google Chrome on November 14, 2026. The private checkpoint held the first agency and 5,391 officer queries before its first Google verification challenge. The run waits for the operator in that tab. Startup was verified independently from completion of the sweep. Before launch, the configured local Ollama model returned a summary and correctly identified a fictional officer and supporting paragraph through the Intake inference client.

- `sources/org.policeconduct.local-news/sweep.ts` and `acquire.ts` in the same directory implement the nested search order, checkpoints, local inference settings and Chrome lifecycle.
- `sources/org.policeconduct.local-news/browser.ts` handles past-week queries, the operator verification wait, publisher URLs and pagination in the same search session.
- `src/cli/acquire/acquire-data-context.ts` and `src/cli/transform/source-transform.ts` expose the officer roster for an exact source agency and look up article assignment candidates.
- `sources/lib/news.ts` uses the article’s extracted text to request matching assignment IDs for local inference.
- `test/sources/news/local.test.ts`, `test/sources/news/local-browser.test.ts` and `test/cli/acquire/acquire-data-context.test.ts` cover query order, agency-only searches, resume, verification, and evidence across agencies.
- `README.md` documents the local command and inference settings. The change’s `proposal.md`, `design.md`, `plan.md`, `specs/release-page-updates/spec.md`, `tasks.md` and this `verify.md` describe the behavior and the checks.

The first live verification exposed ten news cards with opaque Google redirect links. The corrected reader recognized all ten cards and the next-page link from the captured results. The restarted acquisition reused the verified private Chrome profile, reached publisher pages and checkpointed extracted articles. The browser regression covers delayed results after verification and a redirect to the publisher.

## Exact officer queries

The local acquisition resumed in its dedicated Chrome profile, kept the 38 previously extracted publisher pages and started the active agency’s officer list again. The sweep test checks both quoted phrases through pagination and verifies that results from an older unquoted query are discarded on resume.

- `src/cli/acquire/acquire-data-context.ts` selects the officer’s stored first and last names for the query. `sources/org.policeconduct.local-news/sweep.ts` quotes those names together and the agency name separately and refreshes the old roster when resuming.
- `test/cli/acquire/acquire-data-context.test.ts` and `test/sources/news/local.test.ts` cover name selection, search text and checkpoint behavior.
- `README.md`, the change’s `design.md`, `specs/release-page-updates/spec.md` and this `verify.md` document the query format and its verification.
