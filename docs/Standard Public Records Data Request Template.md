# Standard Public Records Data Request Template

## Statewide Law-Enforcement Licensing, Employment, Training, Agency, Transfer, FTO, and Data Dictionary Records

## Template Variables

Before sending this request, replace all bracketed variables.

### Request Identity

- `[REQUEST_DATE]`
- `[REQUESTER_NAME]`
- `[REQUESTER_EMAIL]`
- `[REQUESTER_ORGANIZATION]`
- `[REQUESTER_MAILING_ADDRESS]`
- `[REQUESTER_PHONE]`
- `[REQUEST_SUBJECT]`

### State and Agency

- `[STATE_NAME]`
- `[PUBLIC_RECORDS_LAW_NAME]`
- `[PUBLIC_RECORDS_LAW_CITATION]`
- `[AGENCY_NAME]`
- `[AGENCY_ABBREVIATION]`
- `[RECORDS_CUSTODIAN_NAME]`
- `[REQUEST_EMAIL_OR_PORTAL]`

### State Law-Enforcement Standards System

- `[STATE_POST_AGENCY_NAME]`
- `[STATE_POST_AGENCY_ABBREVIATION]`
- `[STATE_LICENSING_SYSTEM_NAME]`
- `[STATE_TRAINING_SYSTEM_NAME]`
- `[STATE_OFFICER_IDENTIFIER_NAME]`
- `[STATE_AGENCY_IDENTIFIER_NAME]`

Examples:

- Michigan: MCOLES, MITN, MCOLES number, MCOLES/MITN agency ID.
- Texas: TCOLE, PID, TCOLE agency number.
- California: POST, POST ID.
- Oregon: DPSST, IRIS, DPSST number.

### State-Specific Context

- `[STATE_PUBLIC_TRUST_DOCUMENTS_OR_LINKS]`
- `[KNOWN_PRIOR_REQUEST_NUMBER]`
- `[KNOWN_PRIOR_AGENCY_STATEMENT]`
- `[KNOWN_EXISTING_EXPORTS]`
- `[KNOWN_PDF_ONLY_EXCLUSIONS]`
- `[KNOWN_MACHINE_READABLE_FORMATS]`

### Request Controls

- `[DATE_RANGE]`
- `[MAX_FEE_WITHOUT_APPROVAL]`
- `[PREFERRED_DELIVERY_METHOD]`
- `[PUBLIC_INTEREST_FEE_WAIVER_TEXT]`
- `[MEDIA_NONPROFIT_RESEARCH_REQUESTER_TEXT]`
- `[STATE_SPECIFIC_ELECTRONIC_FORMAT_TEXT]`
- `[STATE_SPECIFIC_SEGREGATION_TEXT]`
- `[STATE_SPECIFIC_FEE_ITEMIZATION_TEXT]`

---

# Email Template

Subject: `[REQUEST_SUBJECT]`

Good afternoon,

Please treat this as a new public-records request under `[PUBLIC_RECORDS_LAW_NAME]`, `[PUBLIC_RECORDS_LAW_CITATION]`.

I am submitting this request to `[AGENCY_NAME]` because `[AGENCY_NAME]`, `[STATE_POST_AGENCY_NAME]`, `[STATE_POST_AGENCY_ABBREVIATION]`, or related state systems maintain statewide law-enforcement agency, officer, licensing, certification, employment, appointment, training, transfer, and related public records.

This request seeks existing public records in structured, machine-readable form. It does not ask `[AGENCY_NAME]` to create new analysis, summaries, rankings, conclusions, statistics, or narrative explanations.

## 1. Requested Records

I request the broadest existing statewide structured records, exports, tables, reports, spreadsheets, datasets, data dictionaries, code tables, schema documentation, report layouts, field definitions, and export definitions maintained by `[AGENCY_NAME]`, `[STATE_POST_AGENCY_NAME]`, `[STATE_POST_AGENCY_ABBREVIATION]`, `[STATE_LICENSING_SYSTEM_NAME]`, `[STATE_TRAINING_SYSTEM_NAME]`, or related systems concerning:

