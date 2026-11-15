## REMOVED Requirements

### Requirement: Invalid source contact values are omitted visibly

**Reason**: Preserve original contact values and their owning records with public annotations rather than omitting values, records and dependents.

**Migration**: Implement the `source-data-annotations` requirements and regenerate affected source mutations from preserved inputs before publishing the annotation site. This removal SHALL take effect with that implementation, not with this proposal or archival of the predecessor change. Existing canonical identities, raw evidence and applied correction provenance SHALL be retained.

### Requirement: Explained CLI corrections

The cache set and unset commands SHALL require a message with at least 10 characters after trimming whitespace. Missing, null or blank messages SHALL be rejected before any correction is written. The explanation SHALL be stored in the correction envelope and propagated to its annotation.

#### Scenario: Meaningful explanation

- **WHEN** an operator supplies a valid message to set or unset
- **THEN** the trimmed message is retained in the correction and annotation
- **AND** command provenance records the message argument
