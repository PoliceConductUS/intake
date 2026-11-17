# Design: work out CourtListener complaint summaries in generate, and never drop a case over its complaint

Related documents: [proposal](proposal.md), [complaint summaries spec](specs/courtlistener-complaint-summaries/spec.md), [record findings spec](specs/record-findings/spec.md), [tasks](tasks.md), [cache design](../cache-call-results-and-files/design.md), [ADR 0040](../../../docs/adr/0040-sources-and-resolvers-report-findings-that-become-annotations.md), [ADR 0039](../../../docs/adr/0039-the-cache-holds-call-results-and-files.md), [existing summary spec](../add-ai-complaint-summary/specs/ai-complaint-summary/spec.md).

This design replaces the one reviewed on 2026-11-16. That review's report is why most of it changed.

## Problem statement

Intake runs in phases, each a command:

1. **`data acquire <source>`** fetches a source's raw records into a command folder.
2. **`data transform <source>`** turns them into artifacts: lists of records of a kind, such as civil cases.
3. **`data generate <source>`** compares the artifacts with the database and writes the changes needed, as mutations. Fields that a source does not supply are worked out here by resolvers. Annotations are written here.
4. **`data up`** applies the mutations.

`data reset` rebuilds the database by running these for every source in order, including acquire.

The CourtListener source finds federal civil dockets that name a police agency. A docket is one court case on CourtListener. Today its acquire does three things for every docket it finds, about 8,300 of them:

- fetches the docket's entries (the list of documents filed);
- downloads the complaint, the document that starts the lawsuit, as a PDF;
- asks Claude for a summary of it.

Two things are wrong.

1. **One complaint with a problem stops everything.** The acquire throws on a problem with one docket's complaint. On 2026-11-16 it stopped at its 85th docket because the SHA-1 CourtListener records for a PDF differs from the file it serves. A failed acquire also stops `data reset` at that source, so no later source is rebuilt.
2. **Most of the work is discarded.** The transform keeps a docket only when one of its parties matches an officer of the agency. The database holds 551 civil cases. The acquire fetches, downloads and summarizes for all 8,300.

## Goals

- A CourtListener acquire finishes, and so does a `data reset`.
- A case is imported whether or not its complaint can be summarized. A problem is stated on the case as an annotation, in plain English, with the address where the complaint can be read or bought.
- Entries, PDFs and summaries are fetched only for dockets that become cases, and only once while nothing has changed.
- A docket that is left out is logged with the reason.

## Non-goals

- The cache and the shared clients. They are designed in `cache-call-results-and-files`; this design uses them.
- The typed annotation envelopes of `type-annotation-envelopes` and ADR 0038. This change uses today's annotation shape.
- Any change to policeconduct.org. It shows an annotation's message as intake writes it.
- Summaries for civil cases from other sources. The resolver acts on any case that names a CourtListener docket, but only the CourtListener source supplies one today.

## Terms

- **Entries**: the list of filings on a docket. Each entry can have documents.
- **Complaint**: the document that starts a lawsuit. The source selects the latest one identified in the entries, by the rules already in `summary-acquisition.ts`.
- **Resolver**: code in the shared import that works out one field of a record during `data generate`. Geocoding an agency's address is an existing one.
- **Client**: shared code that calls one outside service through the cache, from `cache-call-results-and-files`. It returns a result, or an item failure the caller can act on. It stops the command on a failure of the service itself.
- **Annotation**: a database record attached to another record that reports a problem with a source's data. It has a type (warning, error or correction), a field, a value, a message and evidence.
- **Finding**: a problem reported about one record, before `data generate` turns it into an annotation.
- **Unavailability state**: the existing `complaint_summary_unavailability` field on a civil case. It holds a reason, a detail, a source URL and a time. Its reasons are an existing fixed list.
- **Licensing authority**: the record for a US state's officer licensing body, for example TCOLE in Texas. It is the record intake uses to stand for a source of officers.

## Proposed architecture

### Overview

```
acquire      CourtListener client: search per agency ──> <agency>.dockets.json
transform    match parties to officers ──> CivilCase records, each with its docket's address
generate     civil case resolver, per case:
               CourtListener client: entries ──> select complaint
               download client: PDF ──> check it
               PDF text client: text
               inference client: summary
             success ──> summary on the case
             problem ──> unavailability state on the case + finding ──> annotation
up           applies the mutations
```

Every arrow to a client goes through the cache. A second `data generate` with nothing changed makes no request.

### 1. Acquire lists dockets and nothing else

