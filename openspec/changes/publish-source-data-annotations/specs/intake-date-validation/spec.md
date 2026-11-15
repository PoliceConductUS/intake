## REMOVED Requirements

### Requirement: Temporarily omit records with invalid source dates

**Reason**: Retain source-reported dates and records, classifying contradictions as errors and unusual/future dates as warnings instead of omitting records.

**Migration**: Implement the `source-data-annotations` requirements and regenerate affected source mutations from preserved inputs before publishing the annotation site. This removal SHALL take effect with that implementation, not with this proposal or archival of the predecessor change. Existing canonical identities, raw evidence and applied correction provenance SHALL be retained.
