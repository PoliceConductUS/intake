## Design Summary

This brainstorm was not run as an interactive session. Its inputs are the owner's decisions of 2026-11-22 in `policeconduct.org` `.egm-reviews/owner-decisions-round1.md`, ADR 0032 and its amendment, the spec `irving-arrest-analytics`, and the source `sources/gov/irvingtx/arrests/`.

The owner's words: "why not a complete import of the arrest data? it is by definition public data - having the raw data means analysis, summaries, etc are all easier - an arrest can involve many charges." Also: "'arrest profile' makes no sense as a name — the source data (e.g. Irving) is actual arrest records; intake must name its tables for what they are." And: an arrest with no identified officer looks like a data defect.

Today the source `gov/irvingtx/arrests` reads the Irving workbook (`Arrest Data`, `Charges` and `Offenses` sheets), keeps the bookings private, and writes two aggregate tables: `arrest_profile` (one row per resolved `agency_personnel`) and `agency_arrest_profile` (one row per agency), each with `coverage` and `breakdowns` JSON.

The new design imports the records themselves:

- `arrest`: one row per booking (`Booking_No`), linked to the agency.
- `arrest_agency_personnel`: one row per resolved arresting officer of a booking. A booking can name more than one officer.
- `arrest_charge`: one row per source charge row.
- `arrest_offense`: one row per source offense row.
- `police_beat` and `census_tract_household_income`: the reference data the aggregates use today, now as rows.
- Views replace `arrest_profile` and `agency_arrest_profile`.
- `agency_personnel.employee_number` and `agency_personnel_badge`, so the richer Irving CSV can name officers once Irving supplies a roster with employee and badge numbers.

A later owner decision the same day replaced an earlier plan to leave out arrestee names and home addresses: "arrests - import everything - the database is not on the internet, the site will not include that information when building ... the data is already public by law and by definition ... it is up to the source to never expose non-public data during its work." Every field of the public release is imported. The website build reads only the counts and breakdowns it already shows; publishing more is a new change. The owner also asked to queue a records request for Irving's employee and badge numbers (`docs/requests/irving-pd-employee-roster-2026-11-22-v1.txt`).

## Alternatives Considered

### Option A: Keep the aggregate tables and rename them

- **Approach**: Rename `arrest_profile` and `agency_arrest_profile` to describe what they hold; keep JSON breakdowns.
- **Pros**: Small change. The website keeps its loaders.
- **Cons**: The owner asked for a complete import. Every new question needs a new breakdown in `sources/gov/irvingtx/arrests/arrest.ts`. JSON hides the data from SQL.
- **Why not chosen**: It does not meet the owner's request.

### Option B: One wide row per charge, booking fields repeated

- **Approach**: One table with a row per charge row, copying booking date, officer and beat onto each row.
- **Pros**: One table to query.
- **Cons**: Booking facts repeat; a booking with no linked charge (9,447 of 41,211 in the verified workbook) has no row and disappears. Counting bookings needs `distinct`.
- **Why not chosen**: It loses bookings without charges and stores one fact many times.

### Option C: Booking rows with child charge, offense and officer rows (chosen)

- **Approach**: As in the summary.
- **Pros**: One row per fact. Bookings without charges stay. Many charges and many officers per booking fit. Every count is a SQL view.
- **Cons**: More tables and more rows (about 41,000 bookings plus their charges).

## Agreed Approach

Option C, with the officer link following the recorded-relationship pattern of `civil_case_personnel` and `review_personnel`.

## Key Decisions

- Table names describe the records: `arrest`, `arrest_charge`, `arrest_offense`, `arrest_agency_personnel`.
- The arrest always records `agency_id`. A resolved officer is a row in `arrest_agency_personnel`. How records with a known agency and unknown officer appear on pages is the change `unknown-officer-records`.
- An arrest with no resolved officer gets an annotation, because the owner calls it a data defect.
- `arrest_profile` and `agency_arrest_profile` are dropped. The arrest-profile foreign key the owner asked for earlier is no longer needed (owner, 2026-11-22: "No new arrest FK column").

## Open Questions

See `design.md`, section "Open Questions".
