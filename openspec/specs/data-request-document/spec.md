# data-request-document Specification

## Purpose
TBD - created by archiving change request-raw-activity-data. Update Purpose after archive.
## Requirements
### Requirement: Request raw records and histories

The generated document SHALL omit the derived ArrestProfile record type and include a linked raw source-data model covering CAD calls, units and employees, incidents, stops, searches, citations, arrests, jail admissions and custody episodes, housing, holds, bond, transfers, release, grievances, services, in-custody deaths, use of force, charges, prosecution, court cases, and dated status/outcome history. It SHALL include event demographics and employee badge, title, salary, complaint, commendation, discipline, education, field-training, supervisor, and organization history, beats and historical boundaries, shifts, timesheets, and overtime authorization and earnings, historical GIS shapes, task forces and membership, funding/grants/budgets, expenses/contracts/payments, assets, and a complete maintained-system/table/field catalog.

#### Scenario: Regenerate the provider document

- **WHEN** the generator runs against a schema containing arrest_profile
- **THEN** the output omits ArrestProfile, retains supported provider record definitions, and includes the raw request model with row meanings, field types, source identifiers, link tables, history dates, and delivery conventions

#### Scenario: Accept a native system export

- **WHEN** a source provides a native LERMS, CAD, JMS, court, or HR export
- **THEN** the document requests its product/profile/version, dictionary, identifiers, and crosswalks and treats the model as a coverage and mapping target rather than requiring a custom internal-schema export

### Requirement: Distinguish requests from import contracts

The document SHALL distinguish source-data requests from currently supported database-derived import records, state likely custodians and evidence-based availability, and preserve source meanings and one-to-many relationships. Raw request-model revisions SHALL be identified separately from database migration versions.

#### Scenario: Request data beyond current import support

- **WHEN** a provider reads a raw activity or personnel-history model
- **THEN** the document identifies it as requested source data, permits documented native exports with file-level provenance and field/type mappings instead of custom reshaping, and does not claim automatic canonical import support or universal department availability

### Requirement: Standard request and redaction disclosure

The generated document SHALL provide reusable request text for the maintained data model/catalog and publicly releasable source records covering the preceding five years for the initial request and any records added or changed since the last request for subsequent requests, including changes to older records. It SHALL describe a response-scoped `<redacted:reason-id>` convention, unpadded generated reason IDs such as R1 and R2, a separate reason dictionary preserving custodian explanations and cited authority, and a log for native-format, partial, record, file, attachment, or geometry withholding. The convention SHALL distinguish withholding from unknown or unavailable values without claiming any particular exemption is valid.

#### Scenario: A custodian withholds a field or file

- **WHEN** a response contains inline redaction tokens or omitted records/files
- **THEN** the request describes how to identify the omission and reference its reason separately, preserve native data types via a companion log, and retain missing reasons as visible gaps rather than inventing explanations

### Requirement: IACP checklist and tailored request option

The introduction and reusable request SHALL use native electronic exports as the default and explicitly accept NIBRS and N-DEx-compatible exports. An IACP/IJIS Version IV data-category checklist with chapter references SHALL appear near the top before technical formatting instructions; supplemental requested categories SHALL remain distinguishable from the IACP checklist. IACP SHALL NOT be described as a universal export schema. They SHALL invite the agency to respond with its full data model when a tailored specification would make production easier or less expensive and state that we will submit a new request following the native format as closely as possible.

#### Scenario: Agency prefers a tailored request

- **WHEN** an agency chooses to supply its complete model first
- **THEN** the document describes the tables, fields, definitions, relationships, and export-format information needed to prepare the new request

### Requirement: Quarterly updates and publication partnership

The introduction and reusable request SHALL ask for quarterly exports of records added or changed since the date of the last request and ask the agency to recommend a process, including new requests, recurring requests, or scheduled exports. They SHALL state that data is requested for analysis and publication on PoliceConduct.org and invite useful partnerships, including periodic publication enabling agencies to direct requesters to published records for free.

#### Scenario: Agency considers an ongoing data partnership

- **WHEN** the agency reads the request
- **THEN** it can identify the intended use, requested update cadence and incremental scope, and the invitation to recommend a process and partnership arrangement

### Requirement: Optional simplified format and explicit availability

The document SHALL be titled Public Data Request, begin with the Standard public-data request immediately after the document title, followed by the IACP checklist and coverage guidance before technical format examples, and place the schema-derived Simplified Export Format at the end as an optional appendix for agencies without another export format. It SHALL request explicit dataset and field availability, distinguish no matching records or data not maintained from withholding, and permit header-only CSVs with an availability entry or an explicit entry without a file when columns are unknown. Missing files and blank cells SHALL NOT establish absence or redaction.

#### Scenario: Agency does not hold a requested dataset

- **WHEN** an agency lacks requested data
- **THEN** it can supply a header-only CSV and availability status or an explicit availability entry rather than silently omitting the dataset, without using a redaction marker

### Requirement: Lawful release and prompt redacted production

The opening request SHALL seek only information lawfully releasable to the public under applicable law. It SHALL expressly authorize documented redaction or omission of protected portions and portions for which the agency would otherwise seek an Attorney General decision or other legal ruling, excluding those portions from the current request so the remaining data can be produced promptly without a ruling where permitted by law. It SHALL state a preference for a prompt redacted export and a separate later request for any omitted material the requester decides it needs.

#### Scenario: Some data would require a legal ruling

- **WHEN** the agency identifies portions it would otherwise submit for a ruling
- **THEN** the request authorizes omitting those portions from the current export, documenting them under the redaction specification, and promptly producing the remaining lawfully releasable data, with any later request for the omitted material handled separately

### Requirement: No-cost response and documented cost omissions

The request SHALL seek a response at no cost and authorize no charges. It SHALL permit redaction or omission of portions that would result in a charge, request the remaining free data, and require cost omissions to be documented distinctly from legal withholding and missing data. If nothing can be supplied free, the agency SHALL be asked to notify the requester without incurring charges.

#### Scenario: A requested dataset would incur a charge

- **WHEN** producing a requested portion would result in a charge
- **THEN** the request authorizes its omission, identifies it as omitted for cost with an explanation and reason reference, and asks for the remaining data that can be supplied at no cost

