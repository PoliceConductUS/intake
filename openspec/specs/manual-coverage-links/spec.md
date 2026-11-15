# manual-coverage-links Specification

## Purpose

TBD - created by archiving change enable-manual-coverage-links. Update Purpose after archive.

## Requirements

### Requirement: Manual coverage article records

The manual source SHALL accept CoverageLink and CoverageLinkAgencyPersonnel records through existing shared validation and SHALL emit their corresponding artifacts with supplied record fields and references unchanged. Acquisition and transformation SHALL NOT mint personnel identities or create personnel records for a supplied existing reference.

#### Scenario: Acquire an article linked to existing personnel

- **WHEN** valid coverage article and agency-personnel relationship records are acquired through the manual source
- **THEN** transformation emits CoverageLinks and CoverageLinkAgencyPersonnel containing the supplied records unchanged
- **AND** the supplied agency_personnel_id remains unchanged
- **AND** no personnel artifact is emitted