1. `[STATE_NAME]` law-enforcement agencies tracked by `[STATE_POST_AGENCY_ABBREVIATION]` or related systems;
2. current and former licensed, registered, certified, appointed, employed, separated, inactive, suspended, revoked, expired, or otherwise tracked law-enforcement officers or personnel;
3. officer/personnel roster, license, certification, appointment, employment, separation, transfer, and agency-history records;
4. training and continuing-education records;
5. Field Training Officer, trainee, probationary officer, supervision, and training-assignment relationship records, if maintained in structured form;
6. in-state transfer, out-of-state transfer, reciprocity, waiver, equivalency, prior-certification, and prior-law-enforcement-employment records, if maintained in structured form;
7. license-action, disciplinary, decertification, suspension, revocation, reinstatement, restriction, complaint, investigation, or accountability records, to the extent maintained in structured public form; and
8. data dictionaries, code tables, schema documentation, field definitions, table layouts, report layouts, export definitions, and documentation needed to interpret the produced data.

## 2. Date Range

For this request, please produce records covering the past five years, plus the most current available statewide agency roster, officer/personnel roster, license/certification status records, employment/appointment status records, training records, FTO records, transfer records, and related data dictionaries or code tables.

For purposes of this request, “past five years” means records created, submitted, effective, completed, updated, changed, approved, denied, expired, closed, separated, transferred, revoked, suspended, reinstated, or otherwise modified during the five-year period preceding the date of this request.

If a record was created before the five-year period but remained active, current, effective, open, reportable, or necessary to understand a record changed during the five-year period, please include the record or the minimum fields necessary to interpret the current or changed record.

## 3. Preferred Format

Please produce responsive records in the native or reasonably exportable electronic format in which they are maintained, including CSV, XLS, XLSX, JSON, XML, TXT, fixed-width text, database export, ZIP file, or another structured format with field names preserved.

Please do not convert structured electronic records into PDF.

Please do not provide scanned records, image files, or PDFs for records that exist in structured electronic form.

## 4. Existing Exports First

Please identify and produce the broadest existing statewide export, report, table, dataset, or query output that contains responsive public fields, even if it does not include every requested field.

If multiple exports or reports exist, please produce the set of existing exports that requires the least manual review and best preserves the structure of the underlying data.

If there is uncertainty about scope, cost, or available exports, please produce data dictionaries, field lists, schema documentation, report layouts, table names, export names, and code tables first so I can further narrow the request.

## 5. Agency Records

For each agency, please include all public structured fields maintained, including, if maintained:

- agency name;
- agency type;
- agency status;
- `[STATE_AGENCY_IDENTIFIER_NAME]`;
- ORI number;
- NCIC number;
- public mailing address;
- public physical address;
- city;
- county;
- state;
- ZIP code;
- public phone number;
- public email address;
- website;
- social media accounts;
- agency head, chief, sheriff, executive, or public contact;
- parent agency;
- predecessor agency;
- successor agency;
- date added;
- date approved;
- date activated;
- date inactivated;
- date closed;
- merger or consolidation information; and
- any other public structured fields sufficient to uniquely identify and distinguish agencies.

## 6. Officer / Personnel Records

For each officer or other tracked person, please include all public structured fields maintained, including, if maintained:

- name;
- `[STATE_OFFICER_IDENTIFIER_NAME]`;
- public unique identifier;
- POST number;
- license number;
- certification number;
- personnel identifier;
- roster identifier;
- current or most recent agency;
- agency identifier;
- license or certification status;
- status dates;
- date first licensed or certified;
- effective dates;
- expiration dates;
- appointment dates;
- employment or service start dates;
- separation or end dates;
- separation type or code, if public;
- transfer dates;
- prior agency;
- receiving or new agency;
- transaction effective dates;
- transaction submitted dates;
- transaction status; and
- license, certification, employment, or status before and after each structured transaction.

