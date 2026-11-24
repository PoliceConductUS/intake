# post-license-search acquire

## Overview

The acquire steps of the `com/site/my/mnitservices/post-license-search` source (Minnesota POST). [`../acquire.ts`](../acquire.ts) wires them together: it downloads the agency CSV, resolves each agency name to its site id, saves agency rosters and officer details, reads the discipline workbooks, downloads each disciplinary order PDF, extracts its text, has the order analyzed, and writes the skip report. Every step writes raw source files under the source directory. The agency CSV and its citation, the rosters, the officer details, the `discipline-requests` files and the order PDFs are written once and reused when they are already there, so an interrupted acquire resumes. `skipped.yaml`, `agency-ids.yaml`, `discipline-personnel.json`, `discipline-unresolved-licenses.json` and `discipline-unresolved-agencies.json` are rewritten on every run. An existing `*.document.json` is also rewritten on every run: with the current actions and document name when its analysis uses the current prompt, otherwise rebuilt from the saved PDF. Nothing in this folder writes to the database.

## Interface

Collecting rosters and officer details ([`collect.ts`](./collect.ts)):

- `collect.ts:collectSources` - `(CollectDeps) => Promise<CollectResult>`; writes `agencies/agencies.csv`, `agencies/citation.json`, `officers/<stem>.roster.json` and `officers/<stem>.detail.json`, and returns the skipped agencies and officers. `supplementalAgencyNames` that are not in the agency CSV are appended to its names; `excludedAgencyNames` are then removed and returned as skipped agencies.
- `collect.ts:parseAgencyNames` - `(csv) => string[]`; the `Agency` column of the agency CSV.
- `collect.ts:EXCLUDED_AGENCY_REASON` - the `reason` of a skipped agency that is in `excludedAgencyNames`; `../transform.ts:transform` reads it from `skipped.yaml`.
- `collect.ts:artifactStem` - `(value) => string`; file stem `<slug>-<first 12 hex of sha256(value)>`.
- `collect.ts:PostClient` - type; the four site calls `searchLicense`, `searchAgency`, `fetchOfficerList`, `fetchOfficerDetails`.
- Types: `collect.ts:AgencyMatch`, `collect.ts:AgencyMatchResult`, `collect.ts:OfficerRow`, `collect.ts:OfficerDetail`, `collect.ts:AgencyFilters`, `collect.ts:AgencyCsv`, `collect.ts:CollectLogger`, `collect.ts:SkippedAgency`, `collect.ts:SkippedOfficer`, `collect.ts:CollectResult`, `collect.ts:CollectDeps`.

Site access:

- `post-client.ts:createPostLicenseSearchClient` - `({ context, logger? }) => Promise<PostClientHandle>`; a `PostClient` that posts Apex actions from a page in the caller's Playwright browser context.
- `post-client.ts:PostClientHandle` - type; `PostClient` plus `close()`.
- `post-client.ts:parseApexActions` - `(responseText, actionIds, specs) => unknown[]`; the return value of each action in an Aura response.
- `post-client.ts:selectExactAgencyMatches` - `(agencyName, matches) => AgencyMatch[]`; matches whose `Organization_Name__c` equals the name after whitespace normalization.
- `agency-csv.ts:fetchPostAgencyCsv` - `(AgencyCsvOptions) => Promise<AgencyCsv>`; the agency CSV body and its citation from the MN POST statistics page.
- `agency-csv.ts:findAgencyCsvUrl` - `(html) => string`; the href of the "MN Law Enforcement Agencies and Contact Information" link.
- `agency-csv.ts:AgencyCsvOptions` - type; `context`, `captchaWaitMs?`, `logger?`.

Agency ids ([`agency-id-cache.ts`](./agency-id-cache.ts)):

- `agency-id-cache.ts:openAgencyIdCache` - `({ statePath, searchAgency, now }) => Promise<AgencyIdCache>`; agency name to site id, persisted at `<statePath>/agencies.yaml`.
- `agency-id-cache.ts:writeAgencyIds` - `(sourceDir, ledger) => Promise<void>`; writes `agency-ids.yaml`.
- Types: `agency-id-cache.ts:AgencyLedgerEntry`, `agency-id-cache.ts:AgencyLedger`, `agency-id-cache.ts:AgencyIdLookup`, `agency-id-cache.ts:AgencyIdCache`.

Discipline workbooks and personnel:

- `discipline-workbooks.ts:WORKBOOK_FILES` - the three workbook filenames (`discipline`, `roster`, `history`).
- `discipline-workbooks.ts:readDisciplineWorkbooks` - `(directory) => Promise<DisciplinePerson[]>`; each disciplined license with its employment history.
- `discipline-workbooks.ts:parseDisciplineRows` - `(rows) => DisciplinePerson[]`.
- `discipline-workbooks.ts:parseHistoryRows` - `(rows, licenses) => Map<string, EmploymentHistory[]>`.
- `discipline-workbooks.ts:validateWorkbookHeader` - `(values, expected) => void`.
- Types: `discipline-workbooks.ts:WorkbookRow`, `discipline-workbooks.ts:EmploymentHistory`, `discipline-workbooks.ts:DisciplinePerson`.
- `collect-discipline.ts:collectDisciplinePersonnel` - `({ sourceDir, people, client, cache, logger? }) => Promise<void>`; searches each workbook license, saves its officer detail, and writes `discipline-personnel.json` (`people`, and `missingActions` for each resolved license whose detail lists no disciplinary action), `discipline-unresolved-licenses.json` and `discipline-unresolved-agencies.json`.
- `collect-discipline.ts:requireExactLicense` - `(number, rows) => OfficerRow`.

Disciplinary order documents:

- `collect-documents.ts:collectDocuments` - `(CollectDocumentsDeps) => Promise<{ skippedDocuments }>`; writes `documents/<stem>.pdf` and `documents/<stem>.document.json` per distinct document URL.
- `collect-documents.ts:disciplinaryDocumentReferences` - `(officersDir) => Promise<DocumentReference[]>`; each distinct `documentURL` in the officer details with the actions that cite it.
- `collect-documents.ts:documentStem` - `(reference) => string`; `<case number slug>-<first 12 hex of sha256(url)>`.
- `collect-documents.ts:joinPages` - `(text) => string`; non-blank page texts joined by a blank line.
- Types: `collect-documents.ts:DocumentAction`, `collect-documents.ts:FetchedDocument`, `collect-documents.ts:DocumentPage`, `collect-documents.ts:DocumentText`, `collect-documents.ts:OrderAnalysis`, `collect-documents.ts:AnalysisAbsenceReasons`, `collect-documents.ts:OrderAnalysisResult`, `collect-documents.ts:CodexDocumentReviewReceipt`, `collect-documents.ts:OrderAnalyzer`, `collect-documents.ts:DisciplinaryDocument`, `collect-documents.ts:SkippedDocument`, `collect-documents.ts:CollectDocumentsDeps`, `collect-documents.ts:DocumentReference`.
- `document-fetch.ts:createDocumentFetcher` - `({ context, logger? }) => (url) => Promise<FetchedDocument>`.
- `document-fetch.ts:isPublicContentLink` - `(url) => boolean`; true for a `/sfc/p/` path.
- `document-fetch.ts:publicContentDownloadUrl` - `(pageUrl, html) => string`; the direct download URL for a rendered public content page.
- Text extraction is `extractDocumentText` in `src/shared/services/pdf-text-client.ts` (see `src/shared/services/README.md`); `../acquire.ts` passes it to `collectDocuments` as `extractText`. `collect-documents.ts` exports that file's `DocumentPage` and `DocumentText` types.
- `document-evidence.ts:readDocumentEvidence` - `(jsonPath) => Promise<document>`; a validated `*.document.json` with its analysis.
- `document-evidence.ts:readPreservedDocumentEvidence` - `(jsonPath) => Promise<document>`; the source evidence only, for a document whose analysis must be regenerated.
- Zod schemas: `document-evidence.ts:DocumentActionSchema`, `document-evidence.ts:OrderAnalysisSchema`, `document-evidence.ts:AbsenceReasonsSchema`, `document-evidence.ts:OrderAnalysisResultSchema`, `document-evidence.ts:UnavailableDocumentSchema`.
- `order-analysis.ts:createOrderAnalyzer` - `(apiKey) => OrderAnalyzer`.
- `order-analysis.ts:createLazyOrderAnalyzer` - `(readApiKey) => OrderAnalyzer`; reads the key on the first `analyze` call.
- `order-analysis.ts:ORDER_ANALYSIS_MODEL` - `"claude-opus-5"`.
- `order-prompt.ts:ORDER_ANALYSIS_INSTRUCTIONS` - the text of [`order-analysis-prompt.txt`](./order-analysis-prompt.txt); re-exported from `order-analysis.ts`.
- `order-prompt.ts:ORDER_ANALYSIS_PROMPT_SHA256` - sha256 of that text; re-exported from `order-analysis.ts`.

Reporting and configuration:

- `skip-report.ts:writeSkipReport` - `(sourceDir, skippedAgencies, skippedOfficers, skippedDocuments, logger) => Promise<void>`; writes `skipped.yaml`.
- [`agency-filters.yaml`](./agency-filters.yaml) - `supplementalAgencies` list, loaded by `../acquire.ts:loadAgencyFilters`.

## Invariants

- `post-client.ts:assertCompleteResultCount` (not exported) - a search result whose `recordCount` differs from the number of returned records throws.
- `post-client.ts:parseApexActions` - an action that is missing from the response or whose state is not `SUCCESS` throws.
- `post-client.ts:createPostLicenseSearchClient` - throws when the site exposes no Aura context within 60 seconds. An Aura HTTP response that is not OK throws `POST license search Aura request [<methods>] failed: <status>`.
- `agency-csv.ts:assertNotBotChallenge` (not exported) - a CAPTCHA page is never returned as the statistics page or as the CSV body; it throws.
- `agency-csv.ts:fetchPostAgencyCsv` - the CAPTCHA wait defaults to 180 seconds (`agency-csv.ts:DEFAULT_CAPTCHA_WAIT_MS`, not exported); with `captchaWaitMs <= 0` a CAPTCHA page throws at once. After the click on the CSV link, it throws "Timed out downloading the POST agency CSV after clicking" when neither a response nor a download arrives within 60 seconds, and `Failed to fetch POST agency CSV: <status>` on a CSV response that is not OK.
- `agency-csv.ts:findAgencyCsvUrl` - throws when the labelled CSV link is absent.
- `collect.ts:parseAgencyNames` - throws when a non-empty CSV has no `Agency` column, and when a row has a blank agency name.
- `collect.ts:collectSources` - an agency in `excludedAgencyNames`, an agency the cache cannot resolve and a roster row with no `licenseId` are returned as skipped, not dropped. An excluded agency has the reason `collect.ts:EXCLUDED_AGENCY_REASON` and no `candidateCount`. Officer details are requested in batches of at most 25 (`collect.ts:OFFICER_DETAIL_BATCH`, not exported); a batch for which the site returns a number of details different from the number of officers requested throws, and no detail of that batch is written.
- `collect.ts:fileExists` (not exported) and `collect-documents.ts:fileExists` (not exported) - only `ENOENT` means the file is absent; any other error is thrown.
- `agency-id-cache.ts:openAgencyIdCache` - a cached id is returned without a search; a search result is cached only when it has exactly one match, otherwise the lookup is a `skip`.
- `discipline-workbooks.ts:validateWorkbookHeader` - a header cell that differs from the expected label throws.
- `discipline-workbooks.ts:parseDisciplineRows` - a duplicate license number, a non-numeric license number, or a row whose "Has Been Disciplined" cell is not `true` throws.
- `discipline-workbooks.ts:parseHistoryRows` - a history row with no grouped license, or one for a disciplined license whose agency status is not `Former`, throws.
- `discipline-workbooks.ts:parseDisciplineRows` / `discipline-workbooks.ts:parseHistoryRows` - a blank required cell throws `Missing <label> at workbook row <n>`; a date cell that is not a date value and not in `M/D/YYYY` form, or that is not a real calendar date, throws `Invalid date <value> at row <n>`. A discipline or roster row whose name cell is "Total" and a history row whose license cell is "Subtotal" or "Total" are skipped.
- `discipline-workbooks.ts:readDisciplineWorkbooks` - a duplicate roster license, or a disciplined license whose roster row is missing or carries a different name, throws.
- `collect-discipline.ts:requireExactLicense` - requires exactly one search row with the requested license number and non-blank `contactId` and `licenseId`.
- `collect-discipline.ts:collectDisciplinePersonnel` - a license whose search returned no rows is resolved from saved officer details only when exactly one candidate exists; every other unresolved license is written to `discipline-unresolved-licenses.json`. A detail license list with a different `contactId` throws. It also throws on:
  - a detail request that does not return exactly one detail ("missing detail response");
  - a detail file that is missing after its `.complete.json` was written ("completed detail missing");
  - a `disciplinaryActions` value that is neither a list nor "No POST Disciplinary Actions found" ("unexpected disciplinary actions response");
  - a saved `.resolution.json` with no `sourceDetail` ("saved resolution missing source detail provenance");
  - a saved `.resolution.json` whose `licenseId` differs from the one in `.complete.json` ("saved resolution/checkpoint identity mismatch");
  - a saved officer detail that lists an unresolved license but in which not exactly one license with a `contactId` matches the file name ("Cannot verify cached license detail identity").