`acquire.ts` keeps its loop over agencies and its search, now made through `CourtListenerClient`. A successful search result carries a `retryAfter` 120 days ahead, which is the refresh interval the source uses today. The acquire writes `<agency>.dockets.json` and nothing else.

Removed from the acquire: the entries requests, the PDF downloads, the model calls, `docket-cache.json`, `.api-calls.jsonl`, the `complaints/` folder, and the catch that skipped an agency on any error.

### 2. The transform stops supplying the summary and logs what it leaves out

Each `CivilCase` record already carries its docket's address on CourtListener as `primary_source_url`. The resolver finds the docket from that address, so no field is added to the case and the database does not change.

The transform no longer supplies `ai_complaint_summary` or `complaint_summary_unavailability`.

It checks each docket in this order and counts each outcome for its last log line:

1. **The agency record in the file lacks an ID, a name or a state:** leave the file out; log the file and the reason.
2. **No party matches an officer of the agency:** leave the docket out; log the docket ID, its URL and "no matching officer".
3. **A party matches but the docket has no title or no valid filing date:** write no case; report a finding on the licensing authority (section 6).
4. **Otherwise:** write the case.

Officer matching runs before the title and date check, so that only a docket that would have become a case can produce the finding in step 3.

### 3. The civil case resolver

One resolution per case fills both `ai_complaint_summary` and `complaint_summary_unavailability`, the way one geocode fills both latitude and longitude today. It runs only when the case's `primary_source_url` is a docket address on `www.courtlistener.com`; the CourtListener client reads the docket ID from it. The steps:

| Step                                              | Client        | Item failure or bad result |
| ------------------------------------------------- | ------------- | -------------------------- |
| Fetch the docket's entries                        | CourtListener | `complaint-entries`        |
| Select the latest identified complaint            | none          | `complaint-not-found`      |
| Is a copy available, with a download address?     | none          | `complaint-no-copy`        |
| Does CourtListener record a SHA-1?                | none          | `complaint-no-check`       |
| Download the PDF from `storage.courtlistener.com` | Download      | `complaint-download`       |
| Is it a PDF?                                      | none          | `complaint-not-pdf`        |
| Does its SHA-1 equal the recorded one?            | none          | `complaint-mismatch`       |
| Extract its text                                  | PDF text      | `complaint-no-text`        |
| Ask for a summary; check the pages it cites exist | Inference     | `complaint-no-summary`     |

The rule for which failures stop the command is the clients', not this resolver's: a failure of one item comes back as a value and becomes a row in this table; a failure of the service stops the command. Anything that goes wrong for one case that is not a service failure is one of these nine codes. An entries response that does not have the expected shape is `complaint-entries`, not a thrown error.

A successful entries result carries a `retryAfter` 120 days ahead, so new filings on a docket are seen at that interval.

**The request to the model** holds the model, the reasoning level and other parameters, the full prompt text, and the SHA-256 of the complaint's text. Changing the prompt therefore asks again for every case, and reuses the cached entries, PDF and text.

**The text** comes from the PDF text client, not from CourtListener's own extracted text. That gives CourtListener and Minnesota POST one way of reading a PDF, including OCR for a scanned page.

**Nothing derived here is cached a second time.** The summary and the state are worked out on every run from call results that are already cached, so the run makes no request when nothing has changed, and a failure is not frozen in place (ADR 0039, decision 8).

### 4. A problem becomes a state and a finding

For each code the resolver sets the unavailability state and reports one finding. No new reason is added to the existing list.

| Code                   | Unavailability reason  | Finding type |
| ---------------------- | ---------------------- | ------------ |
| `complaint-entries`    | retrieval_failed       | error        |
| `complaint-not-found`  | pending                | warning      |
| `complaint-no-copy`    | missing_copy           | warning      |
| `complaint-download`   | retrieval_failed       | warning      |
| `complaint-no-check`   | retrieval_failed       | error        |
| `complaint-mismatch`   | retrieval_failed       | error        |
| `complaint-not-pdf`    | retrieval_failed       | error        |
| `complaint-no-text`    | available_unsummarized | warning      |
| `complaint-no-summary` | available_unsummarized | warning      |

An error is a case where CourtListener's own data is wrong or contradicts itself. A warning is a case where something is absent or could not be used. `available_unsummarized` is the reason the existing summary spec defines for a complaint that exists but has no reliable summary.

The finding holds:

- `code` and `type` from the table;
- `field`: `ai_complaint_summary`;
- `value`: what was found. For a mismatch: the recorded SHA-1, the served file's SHA-1 and SHA-256, and its byte count. For a download failure: the HTTP status. For the others: the document number when a complaint was identified, otherwise null;
- `message`: the text in the spec for that code, with the address filled in;
- `evidence`: one source record each for the docket, the complaint document when identified, and the downloaded file when there is one. Each has what it is, the source namespace, its full URL, and the retrieval time and SHA-256 when it was retrieved;
- the source namespace and the docket ID as its source record ID.