## 7. Training and Continuing-Education Records

For training and continuing-education records, please include all public structured fields maintained, including, if maintained:

- officer/person identifier;
- officer name, if public;
- agency identifier;
- agency name;
- course name;
- course code;
- training category or topic;
- provider;
- training date;
- completion date;
- hours or credits;
- completion/pass/fail status;
- continuing-education credit;
- mandatory-training indicator;
- compliance period;
- requirement satisfied;
- expiration date, if any; and
- any structured indicators for crisis intervention, de-escalation, use of force, firearms, ethics, supervision, wellness, bias, civil rights, community policing, misconduct prevention, accountability, or related training categories.

## 8. FTO, Trainee, Supervision, and Training-Relationship Records

Please include any structured fields, tables, transaction records, history records, relationship records, or code tables showing:

- Field Training Officer or FTO status;
- FTO assignment history;
- trainee/probationary officer assignment history;
- FTO-to-trainee relationships;
- supervising officer or training supervisor relationships;
- agency, academy, or training-program identifiers associated with FTO assignments;
- FTO assignment start dates;
- FTO assignment end dates;
- probationary or field-training completion dates;
- FTO-related status codes;
- result codes;
- completion codes; and
- related lookup tables, code tables, or data dictionaries.

## 9. Transfers, Reciprocity, Waivers, and Prior Certification

Please include any structured fields, tables, transaction records, history records, relationship records, or code tables showing:

- transfers between agencies;
- transfers into `[STATE_NAME]` from another state;
- transfers out of `[STATE_NAME]` to another state, if maintained;
- prior out-of-state law-enforcement certification;
- prior out-of-state law-enforcement license;
- prior out-of-state law-enforcement employment;
- prior academy records, if maintained in structured form;
- reciprocity records;
- waiver records;
- equivalency records;
- recognition of prior certification or training;
- sending state;
- receiving state;
- prior agency;
- receiving agency;
- transaction dates;
- effective dates;
- approval dates;
- denial dates; and
- status codes for transfer, reciprocity, waiver, equivalency, or prior-certification review records.

## 10. Discipline, License Action, Accountability, and Compliance Records

Please include license-action, disciplinary, decertification, suspension, revocation, reinstatement, restriction, complaint, investigation, accountability, agency-compliance, audit, certification, policy-compliance, or training-compliance records only to the extent they are maintained in structured public form or can be included in an existing structured export.

This request does not ask `[AGENCY_NAME]` to manually search individual PDF-only files, scanned files, image files, paper files, or narrative files for this category unless needed to identify a structured table, export, field list, data dictionary, report layout, export definition, or code table.

`[KNOWN_PDF_ONLY_EXCLUSIONS]`

## 11. Data Dictionaries and Interpretive Records

Please provide all existing records needed to interpret the produced data, including:

- data dictionaries;
- schema documentation;
- table names;
- field names;
- field definitions;
- report layouts;
- export definitions;
- code tables;
- lookup tables;
- status-code definitions;
- transaction-code definitions;
- agency-type definitions;
- separation-code definitions;
- training-category definitions;
- license-status definitions;
- certification-status definitions;
- discipline or license-action code definitions;
- field-value descriptions; and
- documentation describing how tables, identifiers, or records relate to each other.

## 12. Public and Nonpublic Fields

I am not requesting private identity data such as Social Security numbers, home addresses, personal phone numbers, personal email addresses, dates of birth, driver’s license numbers, medical records, or similar nonpublic information.

Please redact, omit, mask, suppress, or replace nonpublic fields as necessary and produce all reasonably segregable public fields and rows.

Please do not withhold an entire table, export, row, or record merely because one field may be exempt or nonpublic.