- `collect-documents.ts:collectDocuments` - throws when the analyzer's `promptSha256` is not `ORDER_ANALYSIS_PROMPT_SHA256`, when a saved document's URL differs from the reference, or when a cached analysis uses a stale prompt. All documents are fetched and their text extracted before any is analyzed. Each written `*.document.json` is read back through `readDocumentEvidence`. For a PDF that is already on disk, `fetchedAt` is the file's modification time, not the time of the fetch.
- `collect-documents.ts:disciplinaryDocumentReferences` - a disciplinary action with no `documentURL` has no reference. An action that has a `documentURL` and a blank `contactId` or `caseNumber` throws. An `officers` folder that does not exist gives no references; any other read error is thrown.
- `document-evidence.ts:OrderAnalysisResultSchema` - every null narrative requires an absence reason, and a populated narrative must not have one.
- `document-evidence.ts:verifyPreservedDocument` (not exported) - the sibling `.pdf` must match the recorded `bytes` and `sha256`, and `text` must equal the joined page texts.
- `document-evidence.ts:readDocumentEvidence` - `analyzedWith.promptSha256` must equal the current prompt hash; an analysis by `codex-document-review` requires a review receipt; each receipt excerpt must appear on its cited page; a receipt with no evidence for an analysis field that is not null throws `document review evidence missing for <field>`.
- `document-fetch.ts:createDocumentFetcher` - a 404 and a non-PDF body are `unavailable`; any other non-OK status throws. Bytes are returned as `pdf` only when they start with `%PDF-` (`document-fetch.ts:isPdf`, not exported). A public content page that does not render a file within 30 seconds is `unavailable`, with the reason "the content delivery has been deleted or expired" or "the public content page did not render a file".
- `document-fetch.ts:publicContentDownloadUrl` - throws when the delivery path or the file version id cannot be read.
- `order-analysis.ts:createOrderAnalyzer` - a refusal, or a response without the expected structure, throws.
- `order-analysis.ts:createLazyOrderAnalyzer` - throws when `analyze` is called and the key is missing or blank.

## Side Effects

- `post-client.ts:createPostLicenseSearchClient` - opens `https://mnitservices.my.site.com/POSTLicenseSearch/s/` in a Playwright page and posts Apex actions (`POSTSearch`, `POSTSearchEducation`) to its `/sfsites/aura` endpoint; a transient failure is retried up to three attempts (`post-client.ts:retryTransientAuraAction`, not exported).
- `agency-csv.ts:fetchPostAgencyCsv` - opens `https://mn.gov/post/boardscommittees/reportsstatistics/statistics/` in a Playwright page, waits for a person to solve a CAPTCHA when one is shown, clicks the CSV link, and reads the response or the downloaded file.
- `document-fetch.ts:createDocumentFetcher` - HTTP GET of each order URL through the browser context; a `mnitservices--c.documentforce.com` download URL is requested from `mnitservices.file.force.com`; a public content link is opened in a page first.
- `order-analysis.ts:createOrderAnalyzer` - calls the Anthropic API (`client.beta.messages.parse`) with the order text.
- `order-prompt.ts:ORDER_ANALYSIS_INSTRUCTIONS` - reads `order-analysis-prompt.txt` from disk when the module loads.
- `collect.ts:collectSources` - creates `agencies/` and `officers/` under the source directory and writes the CSV, citation, roster and detail files.
- `collect-discipline.ts:collectDisciplinePersonnel` - writes `discipline-requests/<license>.search.json`, `.complete.json` and `.resolution.json`, officer detail files, and the three `discipline-*.json` files in the source directory. It calls `cache.resolve` for every history agency name, which can search the site and write `<statePath>/agencies.yaml`. When a license search returned no rows, it reads every `officers/*.detail.json`.
- `collect-documents.ts:collectDocuments` - writes `documents/<stem>.pdf` and `documents/<stem>.document.json` in the source directory and `documents/<sha256>.json` (extracted text and analysis) in state.
- `agency-id-cache.ts:openAgencyIdCache` - reads and writes `<statePath>/agencies.yaml`; `agency-id-cache.ts:writeAgencyIds` writes `agency-ids.yaml` in the source directory.
- `discipline-workbooks.ts:readDisciplineWorkbooks` - reads the three `.xlsx` workbooks from the given directory.
- `skip-report.ts:writeSkipReport` - writes `skipped.yaml` in the source directory and logs the counts.

## Verification

- Run: `npx vitest run test/sources/mn-post/acquire`
