## 1. Approval and records

- [ ] 1.1 Get owner answers to the open questions in `design.md` and record them there.
- [ ] 1.2 Write an ADR, status Proposed, that supersedes ADR 0032: arrest records are imported as rows with every source field; aggregates are views; the website build reads only the counts and breakdowns.
- [ ] 1.3 Tell the owner of `map-arrests-by-beat` that beat polygons move to `police_beat`; update that change's tasks only with its owner's approval.

## 2. Officer identity

- [ ] 2.1 Write the migration for `agency_personnel.employee_number` with a unique index on `(agency_id, employee_number)`; regenerate envelope types. `agency_personnel.badge_number` already exists and needs no migration.

## 3. Arrest tables

- [ ] 3.1 Write the migration for `arrest`, `arrest_agency_personnel`, `arrest_charge`, `arrest_offense`, `police_beat`, `census_tract_household_income` and `household_income_band`; regenerate envelope types.
- [ ] 3.2 Add the inclusion edges to the shared agency graph, with tests.
- [ ] 3.3 List the workbook's header names (names only) and add one `arrest` column for each source field D1 does not already name.
- [ ] 3.4 Change `sources/gov/irvingtx/arrests/` to produce the new kinds with every source field, including arrestee name, home address, home ZIP, home coordinates, booking number and arrest location, storing redacted fields as released, with tests for each spec scenario.
- [ ] 3.5 Add the four arrest annotation codes and their messages; produce the findings in the source, with tests.
- [ ] 3.6 Add `HouseholdIncomeBand` to the manual source handled kinds and add the band records.
- [ ] 3.7 Before the reset, report expected counts: bookings, charge rows, offense rows, resolved officer links, and annotations per code.

## 4. Views and removal

- [ ] 4.1 Write the migration for `arrest_coverage` and `arrest_breakdown`, with SQL tests that compare each measure with the current `arrest_profile` and `agency_arrest_profile` values on a copy of the current data.
- [ ] 4.2 Write the migration that drops `arrest_profile` and `agency_arrest_profile`; remove their entity descriptors and envelope kinds.

## 5. Employee and badge number requests

- [ ] 5.1 Send the Irving PD Public Information Act request for the sworn employee roster with employee numbers and badge numbers, using the draft [`docs/requests/irving-pd-employee-roster-2026-11-22-v1.txt`](../../../docs/requests/irving-pd-employee-roster-2026-11-22-v1.txt), after the owner fills in the requester fields and approves sending it; record the send date and request number.
- [ ] 5.2 When Irving responds, import the roster as a source (or as manual records if the response is not machine-readable) that maps each entry to an existing Irving `agency_personnel` row through the name resolver and fills `employee_number` and the current `badge_number` (no badge history is stored), failing on duplicate employee numbers and unmatched names, with tests.
- [ ] 5.3 For each other agency whose arrest data names officers only by internal number, draft the same request under `docs/requests/`, send it after owner approval, and import the response as in 5.2.

## 6. Richer CSV

- [ ] 6.1 Record the headers (names only), the row unit and whether rows carry `Booking_No` for `Police_Arrests_20250718.csv`, without committing any value.
- [ ] 6.2 If rows carry `Booking_No`, import every CSV field (race, sex, age, home ZIP, beat and any other column) into `arrest` and resolve officers by employee number once task 5.2 is done; otherwise stop and report the options.

## 7. Validation

- [ ] 7.1 Run `npx openspec validate import-arrest-records` and `npm run openspec:validate`.
- [ ] 7.2 Run `npm run supabase:reset` to apply every migration, then `data reset` on a database with no other rebuild in progress.
- [ ] 7.3 Assert integrity: every `arrest.agency_id`, `arrest.police_beat_id`, `arrest_agency_personnel.arrest_id` and `agency_personnel_id`, `arrest_charge.arrest_id` and `arrest_offense.arrest_id` resolves; every `arrest_agency_personnel` row's assignment is at the arrest's agency; every source field has a column; a repeated generate gives an empty diff.
- [ ] 7.4 Run `npm run validate`.
