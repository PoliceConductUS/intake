## ADDED Requirements

### Requirement: Provenance-bearing complaint summary

The system SHALL store AI complaint summaries independently of claims_summary and reject non-null summaries missing complaint URL, source page, filing date, retrieval timestamp, verified SHA-1, SHA-256, confidence, model, generation date, paragraph page support, limitations, or separately sourced procedural context.

#### Scenario: Incomplete provenance

- **WHEN** intake or website data access receives an incomplete summary
- **THEN** it fails visibly before persistence or rendering

#### Scenario: Source-bounded rendering

- **WHEN** a complete summary is loaded
- **THEN** the page displays an AI label, attributed allegations, complaint citation and filing date, retrieval and confidence metadata, and procedural context under a separate heading

#### Scenario: No summary

- **WHEN** the summary field is null
- **THEN** an honest unavailable-summary message links to /donate/ and legacy claims_summary is not relabeled

### Requirement: Honest unavailable-summary states

The system SHALL distinguish confirmed missing complaint copies from retrieval, authentication, and generation failures and pending processing. Unassessed null metadata SHALL NOT imply a complaint copy is missing. Recorded unavailability SHALL include a reason, source URL, check timestamp, and internal detail. A completed summary and unavailability metadata SHALL NOT coexist.

#### Scenario: Confirmed missing copy

- **WHEN** sourced unavailability records a missing complaint copy
- **THEN** the page says we do not have a copy and links to /donate/ to support obtaining court records and making them available free on CourtListener, without promising this particular purchase

#### Scenario: Pending, failed, or unassessed

- **WHEN** no summary exists but the copy is not confirmed missing
- **THEN** the page states a complaint-based summary is not yet available without claiming the complaint is missing, and offers the same donation navigation

### Requirement: Acquire and retain complaint evidence and analysis

CourtListener acquire SHALL paginate docket entries, select the latest identified complaint before checking availability, retrieve a free available PDF and verify its SHA-1 against source metadata. It SHALL retain the PDF, extracted text, docket evidence and provenance-bearing AI summary in acquisition output. It SHALL cache analysis by document identity, content, model and prompt version. Transform SHALL consume saved summaries without network or model calls. A missing identified copy SHALL remain distinct from an unidentified complaint, unavailable text, authentication failure, retrieval failure or analysis failure. Failures SHALL be visible and SHALL NOT fabricate a missing-copy result.

#### Scenario: Replay without model access

- **WHEN** an acquisition has saved a valid complaint summary
- **THEN** transformation reproduces that summary offline
- **AND** database regeneration can consume it through the ordinary import pipeline

#### Scenario: Newer amendment has no copy

- **WHEN** an older complaint is available but a later identified amendment is unavailable
- **THEN** acquisition records the missing current copy
- **AND** does not summarize the older complaint as the selected complaint

#### Scenario: Missing extracted text

- **WHEN** the PDF is available and verifies but text extraction is absent
- **THEN** acquisition retains the PDF and reports the extraction failure
- **AND** does not generate a summary from a title or cause code

### Requirement: Reuse evidence-backed reviews

Acquisition SHALL complete complaint collection before model analysis. It SHALL accept an explicit Codex document-review receipt only when the current prompt version, source PDF hash, extracted-text hash, source identity and paragraph evidence match. Reviewed summaries SHALL retain their original text and model attribution. Invalid receipts SHALL fail visibly.

#### Scenario: Reviewed complaint without API access

- **WHEN** a verified complaint has a matching reviewed summary receipt
- **THEN** acquisition retains that summary and receipt without a model call
- **AND** transform reads the retained summary offline

### Requirement: Available complaint without a reliable summary

The system SHALL retain an `available_unsummarized` disposition with the complaint document URL when a copy is available but automated review cannot produce a reliable summary. This disposition SHALL NOT be treated as a completed AI summary or require user review.

#### Scenario: Complaint cannot be summarized reliably

- **WHEN** a retained complaint cannot be summarized reliably
- **THEN** the case page states "The complaint is available, but we were unable to summarize it." and links to the complaint document
- **AND** the disposition is applied through the final intake run after summary calculation is complete

#### Scenario: Reviewed local PDF extraction

- **WHEN** a verified PDF has no usable source API text but an explicit review includes locally extracted text
- **THEN** the review retains the extraction method and text, binds its hash to the verified PDF receipt, and validates paragraph page references against that text
- **AND** acquisition replays the reviewed summary without requiring API text or a model call
- **AND** altered extraction text or source metadata fails verification; raw API text is preserved

#### Scenario: Complaint filed as an explicitly labelled attachment

- **WHEN** a docket entry contains an attachment explicitly labelled as the complete complaint and a generic main document
- **THEN** acquisition selects that complaint attachment ahead of the main document
- **AND** attachments labelled as parties lists or exhibits are not treated as complete complaints
- **AND** an unavailable newer complaint attachment prevents using an older complaint.
- **AND** the parent entry must itself identify a filed complaint; a proposed complaint attached to a motion for leave is not selected.

#### Scenario: Duplicate unavailable complaint event stub

- **WHEN** an unnumbered complaint has unavailable document metadata with no document number, PACER identifier, source path, hash, or URL
- **AND** its nonempty docket, filing date, filing time, and RECAP sequence exactly match a numbered complaint entry
- **THEN** acquisition excludes that duplicate stub from selection while preserving the raw entries
- **AND** unmatched or incomplete event identities continue to fail closed.

#### Scenario: Source-bound unsummarized review replay

- **WHEN** a verified complaint has an explicit `available_unsummarized` review bound to its docket ID, document ID and number, source page, PDF URL, filing date, SHA-1, SHA-256, and current prompt version
- **THEN** acquisition returns the exact disposition with a null summary, retains the receipt and result, and makes no model call whether source API text is empty or readable
- **AND** the disposition links to the verified PDF and does not require human review
- **AND** mismatched source identity, hash, prompt version, or disposition URL fails visibly
- **AND** existing reviewed summaries and local extraction receipts continue to validate under their existing contract.
