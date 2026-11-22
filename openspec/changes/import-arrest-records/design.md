## Context

The source `gov/irvingtx/arrests` reads private inputs under `$INTAKE_WORKSPACE/gov/irvingtx/arrests/source/`:

- `arrests.xlsx`, sheets `Arrest Data` (`Booking_No`, the arrestee's booking name, `Arrest_Officer_Name`, `Arrest_Date`, `Arrest_Time`, `District`, `Booking_Address` and every other column the sheet holds), `Charges` (`Booking_No`, `Charge`, `Charge_Literal`, `Level`) and `Offenses` (`Booking_No`, `Offense`, `Description`, `Offenses`);
- geographic evidence: the arrest-location audit (arrest location, latitude, longitude, geocode method and quality), the official beat polygons, residential Census geocodes (home coordinates and tract) and ACS 2024 B19013 income responses.

Today `acquire` normalizes each booking (`NormalizedArrest` in `arrest.ts`: booking number, source row count, officer names, date parts, source district, beat and income enrichment, charges, offenses) and drops the booking name and address. `transform` resolves officer names to Irving `agency_personnel` rows and writes `ArrestProfiles` and `AgencyArrestProfiles`.

ADR 0032 also describes a second file, `Police_Arrests_20250718.csv` (about 116,000 rows), with arrestee race, sex, age, home ZIP and beat, which names officers only by an internal employee number. The roster has no key for that number. Its exact headers, its row unit (booking or charge) and whether it shares `Booking_No` with the workbook are not recorded in the repository.

### Arrest records are public

Owner decision, 2026-11-22: "arrests - import everything". Arrest records that an agency releases under the Texas Public Information Act (Texas Government Code, Chapter 552) are public by law. They hold the facts a newspaper prints when it reports an arrest: the arrestee's name, address and age, the charges, the booking number, and the time and place of the arrest. Intake does not withhold, drop or hash fields of a public release.

The source module is responsible for never ingesting data the agency did not release publicly. If an agency redacts a field, the redacted value stays redacted: the source stores what the release shows (an empty value or the agency's redaction marker) and never fills it from another file, a guess or a join. What is public can vary by source; each source records what its agency released.

The intake database is not on the internet. The website build reads only the counts and breakdowns the site already shows (D7), so importing every field exposes nothing new. The owner may publish complete arrest records later; that is a new OpenSpec change.

Source files and record values are not committed to the repository, as today. Tests use synthetic values.

## Goals / Non-Goals

**Goals:**

- Store every booking, charge row and offense row with every field the source supplies.
- Link each booking to its agency, and to each resolved arresting officer's `agency_personnel` row.
- Replace the two aggregate tables with views over the rows.
- Record every arrest with no resolved officer as an annotation.
- Store officer employee numbers and badge numbers so the richer CSV and other agencies' arrest data can name officers.
- Keep the website build to the arrest counts and breakdowns it already shows.

**Non-Goals:**

- Publishing arrest-record fields on the website. That needs a new OpenSpec change.
- How records with a known agency and unknown officer appear on pages. That is the change `unknown-officer-records`.
- Population arrest rates. They need separate population data.
- Other agencies' arrest data. The tables are agency-agnostic, but only Irving is imported.

## Decisions

### D1. Tables

`arrest` (one row per distinct `Booking_No`):

| Column                                              | Notes                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `id`                                                | cuid2 from the source-name mapping; source ID is `Booking_No`               |
| `agency_id`                                         | `not null`, the arresting agency                                            |
| `booking_number`                                    | the source `Booking_No`                                                     |
| `arrestee_name`                                     | the booking name as the source wrote it                                     |
| `arrestee_home_address`                             | `Booking_Address` as the source wrote it                                    |
| `arrestee_home_zip`                                 | the home ZIP, from the source or the richer CSV                             |
| `arrestee_home_latitude`, `arrestee_home_longitude` | the residential Census geocode                                              |
| `residential_tract_geoid`                           | Census tract from the residential geocode                                   |
| `arrestee_race`, `arrestee_sex`, `arrestee_age`     | as reported in the richer CSV, once it is linked (task 6)                   |
| `arrest_date`                                       | `date not null`                                                             |
| `arrest_time`                                       | `time null`                                                                 |
| `arrest_location`                                   | the arrest location as the audit records it                                 |
| `arrest_latitude`, `arrest_longitude`               | the arrest-location point                                                   |
| `arrest_geocode_method`, `arrest_geocode_quality`   | as the audit records them                                                   |
| `source_district`                                   | the source `District` code, uninterpreted                                   |
| `police_beat_id`                                    | `null` or the beat from the arrest location and official polygons           |
| `beat_status`                                       | the existing beat status (matched, ambiguous, unmatched, unreliable point)  |
| `income_status`                                     | the existing income status                                                  |
| `source_row_count`                                  | number of `Arrest Data` rows for the booking                                |
| one column for each other source field              | named for the field; task 3.3 lists the columns from the workbook's headers |
| `data_source_values`                                | provenance, as on every table                                               |

`arrest_agency_personnel`: `id`, `arrest_id`, `agency_personnel_id` (`not null`), `source_officer_name` (the name as the source wrote it). One row per resolved officer of a booking.

`arrest_charge`: `id`, `arrest_id`, `charge_code` (`Charge`), `charge_literal` (`Charge_Literal`, exact text, whitespace kept), `charge_level` (`Level`), `source_ordinal` (position among the booking's charge rows in source order). Exact repeated rows stay as separate rows.

`arrest_offense`: `id`, `arrest_id`, `offense_code` (`Offense`), `description`, `source_offenses` (`Offenses`), `source_ordinal`.

`police_beat`: `id`, `agency_id`, `code`, `name`, `geometry` (`jsonb`, Polygon or MultiPolygon), with the snapshot's source URL, retrieval time and SHA-256 in `data_source_values`.

`census_tract_household_income`: `id`, `tract_geoid` (unique), `estimate`, `margin_of_error`, `estimate_annotation`, `margin_of_error_annotation`, `topcoded`, `vintage`.

`household_income_band` (manual records): `id`, `label`, `lower_limit`, `upper_limit`. These replace the bands hard-coded in the website (`arrest-income.js`).

Child-row IDs come from the source-name mapping with source IDs `<Booking_No>:charge:<source_ordinal>` and `<Booking_No>:offense:<source_ordinal>`.

A field the agency redacted is stored as the release shows it. The source never fills it from elsewhere.

### D2. Officer links and identity

The source resolves each `Arrest_Officer_Name` with the existing name resolver (ADR 0023). A resolved name becomes an `arrest_agency_personnel` row. The arrest itself always records `agency_id`, so a booking whose officers are not resolved is still an Irving arrest.

`agency_personnel.employee_number` (`text null`, unique with `agency_id`) holds the agency's internal employee number, the identifier the richer CSV uses for the arresting officer. A column is enough because an employee number belongs to one assignment at one agency. If Irving reports that numbers were reassigned, a dated mapping table replaces the column (open question 2).

`agency_personnel_badge` holds badge numbers: `id`, `agency_personnel_id` (`not null`), `badge_number` (`text not null`), `start_date` (`date null`), `end_date` (`date null`), `data_source_values`. One row per badge number an `agency_personnel` row held. When the roster gives badge history, each earlier badge is its own row with its dates; when it gives only the current badge, there is one row with null dates. A table, not a column on `agency_personnel`, so the current badge and earlier badges have one representation. Two rows at one agency with the same badge number and overlapping dates fail generation.

Both are filled only by a source for the roster Irving returns to the Public Information Act request in `docs/requests/irving-pd-employee-roster-2026-11-22-v1.txt`, which asks for names, employee numbers, badge numbers with history, ranks, hire and separation dates, reassignments and a data dictionary. The roster source maps each roster entry to an existing Irving `agency_personnel` row through the name resolver and fails on duplicates and unmatched names. Intake never infers a number. Once filled, the richer CSV resolves officers by `(agency_id, employee_number)`. The same request goes to every other agency whose arrest data names officers only by internal number.

### D3. Annotations

These findings become annotations through the ADR 0040 rules, with message codes from `data_annotation_message`:

- `arrest_officer_not_identified`: the booking names no officer. Subject: the arrest.
- `arrest_officer_not_matched`: the booking names an officer who does not match the Irving roster. Subject: the arrest. Value: the name as written.
- `arrest_without_charge_records`: the booking has no linked charge row. Subject: the arrest. The message says the supplied data is incomplete; it does not say no charge existed.
- `arrest_without_beat`: the arrest location matched no patrol beat (owner answer Q34). Subject: the arrest. The owner's Q34 answer attached this to the agency; with arrest rows, the arrest is the more exact subject (open question 3).

### D4. Views replace the aggregate tables

- `arrest_coverage`: one row per scope (`agency_id`, or `agency_id` plus `agency_personnel_id`): first and last month, distinct bookings, source arrest rows, charge rows, distinct charge records (complete code, literal and level tuples per booking), bookings with and without linked charges, offense rows, distinct offense records, bookings with linked offenses, bookings with no resolved officer (agency scope only).
- `arrest_breakdown`: one row per scope, dimension and bucket, with `arrest_count`, `charge_row_count` and `distinct_charge_record_count`. Dimensions: year, month, ISO week, day of week, hour, source district, arrest beat, beat status, residential tract, income band, charge code, charge level.

An agency's numbers come from all its bookings. An officer's numbers come from bookings linked through `arrest_agency_personnel`. Agency totals are never sums of officer rows. A booking with several charge categories counts once in each category, as today.

The `cells` joint counts in the current JSON are not reproduced: any joint count is a `group by` over the rows.

### D5. Original files

The original files stay in private acquisition storage, as today. Normalized private files keep every field the tables hold.

### D6. The richer CSV

Before any import, task 6.1 records the CSV's headers (names only, never values), its row unit, and whether its rows carry `Booking_No`. If they do, every field it supplies (race, sex, age, home ZIP, beat and any other column) fills the `arrest` row for that booking. If they do not, the CSV is a separate set of arrests and needs its own design; the change stops there and reports the options.

### D7. Website boundary

The website build reads arrest data only through `arrest_coverage`, `arrest_breakdown`, `police_beat`, `census_tract_household_income`, `household_income_band` and the arrest annotations, to show the counts and breakdowns the site already shows. It does not read or publish any other `arrest`, `arrest_charge`, `arrest_offense` or `arrest_agency_personnel` field, such as an arrestee's name, address, booking number or arrest location. Publishing any of them needs a new OpenSpec change.

### Website follow-up (cross-repo note, not intake tasks)

- Read `arrest_coverage`, `arrest_breakdown`, `police_beat`, `census_tract_household_income` and `household_income_band` instead of `arrest_profile.coverage`, `arrest_profile.breakdowns` and `agency_arrest_profile`.
- The personnel beat map gets its polygons from `police_beat` through the officer's agency, a recorded foreign key.
- Show the arrest annotations where the arrest counts appear.
- Read no other arrest-record field (D7).

## Risks / Trade-offs

- [A later website change reads a record field by accident] → D7 is a spec requirement; a website change that reads more must come with its own OpenSpec change.
- [A source ingests a field the agency did not release] → Each source stores only what the agency's public release shows; redacted fields stay redacted.
- [Child-row IDs depend on source order] → If Irving re-exports with rows reordered, child IDs move to other rows. Detect it: a re-import that changes a child row's content under the same ID fails the comparison and is reported (open question 1).
- [About 41,000 annotations if most bookings lack a resolved officer] → Expected counts from the current workbook: 320 of 518 roster officers matched and 275 names unmatched (ADR 0032). The per-booking count is reported before release.
- [The roster request takes weeks or is narrowed] → Employee and badge numbers stay null until it arrives; the workbook import does not wait for it.
- [`map-arrests-by-beat` is in flight against the JSON contract] → Its beat data moves to `police_beat`; that change's tasks need updating.
- [Website arrest sections break until the website follow-up] → Accepted by the owner.

## Migration Plan

1. Migrations: new tables, `employee_number` and `agency_personnel_badge`; views; drop `arrest_profile` and `agency_arrest_profile`.
2. Update the source; add `HouseholdIncomeBand` manual records.
3. `data reset` on a database with no other rebuild in progress; integrity checks.
4. Rebuild production; deploy the website follow-up.

Rollback: revert migrations and source, then `data reset` from the previous commit.

## Open Questions

1. Is the order of charge and offense rows within a booking stable across Irving exports? If not, which source field can key a charge row?
2. Can Irving employee numbers change or be reused? The roster request asks for reassignments; if any exist, a dated mapping table replaces `agency_personnel.employee_number`.
3. Attach "no beat" findings to the arrest (proposed) or to the agency (owner answer Q34, given before arrest rows existed)?
4. One annotation per booking without an identified officer (proposed), or one per agency with a count?
5. Income band limits and labels: keep today's website bands, or new ones?
