## Context

Three kinds of records can name an agency without naming an officer:

| Record     | Agency link today or proposed                           | Officer link                   |
| ---------- | ------------------------------------------------------- | ------------------------------ |
| Arrest     | `arrest.agency_id` (change `import-arrest-records`)     | `arrest_agency_personnel` rows |
| Report     | `reviews.agency_id` (change `supply-site-display-data`) | `review_personnel` rows        |
| Civil case | none without an officer                                 | `civil_case_personnel` rows    |

Constraints: the site decides nothing; counts and selection are database views (`supply-site-display-data`); IDs come from the source-name mapping; nothing is fabricated; required fields fail loudly; annotations report problems back to the source.

## Goals / Non-Goals

**Goals:**

- No record with a known agency is dropped because its officer is unknown.
- The missing officer is recorded as a defect (an annotation).
- Staff counts, personnel pages and agency inclusion never treat an unknown officer as staff.
- Pages show unknown-officer records from a database view.

**Non-Goals:**

- Identifying the officer. That is source work (for example the Irving employee-number roster in `import-arrest-records`).
- Records with no known agency.

## Decisions

The option is the owner's choice. This section compares them and gives a recommendation.

### Comparison

| Concern                                | A: Unknown personnel row                                                                                  | B: Virtual entry (view)                                                                 | C: Assignment with no person                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Fabricated person                      | Yes: one "Unknown" person per agency stands for many people                                               | No                                                                                      | No person; a placeholder assignment                                        |
| Staff counts                           | Every count view must exclude the row                                                                     | Correct with no rule: no row exists                                                     | Distinct-person counts correct; assignment counts need an exclusion        |
| Slugs and pages                        | Needs a unique `personnel.slug`; must be kept out of personnel pages, search, sitemap and structured data | None                                                                                    | None                                                                       |
| Agency inclusion                       | Must be excluded from the inclusion rule and `site_agency_page`                                           | Not affected                                                                            | Must be excluded from assignment-based rules                               |
| Joins                                  | One path: record → `agency_personnel` → `agency`                                                          | Two paths: direct `agency_id`, and through officer links; views union them              | One path                                                                   |
| Foreign-key integrity                  | All required keys kept                                                                                    | All required keys kept; a check keeps `agency_id` equal to each linked officer's agency | `agency_personnel.personnel_id` becomes nullable: a core invariant weakens |
| Civil cases                            | No schema change                                                                                          | New `civil_case_agency` table; `agency-record-selection` rule changes                   | No schema change beyond C's nullable key                                   |
| Annotations                            | Attach to the record; the Unknown row needs none                                                          | Attach to the record                                                                    | Attach to the record                                                       |
| Several unknown officers on one record | Shown as one                                                                                              | Shown as one record with an annotation                                                  | Shown as one                                                               |
| Risk if a rule is missed               | A fake officer is published or counted                                                                    | A record shows only under its agency                                                    | An assignment with no person reaches a roster                              |

### Recommendation: Option B

- It stores only what the source says. An officer link exists only when the source identifies the officer.
- The failure mode is mild: a forgotten join hides an unknown-officer record from an officer-level list, where it does not belong anyway. Option A's failure mode publishes a person who does not exist.
- Counts need no exclusions, which matches the owner's goal that counts be "accurate based on the data and not some buried logic".
- The annotation on each record is the defect report the owner asked for.

Costs the owner accepts with B: the `civil_case_agency` table (and an amended `agency-record-selection` rule, which today forbids a case-to-agency table), and a consistency check between `agency_id` and the linked officers' agencies.

### Option B outline (if chosen)

- `civil_case_agency`: `id`, `civil_case_id`, `agency_id`, from the source that names the agency as a party with no identified officer.
- Check: for every arrest and report, each linked officer's `agency_personnel.agency_id` equals the record's `agency_id`. A report naming officers at other agencies (see `supply-site-display-data` open question 4) needs an owner rule before this check applies to reports.
- View `agency_unknown_officer_record`: `agency_id`, record kind, record ID, for arrests with no `arrest_agency_personnel` row, reports with no `review_personnel` row, and `civil_case_agency` rows.
- Annotation codes: `arrest_officer_not_identified` (already in `import-arrest-records`), `report_officer_not_identified`, `civil_case_officer_not_identified`.
- Agency inclusion: `civil_case_agency` makes the agency a case root, like `civil_case_personnel` does today.

## Risks / Trade-offs

- [The owner picks A] → Every `site_*` view in `supply-site-display-data` gains an exclusion, and a test must fail if any personnel page, search entry or sitemap entry exists for an Unknown row.
- [The owner picks C] → Every query that assumes `agency_personnel.personnel_id` is set must be reviewed; generated types change.
- [B: "no officer link" may mean "not imported yet"] → The annotation marks a record whose source says the officer is not identified; a record without the annotation and without links fails integrity checks.

## Open Questions

1. Which option: A, B (recommended) or C?
2. With B, may `agency-record-selection` add a `civil_case_agency` link table, reversing its "without introducing a CaseAgency table" rule?
3. Should a record with several unidentified officers say how many? No option can count them without a source count.
4. What does the agency page call the entry: "Unknown officer", "Officer not identified", or another label? The label would be stored by intake, not written by the site.
5. Should unknown-officer records count in agency totals (for example agency arrest totals)? The arrest views already count all of an agency's bookings; reports and civil cases would follow the same rule.
