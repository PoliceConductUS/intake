## Raw source-data request model

**Request-model revision: `2026-09-28.1`.** This revision identifies the requested
source-data model independently of the Simplified Export Format version in the appendix. These are
requested export tables, not implemented database tables or canonical envelope
kinds. Native exports with a field mapping are welcome; agencies do not need to
compute our summaries or reshape their systems to match these names.

Request the existing record-level data for the specified historical date range,
including closed cases, former employees, and released people, plus subsequent
corrections and updates. Record the requested range and delivered coverage for
each dataset. Include all maintained fields, code tables, and record relationships;
the fields below identify the reporting priorities, not a maximum field list.

### Data availability

Please account for each requested dataset, including ones you do not have, in
`availability.csv` or an equivalent table. Add field-level entries when particular
requested fields are not supplied. This accompanies either native files or the
Simplified Export Format; it does not require changing your source system.

| Field                        | Meaning                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `dataset`                    | Requested category or source table/layer name.                                          |
| `field`                      | Field name for a field-level entry; blank for a whole dataset.                          |
| `file`                       | Delivered filename, including a header-only CSV; blank if no file is supplied.          |
| `status`                     | One of the availability statuses below.                                                 |
| `period_start`, `period_end` | Dates the statement covers, when applicable.                                            |
| `details`                    | Explanation, known custodian, or details of the gap.                                    |
| `reason_id`                  | Reason ID for legal redaction or a cost-based omission, when supplied; otherwise blank. |

