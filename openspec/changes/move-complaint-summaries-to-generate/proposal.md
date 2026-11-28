## Why

A full CourtListener acquire cannot finish. For each of about 8,300 dockets it fetches the docket's entries, downloads the complaint PDF and asks Claude for a summary, and one complaint that fails a check stops the whole run. On 2026-11-16 a run stopped at its 85th docket because the SHA-1 CourtListener records for a PDF differs from the file it serves. Through `data reset`, which runs each source's acquire, that stops the rebuild of every later source.

Most of that work is thrown away: only a docket with a party who matches an officer becomes a civil case, and the database holds 551 civil cases. A summary is also extra information about a case; a case is valid without one.

## What Changes

- **The acquire only lists dockets.** It searches CourtListener for each agency through the shared CourtListener client and writes each agency's `dockets.json`. It fetches no entries, downloads no PDF and makes no model call. A search that finds nothing is a success; a search that fails or is skipped fails the acquire at its end, after every other search (owner's ruling, 2026-11-19).
- **The complaint summary is worked out in `data generate`.** A resolver on the civil case fetches the docket's entries, selects the complaint, downloads the PDF, extracts its text and asks for a summary, each through a shared client whose call results are entries of intake's one cache, `ResolvedProperty` (`cache-call-results-and-files`). Only dockets that become cases are processed.
- **A complaint problem never keeps a case out and never stops the command.** The case is imported with no summary, an unavailability state and an annotation that says in plain English what the problem is and where the complaint can be read or bought. A list of filings that cannot be fetched and a list with no usable complaint are two warning codes, each with its own message (owner's ruling, 2026-11-19).
- **A file that does not match its recorded SHA-1, or has none recorded, is still summarized.** The served file is kept as a `BinaryFile` record that the case points at, its text is extracted and summarized, and the case carries an error annotation saying the summary should not be trusted, or a warning annotation saying it could not be checked (owner's rulings, 2026-11-17 and 2026-11-19).
- **A stored summary has no publication status and no file facts.** `publicationStatus` is removed (owner's ruling, 2026-11-19), and so are the file's `url`, `sha1` and `sha256`: the case points at its complaint's `BinaryFile` record through a new foreign key, `civil_cases.complaint_file_id` (`cache-call-results-and-files`, section 2).
- **A resolver and a source can report a finding.** The shared import turns each into an annotation by the rules it already uses for corrections and validation, with the same stable ID on every run (ADR 0040).
- **A record's metadata is passed through the pipeline whole,** so a source's findings reach the import.
- **A docket that names an officer but cannot build a valid case** is reported as a warning annotation on the licensing authority of the agency's state. The transform emits that licensing authority's record for every state it processed, so every state an agency is in gets a licensing authority through the manual source (owner's ruling, 2026-11-19); the dev workspace needs DC, Virginia and Illinois added before its next reset ([design](design.md), section 6).
- **A docket with no matching officer is still left out,** and the transform logs the docket, its URL and the reason.
- **CourtListener's review receipts are removed.** A review receipt records a summary made by reviewing a complaint outside the pipeline, by hand or with another tool; CourtListener kept them in its `complaint-reviews/` state folder. The CourtListener functions that wrote them, and the code that read them, are deleted. Minnesota POST's review receipts are handled by `cache-call-results-and-files`.

## Capabilities

### New Capabilities

- `courtlistener-complaint-summaries`: How a CourtListener civil case gets its complaint summary, and what happens when it cannot.
- `record-findings`: How a source or a resolver reports a problem with a record so that it becomes an annotation.

This change also edits the spec of the unarchived change `add-ai-complaint-summary` in place, so it holds no delta of its own for `ai-complaint-summary`: two requirements and the review scenarios of a third are removed (below), and "Available complaint without a reliable summary" now says that `data generate` selects the complaint and points to `courtlistener-complaint-summaries` for how a complaint is summarized and what is reported when it cannot be. Its scenarios still state which documents are identified as a complaint; `courtlistener-complaint-summaries` states which of them is the latest.

## Impact

Affected intake source: `com/courtlistener/www/api`. Affected shared code: the `Finding` schema in `src/shared/data-annotations.ts`; the `aiComplaintSummary` schema in `src/shared/ai-complaint-summary.ts`, which loses `publicationStatus`, `url`, `sha1` and `sha256`; the `CivilCase` entity descriptor, which gains `complaint_file_id`; the grouping of resolver findings by source namespace; the import's resolver context, findings and a new civil case resolver (`src/cli/import/artifacts/facades/complaint-summary-resolvers.ts`, registered in `resolver-registry.ts`); `docketIdFromUrl` in `src/shared/services/courtlistener-client.ts`; the record metadata path from transform to import; the envelope type generator; and `sources/lib/state-authority-findings.ts`, which builds the `LicensingAuthorities` records the source now produces.

One Supabase migration adds `civil_cases.complaint_file_id`, a foreign key to `binary_file`, after the migration of `cache-call-results-and-files` that creates `binary_file`. The `civil_cases` check on `ai_complaint_summary` already stopped requiring `sha1Verified` to be true and lists no allowed keys (`20261111230000_relax_complaint_summary_requirements.sql`), so a summary made from an unchecked or mismatched file can be stored and the removed keys need no change to it; no migration checks `sha1Verified` (owner's ruling, 2026-11-19). The resolver finds a case's docket from the case's existing primary source URL, which is the docket's address on CourtListener. The envelope types and import schemas are regenerated for record metadata and the new column. Downstream: policeconduct.org shows annotations as intake writes them; the summary no longer carries the file's address or hashes, so a page that shows them reads the `binary_file` row the case points at instead.

This replaces the parts of `add-ai-complaint-summary` that describe summaries made during acquire: "Acquire and retain complaint evidence and analysis", "Reuse evidence-backed reviews" and the review scenarios of "Available complaint without a reliable summary". That change is not archived, so its spec is edited in place with this one. Its requirements for what is stored and shown stand, and so does the website's own sentence for each unavailability reason until the follow-up below.

This change depends on `cache-call-results-and-files`, including its rework onto one cache. Manual data: a licensing authority for every state an agency is in. A data reset is needed after both, and the first `data generate` for CourtListener makes the calls for every imported case.

The design is recorded in [ADR 0040](../../../docs/adr/0040-sources-and-resolvers-report-findings-that-become-annotations.md), proposed with this change.

## Follow-ups

- policeconduct.org and the `ai-complaint-summary` spec: stop showing the website's own sentence for an unavailability reason, now that the case's annotation states the problem. The spec's scenarios require that sentence today, so this needs its own change; it is done when policeconduct.org is next changed.
