## ADDED Requirements

### Requirement: Provenance-bearing complaint summary

The system SHALL store AI complaint summaries independently of claims_summary. Only nonblank summary text and an HTTP(S) complaint link (`source.sourcePage`) are required. Other retained provenance metadata is optional; its absence SHALL NOT gate persistence or rendering.

#### Scenario: Summary without extra metadata

- **WHEN** a summary contains text and a complaint link but no hashes, verification flags, model details, dates, paragraph support, limitations, or procedural context
- **THEN** intake accepts it and the website renders it

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

### Requirement: Available complaint without a reliable summary

The system SHALL retain an `available_unsummarized` disposition with the complaint document URL when a copy is available but no reliable summary can be produced. This disposition SHALL NOT be treated as a completed AI summary or require user review. How the complaint is selected and summarized, and what is reported when it cannot be, is specified by `courtlistener-complaint-summaries` in `move-complaint-summaries-to-generate`.

#### Scenario: Complaint cannot be summarized reliably

- **WHEN** a retained complaint cannot be summarized reliably
- **THEN** the case page states "The complaint is available, but we were unable to summarize it." and links to the complaint document
- **AND** the disposition is applied through the final intake run after summary calculation is complete

#### Scenario: Complaint filed as an explicitly labelled attachment

- **WHEN** a docket entry contains an attachment explicitly labelled as the complete complaint and a generic main document
- **THEN** `data generate` selects that complaint attachment ahead of the main document
- **AND** attachments labelled as parties lists or exhibits are not treated as complete complaints
- **AND** an unavailable newer complaint attachment prevents using an older complaint.
- **AND** the parent entry must itself identify a filed complaint; a proposed complaint attached to a motion for leave is not selected.

#### Scenario: Duplicate unavailable complaint event stub

- **WHEN** an unnumbered complaint has unavailable document metadata with no document number, PACER identifier, source path, hash, or URL
- **AND** its nonempty docket, filing date, filing time, and RECAP sequence exactly match a numbered complaint entry
- **THEN** `data generate` excludes that duplicate stub from selection while the cached entries keep it
- **AND** a stub with an unmatched or incomplete event identity is not excluded: the entries are reported as unreadable (`complaint-entries`) and no complaint is summarized.
