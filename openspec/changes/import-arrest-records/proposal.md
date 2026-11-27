## Why

Intake stores Irving arrests only as per-officer and per-agency counts in `arrest_profile` and `agency_arrest_profile`. The owner asked on 2026-11-22 for a complete import of the arrest records: they are public data, raw rows make analysis and summaries easier, and an arrest can involve many charges. The owner also said the tables must be named for what they are, and that an arrest with no identified officer is a data defect.

A second owner decision the same day: "arrests - import everything". Arrest records released under the Texas Public Information Act are public by law; they hold what a newspaper prints when it reports an arrest. The database is not on the internet, and the website build does not read the record fields, so importing them exposes nothing. The owner may publish complete arrest records later, through a new change.

## What Changes

- **New tables:** `arrest` (one row per booking, with every field the source supplies, including the arrestee's name, home address, home ZIP, home coordinates, booking number and arrest location), `arrest_charge` (one row per source charge row), `arrest_offense` (one row per source offense row), `arrest_agency_personnel` (one row per resolved arresting officer of a booking), `police_beat` (official beat polygons), `census_tract_household_income` (ACS income per tract) and `household_income_band` (manual records: band labels and limits).
- **Officer identity:** a new column `agency_personnel.employee_number`, unique per agency, and the existing column `agency_personnel.badge_number`, which holds the current badge only. Owner decision, 2026-11-22: "agency_personnel.badge_number is the current badge - historical badge numbers are not needed yet". Both are filled from the roster Irving returns to a Public Information Act request (draft: `docs/requests/irving-pd-employee-roster-2026-11-22-v1.txt`). Sending that request, importing the response, and repeating the request for other agencies whose arrest data uses internal numbers are tasks.
- **Annotations:** an arrest with no resolved officer gets an annotation; a booking with no linked charge row gets an annotation. They replace the JSON `dataQualityFindings`.
- **Views replace the aggregate tables:** `arrest_coverage` and `arrest_breakdown` give the same measures per agency and per `agency_personnel`. **BREAKING:** `arrest_profile` and `agency_arrest_profile` are dropped.
- **Website boundary:** the website build reads only the counts and breakdowns the site already shows. Publishing any other arrest-record field needs a new OpenSpec change.
- **Richer CSV:** every field of the Irving CSV (race, sex, age, home ZIP, beat, employee numbers) is imported once its headers, row unit and link to bookings are known.

## Capabilities

### New Capabilities

- `arrest-records`: Booking, charge, offense and officer rows with every source field; beat and income reference rows; officer employee and badge numbers; arrest annotations; the summary views; the website boundary.

### Modified Capabilities

- `irving-arrest-analytics`: The aggregate and data-quality requirements are replaced by record rows, views and annotations.
- `agency-record-selection`: The agency graph includes arrest records instead of arrest aggregates.

## Impact

- **Supabase migrations:** the new tables, the `agency_personnel.employee_number` column and unique index (no migration for `agency_personnel.badge_number`, which already exists), the views, and dropping `arrest_profile` and `agency_arrest_profile`.
- **Intake sources:** `sources/gov/irvingtx/arrests/` produces the new kinds. A source for the employee and badge roster is added when the roster arrives. The manual source handles `HouseholdIncomeBand`.
- **Generated contracts:** envelope types regenerated; `ArrestProfiles` and `AgencyArrestProfiles` removed.
- **Data reset:** required. The new rows are produced by regenerating the source.
- **Production migration plan:** rebuild production the same way, then deploy the website follow-up.
- **Downstream contract (website, cross-repo note):** the personnel and agency arrest sections, the beat map and the income table read the new views and tables instead of the JSON columns. The website build reads no other arrest-record field. The in-flight change `map-arrests-by-beat` reads beat polygons from `police_beat` instead of `breakdowns.arrest_beat_boundaries`.
- **Related changes:** `unknown-officer-records` decides how arrests with a known agency and unknown officer appear on pages. `supply-site-display-data` adds annotation message codes, which the new annotations use.
- **ADR:** a new ADR supersedes ADR 0032.