| Status               | Meaning                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provided`           | The requested data is included.                                                                                                                       |
| `no_records`         | This dataset is maintained, but there are no matching records for the stated period. For quarterly updates, there may be no added or changed records. |
| `not_maintained`     | The agency does not collect or maintain this dataset or field.                                                                                        |
| `not_held`           | The agency does not hold it; identify another custodian if known.                                                                                     |
| `unavailable`        | The data cannot be supplied for another stated reason, such as unavailable historical records. Explain rather than treating it as zero records.       |
| `withheld`           | The data is being withheld from release. Reference the redaction reason and log.                                                                      |
| `omitted_cost`       | The specified data is omitted to keep the response free. Document the affected portion and charge explanation.                                        |
| `partially_withheld` | Some data is supplied and some is withheld. Identify the affected portions in the redaction log.                                                      |

Use `omitted_cost` for a dataset, field, or portion excluded because producing it
would result in a charge. Identify the affected portion in `details` and the
redaction log, and link its reason ID. This status does not mean the data is
confidential, absent, or not maintained. If part is provided, list that part as
`provided` and identify the cost-based omission separately.

For `no_records` or `not_maintained`, a **header-only CSV** may be supplied if the
columns are known. List it in the file inventory with **0 data rows** and include
its availability status. Do not add a fake record saying “no data.” If the columns
are unknown, provide an availability entry without a file; there is no need to
invent a schema. An explicit availability entry is also acceptable with a native
export that does not produce empty files.

Example availability entries:

```csv
dataset,field,file,status,period_start,period_end,details,reason_id
PersonnelEducation,,request.PersonnelEducation.csv,not_maintained,,,We do not maintain education records,
Commendation,,,not_held,,,Held by the city personnel office,
```

The corresponding header-only `request.PersonnelEducation.csv` could contain:

```csv
id,personnel_id,name,completion_date,credits,sponsor_name,sponsor_instructor
```

A withheld dataset must use `withheld`, not `no_records` or `not_maintained`.
A file with 0 released rows does not establish that 0 records exist. A missing
file, blank cell, or absent relationship is an unexplained gap until the agency
identifies its availability or redaction status. Do not use `<redacted:R1>` for
information that was never collected or is not held.

### Redaction markers and reasons

This is a proposed delivery convention, not an assertion that any particular
field is exempt or that a cited reason is valid. The producing custodian supplies
the explanations and authorities. The same documentation can identify omissions
made to keep the response free, using a cost reason rather than a legal withholding
reason. It does not require changing the native system.

**Field marker:** `<redacted:reason-id>`, for example `<redacted:R1>`. Reason IDs
are case-sensitive opaque text, unique within one response, using letters,
numbers, underscores, or hyphens. Use unpadded sequences such as `R1`, `R2`,
`R3` for newly assigned reason IDs. The same ID must mean the same reason throughout
that response. A request/response ID scopes the dictionary; do not assume `R1`
means the same thing in different responses.

**Reason dictionary — `redaction-reasons.csv` (or equivalent JSON/native table):**

| Field                | Meaning                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `reason_id`          | The ID in the marker or log, such as `R1`.                                                                                               |
| `category`           | `legal` for legal redaction or `cost` for an omission to keep the response free.                                                         |
| `description`        | The custodian's explanation of what is withheld and why.                                                                                 |
| `authority`          | The precise statute, rule, order, or other authority cited by the custodian, including the subsection or document reference it supplies. |
| `authority_url`      | Link to the cited authority, when supplied.                                                                                              |
| `decision_date`      | Date of the withholding decision, when maintained.                                                                                       |
| `decision_reference` | Source response letter, ruling, or other decision reference, when supplied.                                                              |

For a cost reason, describe the work or portion that would incur a charge and
include any already available estimate in the description. Use `category: cost`
and `omitted_cost` in the availability table; do not invent a legal exemption or
ruling. The authority field may be blank for cost reasons. A marker such as
`<redacted:R2>` can reference that cost reason, with the affected portion recorded
in the log.

Include one dictionary row for every referenced reason ID. Keep the custodian's
wording and citations intact. If no reason or authority is supplied, record that
fact rather than inventing one. A reason can cite multiple authorities; multiple
separate reasons for one omission can be represented by multiple log rows.

**Redaction log — `redactions.csv` (or equivalent JSON/native table):**

| Field            | Meaning                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `file`           | Inventory file/dataset/attachment/layer identifier.                                                                                      |
| `scope`          | `field`, `record`, `file`, `attachment`, or `geometry`.                                                                                  |
| `record_locator` | Releasable source key or export-local opaque locator; leave empty for a whole-file omission. It must not disclose a withheld identifier. |
| `field_or_path`  | Column, JSON path, geometry field, or attachment location; empty when the scope is a whole record/file.                                  |
| `reason_id`      | A reference to the response's reason dictionary.                                                                                         |
| `extent`         | Full/partial omission, count or date range when supplied and releasable; identify counts that were not supplied.                         |
| `source_notice`  | The custodian's original notice or explanation reference.                                                                                |

Use a companion log for omitted rows/files and for native formats where inserting
a token would alter a typed field or geometry. A native export with its own
redaction conventions remains usable with a documented mapping. For an export
that supports inline tokens, the token is a **string**, even in a normally numeric
or date field; retain the field's original type in the dictionary. A JSON token
must be quoted. A CSV token occupies the field value, using normal CSV quoting.
Never coerce the token to zero, false, an empty string, or a date.

Use the token as the complete field value. Partial redactions should retain the
released content and describe the omitted portion in the log. Record existing
geographic generalization (for example, block-level location) and its reason in
the log rather than presenting it as exact coordinates. Do not synthesize
replacement geometry. Literal source text matching the token syntax remains
literal unless the producer identifies it as a redaction in its documented
convention or log.

Keep the reasons file and log in the delivery inventory. Report undefined reason
IDs, missing locators, and unmatched log references as delivery gaps. A completely
withheld dataset may have an inventory/log entry without a data file. An absent
file, blank cell, null, or missing linked record alone does not establish redaction.
Retain the original source package and redaction metadata alongside any later
mapping so exclusions remain visible in reporting denominators.

### Request a complete data catalog and the releasable source records

Request both the system/data catalog and the underlying releasable records for
the requested period. The catalog should identify **all** maintained datasets,
including legacy/retired systems, optional modules, attached documents, and data
held by contractors or partner agencies. Do not restrict it to the examples here.
For each dataset request:

- System/vendor/module/version, custodian, table/file/layer name, description,
  row meaning, fields/types, keys, relationships, code lists, and export formats.
- Earliest/latest available dates, historical versions, refresh cadence,
  retention schedule, known migrations/gaps, and record counts when maintained.
- Available APIs, bulk downloads, reports, native exchange profiles/schemas,
  GIS layers, document/media indexes, and linked attachments.
- Which data was supplied, not maintained, held elsewhere, unavailable, or
  withheld, with the source's stated explanation and releasable remainder.

This is a request for maintained source records and their documentation, not for
an agency to create new analytics. Preserve additional fields and modules even
when no reporting or canonical import mapping exists yet.

### What agencies are likely to track, and who holds it

These are evidence-based starting points for requests, not a finding that every
department maintains or releases every field. Confirm each source's system,
available years, export capability, and actual custodian.

| Data family                                                                   | Likely system / custodian                                                         | Evidence and availability boundary                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calls, dispatch, unit activity, incidents, arrests, citations, investigations | Dispatch center CAD and police/sheriff records management system (RMS)            | [DOJ/BJA RMS functional specifications](https://bja.ojp.gov/sites/g/files/xyckuh186/files/media/document/lawenforcementrmsv2.pdf) describe operational records and exchanges with CAD, prosecutors, courts, jail, and HR systems. A functional standard is not proof that a particular agency implemented every module.                                               |
| Offense and arrest demographics                                               | RMS / state crime-reporting program                                               | [FBI NIBRS manual](https://fbibiospecs.fbi.gov/biometric-specifications-1-1/crime-and-law-enforcement-statistics-unit-document-review/nibrs-user-manual-version-2025-0.pdf) documents incident, offense, victim, offender, and arrestee information, including age, sex, race, and ethnicity. NIBRS alone does not supply the full CAD-to-court or personnel history. |
| Charging decisions, prosecutions, hearings, dispositions                      | Prosecutor case-management system and court clerk                                 | [California court case-management data specifications](https://courts.ca.gov/system/files/file/ceac-20210127-jbsiss-materials.pdf) illustrate case identifiers, charges, procedural dates, dispositions, and defendant status. Request prosecution decisions from the prosecutor and court events from the court; police may hold only a subset or returned status.   |
| Jail population, admissions, release, custody status, demographics, staffing  | Jail management system (JMS), sheriff/corrections, and relevant service providers | [BJS jail data collection](https://bjs.ojp.gov/data-collection/annual-survey-jails-asj) establishes these as jail reporting categories. Detailed housing, restriction, grievance, healthcare, and movement logs are additional request targets to verify locally; national statistical categories do not establish local export fields.                               |
| Employee pay and job titles                                                   | Municipal/county HR and payroll                                                   | [Chicago payroll export](https://catalog.data.gov/dataset/employee-payroll-data-fmps-payroll-costing) demonstrates employee, pay-element, pay-period, department, and job-title data. Historical base rates, benefits, and assignment changes may require separate HR tables.                                                                                         |
| Complaints, allegations, findings, discipline                                 | Internal affairs / professional standards / civilian oversight / HR               | [Seattle complaint dataset](https://catalog.data.gov/dataset/office-of-police-accountability-complaints) publishes allegation-level records linked to complaints and employees. Distinct allegations and employees can produce multiple rows for one complaint.                                                                                                       |
| FTO assignments and evaluations                                               | Training unit / academy / field-training system                                   | [California POST field-training materials](https://post.ca.gov/field-training-program) include daily observation and narrative evaluations. Trainer-trainee relationships and dated evaluations are concrete request targets; other jurisdictions may use different forms and systems.                                                                                |
| Commendations, qualifications, supervisors, organization history              | Personnel, training, command, HR, and award records                               | Request the maintained records and dated charts; availability of historical relationships and machine-readable fields must be confirmed with the custodian.                                                                                                                                                                                                           |

GIS records normally require the GIS/data-services custodian as well as operations.
Task-force, funding, purchasing, and expense records may be held by partner
agencies, finance, procurement, grant administrators, or contractors. Federal
award identifiers and transaction history are also available through
[USAspending's documented exports](https://www.usaspending.gov/data/Federal-Spending-Guide.pdf);
those records do not replace local budgets, expenditure ledgers, or supporting invoices.

### Native exports and tailored requests

Use native electronic exports by default. NIBRS exports and N-DEx-compatible
data are also accepted with their exact profile/version and documentation.
Use IACP/IJIS LERMS as a coverage checklist, supplemented by the jail, personnel,
financial, and other data described below. If the agency prefers a request tailored
to its systems to reduce effort or cost, ask it to respond with its full data model:
system/module inventories, all available tables and fields, definitions, keys,
relationships, code lists, and native export formats. We will then submit a new
request following that native format as closely as possible.

Accept existing LERMS/RMS, CAD, JMS, prosecutor/court, HR/payroll, and training-system
exports with their dictionaries and documented relationships. Use the model below
as a coverage checklist and mapping target, not a requirement to rebuild the
agency's data in our internal database shape.

The [IACP/IJIS LERMS functional specifications, Version IV (2025)](https://www.theiacp.org/resources/standard-functional-specifications-for-record-management-systems)
are a reference for system capabilities, not a single universal export-file schema.
Ask for the product/vendor, module, version, native table definitions, code lists,
and identifier crosswalks. If an agency offers a standardized exchange, request
its exact standard/profile/version and schema alongside the payload; a label such
as “LERMS,” “NIEM,” or “NIBRS” alone does not define a complete export contract.
Where an existing N-DEx/NIEM exchange is available, request that documented
payload and its profile/version as well; the LERMS specifications describe N-DEx
sharing of calls, incidents, arrests, collisions, citations, and bookings.
A crime-reporting export alone does not cover payroll, field training, full jail
operations, or prosecution/court history. Receipt and preservation of a native
export are separate from implementing and validating its canonical import mapping.

### Delivery, identifiers, and field types

- Prefer UTF-8 CSV with headers, one file per table and one record per row; JSON
  or native XLSX tables are also usable. Supply underlying tables and linked
  records, not only PDFs, dashboards, totals, or precomputed profiles.
- Include a file inventory with request ID, request-model revision, source system,
  custodian, file/table name, row count, covered dates, extraction timestamp, and
  field mapping. This accompanies raw files; it is not a canonical intake envelope.
- Include dictionaries, lookup codes and meanings, table keys, relationship
  definitions, timezone, timestamp precision, monetary units, and code changes
  over time. Preserve native IDs and values. Native fields need no `x-` prefix in
  these raw exports; the prefix rule in the appendix applies to the Simplified Export Format.
- For each row, the mapping must establish `source_namespace`, `source_system`,
  `source_record_id`, and `agency_id` or the corresponding custodian/organization
  ID. Shared provenance may come from the file inventory; native rows do not need
  these added columns. Identity is the
  namespace + system + table + source record ID, not a name or badge number.
  Supply native compound keys when there is no single record ID.
- The following types and names are mapping targets, not a requirement to alter
  native exports. Preserve native columns, types, values, and date encodings with
  their documented meanings. All IDs, numbers used as identifiers, codes, badge numbers, docket numbers,
  and postal codes are **text**, preserving leading zeros. Dates are
  `YYYY-MM-DD`; timestamps are ISO 8601 with offset where available. Preserve
  source timezone/precision separately if timestamps have no offset. Ages,
  counts, and sequence numbers are integers; amounts, rates, hours, credits,
  and coordinates are decimal numbers; recorded yes/no values are booleans.
  Descriptions, reasons, statuses, categories, and narratives are text with
  their source codes. Do not silently convert unknown values to false or zero.
- Include source-created/source-updated timestamps and record revision or
  correction/deletion indicators when maintained. Map historical interval fields to
  `effective_from` and `effective_to`; an absent end date means open only when
  the source defines it that way. Preserve previous states and their dates.
- An `_id` reference uses the source's original identifier. Include its target
  namespace/system/table when different or ambiguous. Supply existing crosswalks
  between systems; leave missing links visibly unresolved rather than matching
  by names, dates, locations, or badge numbers alone.
- Include the [availability table](#data-availability) for requested datasets and
  missing fields. Distinguish not collected, unknown, not applicable,
  redacted/withheld, and unavailable history. Supply releasable fields and
  identify the remaining gaps. Do not invent missing values or events.

### Activity, enforcement, prosecution, and court records

The reporting path is call for service → incident/stop → arrest or citation →
referral/prosecution → court case → charge disposition and status history.
This is a relationship graph: calls may end without enforcement, citations may
proceed directly to court, and multiple incidents, people, charges, and cases may
be connected. Retain the actual links and dates at each stage.

The fields in these tables are requested when maintained. Common provenance and
identity fields above apply to every row. A semicolon-separated field list below
describes separate columns, not a packed string value.

| Requested table       | One row represents                                       | Requested fields in addition to common identity/provenance                                                                                                                                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CallForService`      | One CAD call/event                                       | `call_id`; native incident number; received/created/closed timestamps; call origin (911, non-emergency, officer-initiated, other); initial/final call type; initial/final priority; disposition; address/location; latitude/longitude and coordinate reference system; beat/district; related/duplicate call ID; releasable call narrative                               |
| `CallEvent`           | One timestamped CAD event/change                         | `call_id`; sequence; event type; event timestamp; old/new priority, call type, status, or disposition; unit ID; employee ID; recorded comment                                                                                                                                                                                                                            |
| `UnitResponse`        | One unit dispatch/response interval on a call            | `call_id`; unit ID; assigned/dispatched/en-route/arrived/cleared/cancelled timestamps; response role; status; cancellation reason                                                                                                                                                                                                                                        |
| `UnitStaffing`        | One employee assigned to a unit for an interval          | unit ID; employee ID; badge as recorded; assignment role; shift ID; effective start/end; supervisor ID if maintained                                                                                                                                                                                                                                                     |
| `Incident`            | One RMS incident/report                                  | `incident_id`; report number; occurred start/end; reported timestamp; location/beat/district; report type; narrative; investigation status; clearance type/date/reason; assigned investigator and approving supervisor identifiers                                                                                                                                       |
| `ActivityPerson`      | One person's involvement in an activity                  | activity table/ID; source person ID; role (caller, victim, witness, suspect, stopped person, arrestee, defendant, detained person); age at event; race; ethnicity; recorded sex and gender as separate source fields; demographic collection method; residency category; recorded disability, language/interpreter need, or behavioral-health indicators when maintained |
| `ActivityPersonnel`   | One employee's role in an activity                       | activity table/ID; employee ID; badge/unit as recorded; role (dispatch, responding, arresting, assisting, investigating, booking, approving, supervising); involvement start/end                                                                                                                                                                                         |
| `Stop`                | One traffic or pedestrian stop                           | `stop_id`; person/vehicle source IDs; start/end timestamps; location; reason/basis; initial suspected violation; outcome; warning/citation/arrest identifiers; recorded consent and demographic-perception timing where maintained                                                                                                                                       |
| `Search`              | One search of a person, vehicle, or property             | `stop_id` or incident link; subject/person ID; search timestamp; search scope/type; legal basis as recorded; consent requested/given; warrant ID; contraband found; item/recovery references; outcome                                                                                                                                                                    |
| `Citation`            | One ticket/citation/warning                              | `citation_id`; ticket number; recipient source person ID; issued timestamp; issuing employee ID; citation/warning type; service method; scheduled appearance; court ID; status and status date                                                                                                                                                                           |
| `Arrest`              | One arrest event for one person                          | `arrest_id`; person ID; arrest timestamp/location; arrest type/basis as recorded; warrant ID; arrest disposition (citation/release/transport/booking); arresting agency; arrest and booking identifiers/crosswalks                                                                                                                                                       |
| `Charge`              | One offense/charge at a specified stage                  | `charge_id`; person ID; stage (reported, arrest, citation, referred, filed, amended, disposed); statute/code and version; description; offense level/class; attempt/completion; count/sequence; offense date range; recorded timestamp; predecessor/superseding charge ID; originating charge ID                                                                         |
| `ActivityCharge`      | One link between a charge and an activity                | charge table/ID; activity table/ID (incident, arrest, citation, booking, referral, prosecution, or court case); link role; effective dates                                                                                                                                                                                                                               |
| `ProsecutionReferral` | One submission to a prosecutor                           | referral ID; prosecutor office; submitting agency; submitted/received timestamps; originating activity links; referred charge links; defendant source person ID                                                                                                                                                                                                          |
| `ProsecutionCase`     | One prosecutor file                                      | prosecution ID/file number; prosecutor office; defendant source person ID; assigned prosecutor ID/name as recorded; opened/closed dates; source status; linked referral and court case identifiers                                                                                                                                                                       |
| `ProsecutionDecision` | One dated decision on a referral or charge               | referral/prosecution ID; charge ID; decision (accepted, declined, returned, diverted, amended, dismissed, or source value); decision date; reason code/text; deciding actor; source document reference                                                                                                                                                                   |
| `CourtCase`           | One court docket/case                                    | court case ID/number; court and jurisdiction; case type; filed/closed dates; defendant source person ID links; prosecutor file number; current status and as-of date; judge and counsel identifiers/roles when maintained                                                                                                                                                |
| `CourtEvent`          | One docket, hearing, plea, order, trial, or appeal event | court case ID; charge/person IDs where applicable; event type; scheduled and actual timestamp; result; plea/verdict as recorded; continuance reason; order/document reference; appeal case link                                                                                                                                                                          |
| `ChargeDisposition`   | One dated disposition of a charge for a defendant        | court/prosecution case ID; charge ID; defendant source person ID; disposition code/text/date; dismissal reason; conviction/acquittal/diversion result; original/amended charge references; sentence/order ID                                                                                                                                                             |
| `Sentence`            | One sentence/order component                             | case ID; defendant source person ID; charge ID; imposed date; component type (custody, probation, fine, restitution, other); amount/currency; duration/unit; suspended portion; credit for time served; concurrent/consecutive relationship; start/end; modification/order references                                                                                    |
| `StatusHistory`       | One recorded status transition                           | target table/ID; previous/new status; effective timestamp; recorded timestamp; reason; actor ID; source document reference. Use for investigation, citation, prosecution, case, charge, custody, and personnel processes where history is maintained.                                                                                                                    |
| `RecordLink`          | One documented relationship between source records       | from namespace/system/table/ID; to namespace/system/table/ID; relationship type; effective dates; source crosswalk/document reference. Preserve many-to-many links and system-specific case numbers.                                                                                                                                                                     |

