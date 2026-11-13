# Acquire complaint summaries

Extend the existing CourtListener acquisition path to select the latest complaint before checking availability, paginate all docket entries, retrieve the free PDF, verify its SHA-1 against metadata, retain the PDF and extracted text, and generate a structured summary through the existing Anthropic SDK pattern. Persist analysis by PDF hash, model and prompt version; each acquisition retains its own source metadata and result. Transform reads the result without network or model calls. Existing correction records remain preserved. No schema migration or database reset is required.

No complaint identified is pending assessment, not confirmed missing. An identified complaint without a public copy is missing_copy. Authentication, retrieval, verification and generation failures fail visibly and retain diagnostic artifacts; they must not become missing_copy. Never substitute an available older complaint when a later amended complaint is unavailable. Source text is untrusted data and cannot instruct the analyzer. Only free records are retrieved. No deployment or paid-model execution is included in offline validation.

Validation: synthetic tests for pagination, newest unavailable amendment, checksum mismatch, retained cache replay, structured page support, and deterministic transform propagation. Then final intake validation and coordinated local handoff.

## Retained reviews and two-pass acquisition

Match Minnesota POST's two-pass behavior: collect available complaint PDFs and text for discovered dockets before invoking analysis. Accept an explicit `codex-document-review` receipt tied to the PDF hash, extracted-text hash, current prompt contract. Summary paragraph page support is optional. Reuse the original summary and model attribution unchanged. Invalid or stale receipts fail visibly; they never trigger a silent replacement. Store reviewed results under source acquisition state and copy the selected receipt into each completed acquisition. Existing private reviewed summaries may be registered through this evidence contract without another model call.

## Reviewed unsummarized dispositions

Extend the existing receipt reader to accept a source-bound unsummarized disposition as an alternative to a reviewed summary. A separate registration helper validates the available verified PDF, all source identity fields, current prompt version, and exact PDF link. Store the alternative in the same document/hash receipt slot so a later explicit review replaces the prior disposition. Replay returns both result fields before text requirements or model analysis. This adds no database or published contract changes. Test empty/readable text, exact result replay, invalid source binding, and existing summary/local extraction behavior using synthetic temporary state only.