The state's `detail` is the same message. Its `checkedAt` is the time of the call result that decided the outcome, so it does not change from run to run while that result stands.

**The message says three things and no more:** that we tried to summarize the complaint, why we could not, and where to look. It gives the docket's address, or the complaint document's page when there is a file to point at. When there is no free copy it also says how a reader can help: buying the complaint from PACER, the federal courts' document system, with the free RECAP browser extension installed makes it free for everyone on CourtListener, with a link to the setup page (`https://free.law/recap/`). An address CourtListener's data gives on any host other than `www.courtlistener.com` is not used.

The message wording is in the spec, because it is public text.

### 5. Findings in the shared import

Today `data generate` builds two groups of findings per record (corrections applied, and validation of the final values) and turns each finding into a `DataAnnotation` record. The record's name is a hash of the subject, the group, the finding's key, the source namespace and the source record ID, and its ID comes from that name, so it is the same on every run. An active annotation in a group that the record no longer produces is written as resolved.

This change adds two groups and no new rule:

- **Source findings:** the list in a record's `metadata.defects`.
- **Resolver findings:** what a record's resolvers reported through their context.

A finding's key is its code and field. Because the name already includes the source record ID, two findings with one code about two dockets are two annotations.

A finding has no `code` column to land in; the code is used for the name and is not stored on the annotation. ADR 0038 gives it a home later.

`metadata.defects` cannot reach the import today, because record metadata is rebuilt from `name`, `action` and `selector` at each of these places: `toRecordMetadata`, the singular record envelope and the artifact write path in `scripts/generate-envelope-types.ts`; `src/shared/io/Artifacts.ts`; `src/cli/import/artifacts/config.ts`; and the `EmittedRecords` type in `src/cli/transform/source-transform.ts`. Each is changed to validate the metadata once against its strict schema and pass the object on whole.

A finding on a kind that takes no part in annotations (one with no source evidence) fails `data generate`. Today the inspection returns early for such a kind, which would drop the finding silently.

### 6. A docket that cannot build a case

The transform emits one `LicensingAuthorities` record for each US state it processed agencies for, as a partial update that changes no field and carries `metadata.defects`. The list holds one `docket-not-buildable` warning per such docket, with the docket as the finding's source record ID, and is empty when there are none. Emitting the record every time is what lets `data generate` resolve an annotation once its docket is fixed.

The acquire only lists agencies with at least one officer, and officers come from the three licensing sources, so the states are Texas, Minnesota and Oregon. Each has one licensing authority.

## Alternatives considered

- **Keep the summary in acquire and record problems there.** This was the design reviewed on 2026-11-16. Rejected: it kept the cost of 8,300 dockets, needed a cache of its own, and the review found its reuse rule skipped a changed prompt.
- **Fetch entries in acquire and only download and summarize in generate.** Rejected: entries for 8,300 dockets would still be fetched to serve 551 cases. With one shared CourtListener client, the resolver can fetch them.
- **Detect a changed docket by CourtListener's index timestamp.** Rejected: nothing in the repository reads it, its meaning is untested, and at 551 cases a refresh every 120 days costs little.
- **Carry the problem only in the unavailability state, with no annotation.** Rejected by the owner: an annotation is how intake shows a problem with a source's data, and its wording belongs to intake, not to a website component that interprets a reason.
- **Report a docket that cannot build a case through `source_exclusions`.** Rejected: that field records a person's decision to exclude a record, has no place for an address or evidence, and requires one licensing authority mapped to the source's namespace, which a national source does not have.
- **Put that finding on the agency.** Not chosen: the owner's rule is that a record that cannot be built is reported on the record that stands for the source, which is the licensing authority today.
- **Throw from the resolver and catch per record.** Rejected: the reason would be lost and a service failure would be caught with it.

## Risks and mitigations

