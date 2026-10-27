## REMOVED Requirements

### Requirement: Invalid source contact values are omitted visibly

**Reason**: Preserve original contact values and their owning records with public annotations rather than omitting values, records and dependents.

**Migration**: Implement the `source-data-annotations` requirements and regenerate affected source mutations from preserved inputs before publishing the annotation site. This removal SHALL take effect with that implementation, not with this proposal or archival of the predecessor change. Existing canonical identities, raw evidence and applied correction provenance SHALL be retained.
