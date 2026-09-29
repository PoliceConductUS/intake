## Why

Ten application tables had no rows in the local database when removal was
authorized. Subsequent source tracing showed federal relationships were filtered
out, not unused. The approved `federal-agency-office-parent` change restores that
functionality as a direct Agency parent FK; the removed join table stays absent.
Website consumers are assigned to another agent.

## What Changes

- **BREAKING:** Drop `agency_links`, `coverage_link_civil_cases`,
  `coverage_link_reports`, `federal_agency_branch`, `location_report_sources`,
  `location_reports`, `review_attachments`, `review_tags`, `review_witnesses`,
  and `tags` in one Supabase migration.
- Apply that migration to the existing local database.
- Remove the corresponding intake model descriptors, manual support, producer
  outputs, graph edges, and resolvers; regenerate envelope contracts and the
  generated request document.

## Capabilities

### New Capabilities

- `empty-table-retirement`: Explicit removal of the ten audited empty tables.

### Modified Capabilities

None.

## Impact

The migration removes these tables and their owned indexes and constraints.
Other tables and data remain. No database reset or production deployment is
required for this local application. The retired seed file remains historical
evidence and is not loaded by the current Supabase configuration.

Website consumers are assigned to another agent. Intake contracts and producers
will no longer support `AgencyLink`, `FederalAgencyBranch`, or
`CoverageLinkCivilCase`. Federal agencies, agency office records, coverage links,
and coverage links to personnel remain supported.