| Risk                                                                                                                  | Mitigation                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The first `data generate` for CourtListener makes every call for 551 cases and takes hours                            | The cache keeps what is done if it stops; the next run continues. The run is a task that needs the owner's go-ahead.                                                                                                                                           |
| A reader sees two texts for one problem: the annotation, and the website's own sentence for the unavailability reason | Accepted for this change. The website's sentence should go, which is a policeconduct.org change; it is listed in the proposal's follow-ups when that repository is next changed.                                                                               |
| Up to 551 new public annotations                                                                                      | The count is reported by the validation task before the change is merged.                                                                                                                                                                                      |
| `data generate` now makes network calls for this source and can be stopped by an outage                               | The clients check each service before the first call and name the time to try again. `data up` is unaffected: it applies only what was generated.                                                                                                              |
| A case that had a summary loses it when a newer complaint on the docket cannot be read                                | Accepted: the existing rule is that an older complaint is not presented as the current one. The annotation says why.                                                                                                                                           |
| The partial update that selects a licensing authority by state matches none or several, which fails the import        | The selector form is fixed by a test against a database with the three authorities before the transform change is written. If a state the transform processed has no single authority, the transform fails naming the state, before any mutation is generated. |
| The summary text now comes from intake's own PDF extraction, which may differ from CourtListener's                    | No summaries exist yet in any workspace, so nothing is compared against an older result.                                                                                                                                                                       |
| Log volume: most of 8,300 dockets have no matching officer                                                            | One line per docket is the record the owner asked for. The last line gives the counts.                                                                                                                                                                         |

## Implementation Plan

Paths are from the repository root. Phases 1 and 2 of `cache-call-results-and-files` come first. Each step below ends with `npm run validate` passing.

**Phase A: findings in the shared import.**

1. Modify `src/shared/data-annotations.ts`: add the `Finding` schema (strict): `code`, `type` (`warning` or `error`), `field`, `value`, `message`, `evidence` (optional), `source_namespace`, `source_record_id`.
2. Modify `scripts/generate-envelope-types.ts`: add optional `defects` (a list of `Finding`) to `recordMetadataSchema`; make `toRecordMetadata`, the singular record envelope and the artifact write path return the validated metadata object whole. Run `npm run generate:envelope-types`; the files under `src/shared/io/generated/` change.
3. Modify `src/shared/io/Artifacts.ts`, `src/cli/import/artifacts/config.ts` and the `EmittedRecords` type in `src/cli/transform/source-transform.ts` to pass metadata whole. Add `defects` to `SourceRecordContext` in `src/cli/import/artifacts/data-context.ts`. Test in `test/import/artifacts/record-metadata.test.ts`: a record's `defects` reach the facade; an unknown metadata key is rejected.
4. Modify `src/cli/import/artifacts/resolver-kit.ts`: add `report(finding)` to `ResolverContext`. Modify `src/cli/import/artifacts/facades/entity-facade.ts` to hold source findings and resolver findings and expose them.
5. Modify `visitMutations` in `src/cli/import/artifacts/data-context.ts`: add the two groups before the early return for a kind without source evidence, and fail for such a kind when it has a finding. Remove `code` before the finding is spread into the annotation record. Tests in `test/import/findings.integration.test.ts` for each scenario in the `record-findings` spec, including the same ID on a second run.

**Phase B: CourtListener.**

6. Add `docketIdFromUrl(url)` to the CourtListener client, returning the docket ID for a `www.courtlistener.com` docket address and nothing for any other address. Test both.
7. Modify `sources/com/courtlistener/www/api/acquire.ts` as in section 1. Delete `docket-cache.ts`. Replace `test/sources/courtlistener/docket-cache.test.ts` and rewrite `test/sources/courtlistener/acquire-summary-pipeline.test.ts` as an acquire test: only searches are made; only `dockets.json` files are written.
8. Modify `sources/com/courtlistener/www/api/transform.ts` as in sections 2 and 6, and add `LicensingAuthorities` to `produces` in `intake.source.ts`. Before writing it, add a test that fixes the selector that selects a licensing authority by its state. Tests in `test/sources/courtlistener/transform.test.ts`: the summary fields are no longer supplied; each left-out reason is logged and counted; two dockets in one state; an empty list when none.
9. Create `src/cli/import/artifacts/facades/complaint-summary-resolvers.ts`: the resolution of section 3, with the complaint selection moved from `summary-acquisition.ts`, the address rule and the messages of section 4. Register it for `CivilCase` in `src/cli/import/artifacts/facades/resolver-registry.ts`. Tests in `test/import/artifacts/complaint-summary-resolvers.test.ts`: one per code, asserting the state, the finding's type, value, message and evidence; the address rule; a second run that makes no request; a changed prompt; a problem that goes away.
10. Delete `sources/com/courtlistener/www/api/summary-acquisition.ts` and `summary-analysis.ts` and their tests, including the review receipt functions. Edit `openspec/changes/add-ai-complaint-summary/specs/ai-complaint-summary/spec.md` to remove the three requirements this change replaces.

**Phase C: verify.**

11. Run `data generate` for CourtListener on the dev workspace and report cases processed, summaries written and problems by code. This step needs the owner's go-ahead before it is run.