Keep source person identifiers available for joins without requiring names,
addresses, or dates of birth for demographic analysis. Age is age at the event,
not current age. Request source-supplied anonymous linkage keys where personal
identifiers are withheld. A missing court outcome does not mean dismissal, and
police clearance is distinct from prosecution or court disposition.

### Jail, detention, and custody records

Include municipal holding facilities, county/regional jails, and contracted
facilities relevant to the requested agencies. Ask the facility operator and,
where applicable, the healthcare or other service custodian for their own tables.

| Requested table       | One row represents                                 | Requested fields in addition to common identity/provenance                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CustodyFacility`     | One facility                                       | facility ID; name; operator/agency; address; facility type; operating dates; capacity and capacity as-of date                                                                                                                                                                                                                                                                                                              |
| `Booking`             | One admission/booking episode                      | booking ID/number; source person ID; facility ID; linked arrest IDs; arrival, custody-acceptance, booking-start, booking-complete timestamps; admission type/reason; committing/transporting agency; booking employee; recorded age/race/ethnicity/sex/gender; legal/conviction status at admission                                                                                                                        |
| `CustodyHold`         | One hold, commitment, or detainer                  | booking ID; hold ID; requesting authority; type/basis; related charge, warrant, or case ID; lodged/effective/satisfied/lifted timestamps; current status                                                                                                                                                                                                                                                                   |
| `BondEvent`           | One bond/bail order, change, or posting            | booking/case/charge IDs; event type/date; bond type; ordered amount/currency; posted amount/time; nonmonetary conditions as recorded; decision-maker; source order; status                                                                                                                                                                                                                                                 |
| `CustodyMovement`     | One movement/transport                             | booking ID; departed/arrived timestamps; origin/destination facility and housing IDs; movement type (admission, housing, court, medical, transfer, return, release); reason; transporting and receiving staff/agency; linked next booking ID                                                                                                                                                                               |
| `HousingAssignment`   | One housing/classification interval                | booking ID; facility/unit/cell; classification and reason; effective start/end; assigning/reviewing employee; review date/result                                                                                                                                                                                                                                                                                           |
| `CustodyRestriction`  | One restriction or special-watch interval          | booking ID; restriction type (segregation, restraint, observation, communication, visitation, other); reason/basis; ordered/start/end/review timestamps; authorizing and implementing staff; review decision                                                                                                                                                                                                               |
| `CustodyCheck`        | One recorded welfare, safety, or observation check | booking/housing/restriction IDs; scheduled/actual time; check type; recorded observation/outcome; performing staff; escalation/action reference                                                                                                                                                                                                                                                                            |
| `CustodyServiceEvent` | One request, screening, referral, or service event | booking ID; request ID; category (medical, mental health, medication, interpreter, disability accommodation, phone, counsel access, visitation, other); requested/triaged/scheduled/provided/closed timestamps; urgency; recorded response/outcome; responsible staff/service provider; linked incident/grievance. Request releasable operational metadata and supplied clinical fields separately with their definitions. |
| `CustodyIncident`     | One jail incident                                  | booking/person links; facility/location; occurred/reported timestamps; incident type (injury, assault, force, self-harm, escape, death, other); narrative; staff roles; injury/outcome; investigation and source report IDs                                                                                                                                                                                                |
| `CustodyGrievance`    | One grievance                                      | booking ID; grievance number; submitted/received timestamps; category; allegation/narrative; involved staff links; response due/actual dates; finding; remedy; appeal and closure dates/status                                                                                                                                                                                                                             |
| `CustodyDiscipline`   | One detainee allegation/finding/action             | booking/incident ID; rule alleged; allegation date; hearing date; finding; sanction and duration; effective start/end; deciding staff; appeal/result. Keep separate from employee discipline.                                                                                                                                                                                                                              |
| `CustodyRelease`      | One release from a booking episode                 | booking ID; ordered/authorized/actual release timestamps; release type/reason; releasing authority/staff; destination; transfer/new booking link; remaining hold/status; property-return status where recorded                                                                                                                                                                                                             |
| `CustodyDeath`        | One death associated with custody                  | booking/incident/arrest IDs; custody phase (arrest, transport, holding, jail); occurrence/pronouncement dates and locations; custody status; recorded cause/manner and determination status; determining authority; notification/investigation dates; source report; subsequent revisions                                                                                                                                  |
| `FacilityPopulation`  | One facility population/capacity observation       | facility ID; observation timestamp or reporting period; population; operational/rated capacity; source categories and definitions. Keep snapshots distinct from admissions and person-level custody episodes.                                                                                                                                                                                                              |

Link jail force and employee conduct through the force/complaint tables below.
Keep booking episodes, distinct people, movements, and admissions separate.
Temporary court or medical trips are not automatically new admissions. Preserve
actual start/end timestamps to report time to booking, bond, service, or release,
as well as time in particular housing or restrictions. Retain deaths' provisional
and final determinations as distinct dated source statements.

### Personnel, employment, accountability, and organization history

Include sworn officers, dispatchers, jailers/corrections staff, civilian employees,
and relevant contract staff as represented by the source. An employee ID is the
join key; names and badge numbers are attributes that can change or be reused.

| Requested table             | One row represents                                            | Requested fields in addition to common identity/provenance                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Employee`                  | One source employee/personnel record                          | employee ID; source name fields; employing organization; sworn/civilian/contract category; license/POST identifier; hire/separation dates and recorded reason; employment status; maintained employee demographics and their as-of dates                    |
| `EmployeeIdentifierHistory` | One employee identifier assignment                            | employee ID; identifier type (badge, payroll, POST/license, CAD login, radio/call sign, other); value; issuing organization/system; effective start/end; source crosswalk                                                                                   |
| `EmploymentAssignment`      | One employment/assignment interval                            | employee ID; employer/agency; organization-unit ID; position ID; job code; title/rank; assignment/beat/shift; duty status; full/part-time and FTE; effective start/end; change reason; acting/temporary designation                                         |
| `OrganizationUnit`          | One organizational unit for an interval                       | unit ID/name/type; agency; parent unit ID; effective start/end; source org-chart document/date                                                                                                                                                              |
| `PositionHistory`           | One authorized position for an interval                       | position ID/title; unit ID; reports-to position ID; rank/pay grade; effective start/end; vacancy status as recorded                                                                                                                                         |
| `SupervisorAssignment`      | One reporting relationship for an interval                    | employee ID; supervisor employee ID; unit/position IDs; relationship type (direct, acting, shift, functional); effective start/end; appointing record. Preserve multiple roles rather than treating every relationship as the same chain of command.        |
| `BeatBoundary`              | One beat/district boundary version                            | beat/district ID; name/type; parent geography ID; effective start/end; boundary geometry (GeoJSON or native GIS file), coordinate reference system; source map/version. Keep historical boundaries for event-date reporting.                                |
| `ShiftDefinition`           | One shift schedule definition for an interval                 | shift ID/name; unit/facility; timezone; scheduled start/end times; day-of-week/rotation; effective start/end; cross-midnight convention                                                                                                                     |
| `TimesheetEntry`            | One employee time entry                                       | employee ID; timesheet ID; work date; start/end; hours; time/pay code; duty/leave category; shift/assignment/beat/facility; cost center; submitted/approved dates; approver ID; correction/original-entry link; payroll-period reference                    |
| `OvertimeAuthorization`     | One overtime request/approval                                 | employee ID; request ID; requested/authorized hours; work date/interval; reason/category (callout, court, staffing, event, other); assignment/activity/case links; approving employee; decision/time; timesheet and payroll references                      |
| `DutyAssignment`            | One employee duty/shift interval                              | employee ID; unit/beat/facility/post; scheduled and actual start/end; duty type; regular/overtime hours; supervising employee; related CAD unit staffing ID                                                                                                 |
| `SalaryHistory`             | One compensation-rate interval                                | employee ID; employer; position/title; grade/step; effective start/end; rate amount; currency; pay basis (hourly, annual, other); scheduled hours/FTE; change reason                                                                                        |
| `PayrollEarning`            | One employee pay element for a reporting period               | employee ID; employer; pay-period start/end; payment date; reporting year; period granularity (pay period or annual); earning code/type; amount/currency; hours/rate where applicable; department/title; adjustment/reversal and original-record references |
| `EmployerBenefit`           | One employer-paid benefit component for a period              | employee ID; employer; period start/end; benefit type (retirement, insurance, other); amount/currency; contribution basis; source total if supplied separately                                                                                              |
| `CompensationTotal`         | One source-reported employee total for a period               | employee ID; employer; period start/end; total type (gross earnings, employer cost, other); amount/currency; included/excluded components; source calculation definition                                                                                    |
| `Complaint`                 | One complaint/intake matter                                   | complaint ID/number; received date; incident date; intake channel; originating body; complainant source role/demographics where maintained; narrative; investigation ID; open/closed dates/status; activity/case links                                      |
| `ComplaintAllegation`       | One allegation against one employee                           | complaint ID; employee ID; allegation/policy code and version; alleged conduct; investigator; finding/date; deciding official; appeal/review status and reference                                                                                           |
| `EmployeeDiscipline`        | One employee disciplinary decision/action                     | allegation/complaint ID; employee ID; proposing and final deciding officials; proposed/final action; decision/effective/end dates; suspension days; pay impact; policy basis; appeal/arbitration result; modification/reversal and document references      |
| `Commendation`              | One award or commendation                                     | commendation ID; name/type; nominated/awarded dates; reason/narrative; nominating/awarding body or employee; related incident/activity                                                                                                                      |
| `CommendationRecipient`     | One employee receiving a commendation                         | commendation ID; employee ID; recipient role; award date. Retain joint awards as one award with multiple recipients.                                                                                                                                        |
| `EducationTraining`         | One employee education/training completion or attempt         | employee ID; institution/provider; course ID/title/topic; degree/certificate; enrollment/start/completion/expiry dates; hours/credits; mandatory/elective/remedial designation; instructor; result/qualification; source document                           |
| `FieldTrainingAssignment`   | One trainee-trainer pairing for a period                      | trainee employee ID; FTO employee ID; program/cohort/phase; unit/shift; effective start/end; supervising/evaluating employee; completion/reassignment reason                                                                                                |
| `FieldTrainingEvaluation`   | One evaluation dimension or overall result                    | assignment ID; trainee/FTO/evaluator IDs; observation date and duty hours; form/version; evaluation dimension; score and scale; narrative; remedial instruction; recommendation; approval/date; phase outcome                                               |
| `UseOfForce`                | One force report/event in the field, transport, or a facility | force ID; occurred/reported timestamps; location/facility; call/incident/arrest/booking links; source circumstances; supervisory review/status; investigation/document references                                                                           |
| `ForceApplication`          | One employee's recorded force application to one subject      | force ID; employee ID; subject source person ID; sequence/time; force type/instrument; recorded reason/resistance; injury and medical response; subject demographics at event; review finding/date                                                          |