If a field is withheld, redacted, omitted, renamed, coded, masked, suppressed, or replaced with a code, please identify the field name, provide a brief description of the withheld or altered field, and provide the legal basis for the withholding, redaction, omission, alteration, coding, masking, or suppression.

`[STATE_SPECIFIC_SEGREGATION_TEXT]`

## 13. Prior Productions

Please identify whether `[AGENCY_NAME]`, `[STATE_POST_AGENCY_NAME]`, `[STATE_POST_AGENCY_ABBREVIATION]`, `[STATE_LICENSING_SYSTEM_NAME]`, `[STATE_TRAINING_SYSTEM_NAME]`, or another state custodian has previously produced any of the same or substantially similar records, exports, tables, datasets, reports, field lists, data dictionaries, or code tables in response to another public-records request, media request, academic request, legislative request, interagency request, data-sharing request, or public-data publication.

For any such prior production known to the records custodian or reasonably identifiable without a separate burdensome search, please provide:

- date of prior production;
- request or tracking number, if public;
- general description of records produced;
- format produced;
- whether production was statewide or agency-specific;
- whether the same export, report, table, or dataset can be reused for this request;
- fee charged, if any;
- basis for any fee charged; and
- whether the records were produced at no charge, reduced charge, or as part of a routine export.

If the agency contends that this section is itself a separate request requiring additional search or review, please do not delay production of the underlying data. Instead, produce the underlying data first and separately identify any additional time, cost, or search the agency believes would be required to answer this section.

## 14. State-Specific Public Interest Context

`[STATE_PUBLIC_TRUST_DOCUMENTS_OR_LINKS]`

The public value of these records is substantial. Structured statewide agency, officer, licensing, employment-history, transfer, FTO, and training records allow the public to understand the law-enforcement workforce, training, licensure, mobility, agency structure, and public-accountability infrastructure.

`[PUBLIC_INTEREST_FEE_WAIVER_TEXT]`

`[MEDIA_NONPROFIT_RESEARCH_REQUESTER_TEXT]`

## 15. Narrowing and Clarification

If any part of this request is unclear, overbroad, or difficult to fulfill as written, please contact me before denying, delaying, or materially narrowing the request so I can clarify, prioritize, or narrow it.

Please process all clear portions of the request while clarification is pending on any unclear portion.

Please do not treat examples of fields as limiting the request. The request includes the listed fields and any substantially similar public structured fields maintained by the agency or related systems.

## 16. Cost Control

Please use the lowest-cost method available to produce the records.

Please use the lowest-paid employee capable of performing each necessary task.

Before performing any work that would materially increase the fee, please identify:

- the work;
- the records affected;
- the estimated cost;
- the reason the work is necessary; and
- any lower-cost alternative.

If a fee is assessed, please provide an itemized estimate separating:

1. structured data export or report-generation time;
2. programming, query, or technical extraction time;
3. redaction time for structured fields;
4. duplication or transmission cost;
5. legal review time, if any;
6. time associated with identifying prior productions, if any; and
7. any other category of work.

If the estimated fee exceeds `[MAX_FEE_WITHOUT_APPROVAL]`, please do not incur the fee without my written approval. Instead, please identify specific fields, tables, date ranges, record categories, exports, or formats that could be omitted or narrowed to materially reduce the fee.

`[STATE_SPECIFIC_FEE_ITEMIZATION_TEXT]`

## 17. Rolling Production

I agree to rolling production.

Please produce easier structured exports, data dictionaries, field lists, code tables, and existing reports as they become available. Please do not delay production of easier records while evaluating more difficult categories.

## 18. Delivery

Please provide records by `[PREFERRED_DELIVERY_METHOD]`.

If upload size is an issue, please contact me and I can provide a secure upload location.

Thank you,

`[REQUESTER_NAME]`
`[REQUESTER_ORGANIZATION]`
`[REQUESTER_EMAIL]`
`[REQUESTER_PHONE]`
`[REQUESTER_MAILING_ADDRESS]`
