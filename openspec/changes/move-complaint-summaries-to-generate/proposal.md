## Why

A full CourtListener acquire cannot finish. For each of about 8,300 dockets it fetches the docket's entries, downloads the complaint PDF and asks Claude for a summary, and one complaint that fails a check stops the whole run. On 2026-11-16 a run stopped at its 85th docket because the SHA-1 CourtListener records for a PDF differs from the file it serves. Through `data reset`, which runs each source's acquire, that stops the rebuild of every later source.

Most of that work is thrown away: only a docket with a party who matches an officer becomes a civil case, and the database holds 551 civil cases. A summary is also extra information about a case; a case is valid without one.

## What Changes

- **The acquire only lists dockets.** It searches CourtListener for each agency through the shared CourtListener client and writes each agency's `dockets.json`. It fetches no entries, downloads no PDF and makes no model call.
- **The complaint summary is worked out in `data generate`.** A resolver on the civil case fetches the docket's entries, selects the complaint, downloads the PDF, extracts its text and asks for a summary, each through a shared client and the cache (`cache-call-results-and-files`). Only dockets that become cases are processed.
- **A complaint problem never keeps a case out and never stops the command.** The case is imported with no summary, an unavailability state and an annotation that says in plain English what the problem is and where the complaint can be read or bought.
- **A file that does not match its recorded SHA-1 is still summarized.** The served file is kept under its own SHA-256, its text is extracted and summarized, and the case carries an error annotation saying the summary should not be trusted.
- **A resolver and a source can report a finding.** The shared import turns each into an annotation by the rules it already uses for corrections and validation, with the same stable ID on every run (ADR 0040).
- **A record's metadata is passed through the pipeline whole,** so a source's findings reach the import.
- **A docket that names an officer but cannot build a valid case** is reported as a warning annotation on the licensing authority of the agency's state.
- **A docket with no matching officer is still left out,** and the transform logs the docket, its URL and the reason.
- **Review receipts are removed.** The functions that record a document review outside the pipeline, and the code that reads their results, are deleted.

## Capabilities

### New Capabilities

- `courtlistener-complaint-summaries`: How a CourtListener civil case gets its complaint summary, and what happens when it cannot.
- `record-findings`: How a source or a resolver reports a problem with a record so that it becomes an annotation.

## Impact

Affected intake source: `com/courtlistener/www/api`. Affected shared code: the import's resolver context and findings, the record metadata path from transform to import, and the envelope type generator.

No Supabase migration: the `civil_cases` check on `ai_complaint_summary` stopped requiring `sha1Verified` to be true in `20261111230000_relax_complaint_summary_requirements.sql`, so a summary made from a mismatched file can already be stored (found during implementation; this proposal first said a migration was needed). No column is added: the resolver finds a case's docket from the case's existing primary source URL, which is the docket's address on CourtListener. The envelope types and import schemas are regenerated for record metadata. No downstream app contract changes: policeconduct.org shows annotations as intake writes them.

This replaces three requirements of `add-ai-complaint-summary` that describe summaries made during acquire: "Acquire and retain complaint evidence and analysis", "Reuse evidence-backed reviews" and the review scenarios of "Available complaint without a reliable summary". That change is not archived, so its spec is edited in place with this one. Its requirements for what is stored and shown stand.

This change depends on `cache-call-results-and-files`. A data reset is needed after both, and the first `data generate` for CourtListener makes the calls for every imported case.

The design is recorded in ADR 0040, proposed with this change.