Retain pay-rate history separately from actual earnings. Preserve individual
pay elements such as regular, overtime, incentive, special assignment, retroactive,
and leave-payout amounts; do not add annual totals to the pay periods they summarize.
Keep original allegations, findings, discipline, appeals, and reversals distinct.
Link supervisors and FTOs using the relationship in effect at the event date.

### Shapes, task forces, funding, expenses, and other maintained records

Request native geospatial data wherever it exists, not only latitude/longitude:
points, lines, polygons/multipolygons, routes, service areas, and historical
boundaries. Accept GeoJSON, GeoPackage, Esri geodatabase/export, or complete
Shapefile sets with projection files and attribute tables. Preserve coordinate
reference system, geometry type, layer/feature IDs, effective dates, accuracy,
source scale, and existing record links. A beat centroid cannot replace its shape.
Link geometry to any applicable activity, unit, facility, task force, asset, or
jurisdiction through the source's feature keys.

| Requested table                | One row represents                                           | Requested fields in addition to common identity/provenance                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GeographicFeature`            | One version of a geographic feature                          | feature/layer ID; feature type/name; geometry or native GIS reference; coordinate reference system; effective start/end; source record links; parent/overlapping geography references where maintained                                                                                            |
| `TaskForce`                    | One task force or joint operation organization               | task-force ID/name; purpose; lead and participating agencies; authority/agreement reference; jurisdiction/shape; formation/end dates; status; command contact/position                                                                                                                            |
| `TaskForceMembership`          | One agency or employee membership interval                   | task-force ID; member agency/employee ID; home and host assignment; role; supervisor; effective start/end; deputation/authority reference; funding/cost-sharing agreement                                                                                                                         |
| `InteragencyAgreement`         | One agreement or amendment                                   | agreement ID; participating organizations; task-force/program ID; scope; signed/effective/expiry dates; command and reporting responsibilities; cost allocation/reimbursement terms; document and superseded-version links                                                                        |
| `OperationalDeployment`        | One operation, detail, or deployment                         | operation ID/type; task-force/unit; dates; geographic feature/beat; purpose; participating staff/agency links; supervising employee; linked activities; funding/project/cost-center references                                                                                                    |
| `FundingSource`                | One fund, program, or funding stream                         | fund/source ID/name; source type (local appropriation, federal/state grant, forfeiture, donation, reimbursement, other); funding organization; restrictions/purpose; active dates; source agreement                                                                                               |
| `GrantAward`                   | One award/subaward or amendment                              | award ID; FAIN/contract/Assistance Listing identifiers where maintained; parent award; funder/recipient; program; purpose; award/action dates; performance start/end; award/obligated/disbursed amounts as separate fields; matching requirement; currency; task-force/project links              |
| `BudgetLine`                   | One account/program budget line for a fiscal period/version  | fiscal year/period; budget version/date; fund; account; department/unit/task-force/project; adopted/revised appropriation; transfer/change amount; authorized positions/FTE where maintained; currency                                                                                            |
| `FinancialTransaction`         | One ledger transaction line                                  | transaction/line ID; transaction/posting dates; fiscal period; debit/credit or signed amount and convention; currency; account/object code; fund/grant/project/cost center; department/task force; payee/payer; category; invoice/contract/payment reference; reversal/original transaction       |
| `ExpenseLine`                  | One claimed or invoiced expense item                         | expense/report/invoice ID and line; employee/vendor ID; date; category (travel, lodging, meals, training, fuel, equipment, legal, jail services, other); description; amount/currency; operation/task-force/funding links; submitted/approved/paid dates; approver; receipt/document; ledger link |
| `CostAllocation`               | One allocation of a cost to a funding destination            | expense/payroll/transaction ID; fund/grant/task-force/project ID; allocated amount/percentage; currency; accounting period; allocation basis; reimbursement status. Supports split-funded salaries and overtime.                                                                                  |
| `Vendor`                       | One supplier/payee organization                              | vendor ID; name; source public business identifiers; status; parent/vendor crosswalks                                                                                                                                                                                                             |
| `ProcurementContract`          | One purchase order/contract/amendment                        | contract/PO ID; vendor; solicitation; goods/services; agency/project; award/start/end dates; original/amended amount; currency; procurement method; fund/grant; amendment history; source document                                                                                                |
| `Payment`                      | One payment/refund/reimbursement transaction                 | payment ID; payer/payee; date; amount/currency; payment type; invoice/expense/contract/grant links; status; reversal/original reference                                                                                                                                                           |
| `RevenueReceipt`               | One recorded receipt                                         | receipt ID; date; category (fees, fines, forfeiture distribution, grant draw, donation, reimbursement, other); amount/currency; payer/source; fund/account; associated case/award/agreement where recorded                                                                                        |
| `Asset`                        | One vehicle, equipment item, or technology asset             | asset ID; type; make/model; source serial/fleet ID; owner; acquisition date/cost; fund/grant/contract; operational status; disposal date/method/proceeds; assigned unit; geometry/location reference                                                                                              |
| `AssetAssignment`              | One asset custody/use interval                               | asset ID; employee/unit/task-force/facility ID; effective start/end; role/purpose; related deployment                                                                                                                                                                                             |
| `AssetService`                 | One maintenance/fuel/repair transaction                      | asset ID; date; service type; mileage/usage; quantity/unit; cost/currency; vendor; expense/payment link                                                                                                                                                                                           |
| `PropertyEvidence`             | One property/evidence item                                   | item ID; incident/case/search link; type/description; seized/recovered timestamp/location; seizing employee; value/currency as recorded; current custody/status; disposition/date; forfeiture-case link                                                                                           |
| `EvidenceCustodyEvent`         | One evidence transfer/status event                           | item ID; timestamp; from/to custodian/location; action/reason; employee; laboratory submission/result reference; source receipt                                                                                                                                                                   |
| `ForfeitureCase`               | One forfeiture proceeding                                    | case ID; civil/criminal/administrative type; property/seizure IDs; agency/court; filed/resolved dates; outcome; returned/forfeited/distributed amounts; recipient/fund; expense/revenue references                                                                                                |
| `Warrant`                      | One warrant/order and its history links                      | warrant ID; type; issuing court/case; issue/expiry/service/return/recall dates; status; subject source key; executing employee/activity; source document                                                                                                                                          |
| `Pursuit`                      | One pursuit                                                  | pursuit ID; incident/call links; start/end; route/geometry; units/personnel; reason; supervisory authorization/termination; collision/injury/outcome                                                                                                                                              |
| `Collision`                    | One crash report                                             | crash ID; timestamp/location/geometry; incident/pursuit links; involved personnel/vehicle/person roles; injury/fatality; contributing factors and findings as recorded                                                                                                                            |
| `MediaDocumentIndex`           | One document, recording, or attachment                       | source object ID; category (BWC, dashcam, dispatch audio, CCTV, report, order, policy, other); related record IDs; recording/event start/end; employee/device; format; retained/deleted dates and reason; source hash/URI; release/redaction status; associated releasable file                   |
| `PolicyVersion`                | One policy/procedure version                                 | policy ID/title; subject; issuing body; adopted/effective/retired dates; revision; source document; superseded version; related training and allegation policy references                                                                                                                         |
| `EmployeePolicyAcknowledgment` | One employee acknowledgment/training signoff                 | employee ID; policy version; assigned/completed/acknowledged dates; method; source record                                                                                                                                                                                                         |
| `EmployeeReview`               | One performance, qualification, or early-intervention review | employee ID; review type/date/period; referring indicator/source records; evaluator; recommendation/action; follow-up/outcome; recorded scores/scales. Preserve the source's interpretation separately from raw events.                                                                           |
| `AuditFinding`                 | One inspection, accreditation, or audit finding              | audit/inspection ID; agency/facility/program; reviewing body; date/period; standard; finding; corrective action; responsible unit/employee; due/completed dates; source report                                                                                                                    |
| `CivilClaimPayment`            | One claim/lawsuit settlement, judgment, or payment component | claim/case ID; involved agencies/personnel; incident link; filing/resolution/payment dates; result; amount/currency; payer/insurer; cost category (damages, settlement, legal fees, other); fund/account; payment/document reference                                                              |

Keep appropriations, award ceilings, obligations, expenses, cash payments, and
reimbursements distinct. Link them rather than adding multiple representations of
the same money. Preserve fiscal periods, grant performance periods, amendments,
and transaction reversals. A membership link does not by itself show participation
in a particular incident; request the deployment and activity records too.

### Reporting coverage to check against each response

- Calls and response times by agency, unit, officer, time, geography, call type,
  and priority; enforcement and outcomes by stop, person, arrest, citation, and charge.
- Age/race/ethnicity/sex/gender comparisons using event-specific observations,
  source category definitions, and disclosed missingness and denominators.
- Referral acceptance/declination, charge changes, case duration, pleas,
  dismissals, acquittals, convictions, sentences, appeals, and dated case status.
- Jail admission, custody duration, bond, holds, transfer, housing/restriction,
  service response, grievances, force, injuries, deaths, and release timing.
- Beats, shifts, scheduled versus worked hours, timesheets, overtime authorization
  versus hours worked and paid, and event-date staffing.
- Salary and earnings trends, title/rank and assignment changes, complaints,
  commendations, discipline, education, FTO relationships, and historical org charts.
- Task-force membership and operations; funding flows, grant and budget history,
  expenses, contracts, reimbursements, asset costs, and historical GIS coverage.
- Link availability and record coverage at every step. Count each call, arrest,
  booking, case, complaint, and employee at its own documented grain; charge,
  unit, staff, allegation, and status joins must not inflate event counts.

For every requested family, record delivered files/years, missing fields,
unresolved cross-system links, and the custodian of outstanding records. Preserve
raw evidence and source corrections so additional reporting can be built later.
