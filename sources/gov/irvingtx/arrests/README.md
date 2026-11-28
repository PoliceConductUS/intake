# Irving arrest analytics

## Overview

The source imports agency and officer aggregates from the complete Irving workbook and explicitly acquired geographic evidence. It does not choose a primary charge.

## Private acquisition inputs

Under `<workspace>/gov/irvingtx/arrests/source/`, where `<workspace>` is `$INTAKE_WORKSPACE`:

- `arrests.xlsx`: original workbook, with Arrest Data, Charges and Offenses sheets.
- `geography/acquisition-receipt.json`: SHA256 pins for the original workbook, source workbook used for both enrichment datasets, original location-audit workbook and its CSV export, plus source/sheet/conversion metadata.
- `geography/arrest-location-audit.xlsx` and `.csv`: original coordinate audit and complete sheet export (all source columns). CSV columns include arrest location, Latitude, Longitude, Geocode_Method and Geocode_Quality. The importer verifies file hashes and row count.
- `geography/beat-polygons.geojson` and `beat-receipt.json`: official Irving polygon snapshot and its receipt. Acquisition checks only that the receipt's `sha256` equals the hash of the polygon file. It requires and validates no other receipt field, and copies the whole receipt into the provenance.
- `geography/address-tract-map.json`, `geocode-acs2024-*-input.csv`, and matching output CSVs: residential Census geocode evidence. Original address hashes, submitted address components, response identities and matched tract/state/quality must agree.
- `geography/acs2024-state-*.json` and `income-receipt.json`: raw Census ACS 2024 five-year B19013 responses and their receipt. The receipt must have `dataset` `2024/acs/acs5`, `table` `B19013` and `vintage` `ACS2024_Current`; no other receipt field is checked.

Acquisition copies the original workbook to `<sourceDir>/evidence/arrests.xlsx` and the full geographic evidence bundle to `<sourceDir>/evidence/geography`. These contain private addresses and names; they are not public website artifacts. Normalized booking records also remain private. Old first-charge-only normalized files are rejected.

Run the ordinary `data acquire gov/irvingtx/arrests`, `data transform gov/irvingtx/arrests`, `data generate gov/irvingtx/arrests`, and `data up` commands with the intended workspace/database configuration. Inspect generated changes before applying. `data verify` verifies the applied chain; repeated transform/generate must yield an empty diff.

## Website data contract

`public.agency_arrest_profile` has one record per agency, joined through `agency_id`. It includes all supplied bookings regardless of officer resolution. `public.arrest_profile` remains one record per resolved `agency_personnel_id`; its aggregates cover only those matched bookings. Do not sum officer profiles to derive agency totals.

Both tables expose `coverage` and `breakdowns` JSON. On both tables `coverage` also carries `source: "gov/irvingtx/arrests"`, `agency: "Irving Police Department"`, and `provenance`, the provenance object written by acquire. `provenance.workbook.name` is `arrests.xlsx`, the name of the file that acquire reads. Coverage counts:

- `totalArrests`: distinct Booking_No values.
- `sourceArrestRows`: original arrest rows, including repeated bookings.
- `chargeRows`: every linked source charge row, including exact repeats.
- `distinctChargeRecords`: unique complete code/literal/level tuples within each booking. This is not a certified count of distinct legal charges because the supplied Charge value is not a unique identifier.
- `arrestsWithLinkedCharges` and `arrestsWithoutLinkedCharges`: booking-level linkage coverage. Missing links do not establish absence of legal charges.
- `offenseRows`, `distinctOffenseRecords`, `arrestsWithLinkedOffenses`: separate Offenses-sheet coverage.
- `firstMonth`, `lastMonth`: observed source period.

The agency additionally exposes `audit`, the source row counts from `arrest.ts:normalizeWorkbook` (`sourceArrestRows`, `sourceChargeRows`, `sourceOffenseRows`, and `orphanChargeRows` and `orphanOffenseRows`, the charge and offense rows whose `Booking_No` matches no arrest row; linked counts are in the coverage breakdowns, not in `audit`) and the two per-status booking counts that `acquire.ts:acquire` adds, `arrestBeatStatus` and `residentialIncomeStatus`. Beside `audit`, the agency `coverage` carries `arrestsWithNoResolvedOfficer`, `unresolvedNameCount`, `officersProfiled`, and `dataQualityFindings`. The finding code `bookings_without_matching_charge_records` has `count`, `totalBookings` and `reason: unknown`. The website can state the verified count of bookings without matching charge records as a supplied-data quality issue.

Breakdowns preserve arrest counts in `by_year`, `by_month`, `by_iso_week`, `by_day_of_week`, `by_hour`, `by_arrest_beat`, `by_residential_tract`, `by_beat_status`, `by_income_status`, and `by_source_district` (uninterpreted original source codes, not assigned police beats). For offense and level there are three distinct measures: `charge_rows_by_*`, `distinct_charge_records_by_*`, and `arrests_by_*`. An arrest with several charge categories contributes once to each relevant category, so category booking counts must not be summed as if mutually exclusive.

`cells` contains joint month/arrest-beat/residential-tract/status counts and all three charge measures. Website filters can aggregate these cells. `residential_income_by_tract` supplies exact ACS median household income estimate, margin of error, estimate/MOE annotations, and `topcoded`. A topcoded 250000 value represents 250,000+, not an exact median. Income is a residential-area proxy, not personal income. All income values use the pinned 2020–2024 ACS period in 2024 inflation-adjusted dollars.

A beat is assigned from the arrest location's evidence point and official PD1/PD2 patrol polygons. The enclosing OTHER polygon is a coverage class, not a competing beat. Conflicting locations, unreliable points and unmatched locations retain explicit status and remain in overall counts. The downloaded polygons supply no historical effective dates. No home-beat concept is produced.

These aggregates support counts, charge distributions and charges per booking. Population arrest rates require separate matching population denominators. Public output excludes arrestee names, street addresses, booking identifiers and exact address points. Provenance includes source hashes, dataset/version information and documented geographic coverage.

`breakdowns.arrest_beat_boundaries` on the agency profile contains the official patrol snapshot as `{code, name, geometry}` records. Geometry is Polygon or MultiPolygon. Personnel profiles reuse their agency's boundaries with their own beat counts; boundaries are not duplicated into every personnel profile. Reacquire and transform existing inputs to produce this required map contract. The website currently displays beat maps on personnel and agency pages only; city and higher rollups remain deferred.

## Interface

- `intake.source.ts:source` - the `IntakeSource` for the source namespace `gov/irvingtx/arrests`: `acquire`, `transform`, and `produces` listing `ArrestProfiles` and `AgencyArrestProfiles`.
- `acquire.ts:acquire` - a `SourceAcquire` taking `{ sourceDir, env, logger }`. It verifies the private workbook and the geographic evidence, enriches and normalizes the bookings, and writes the normalized bookings, the provenance file, and a copy of the evidence into `sourceDir`.
- `transform.ts:transform` - a `SourceTransform` taking `{ paths, state, data, logger }`. It reads the normalized bookings and the provenance file, resolves the agency and each officer name, and returns the `ArrestProfiles` and `AgencyArrestProfiles` artifacts and its row accounting.
- `arrest.ts:normalizeWorkbook` - `(arrestRows, chargeRows, offenseRows, enrichment) => { arrests, audit }`; groups the source rows by `Booking_No` and counts orphan charge and offense rows.
- `arrest.ts:buildProfile` - `(arrests) => { coverage, breakdowns }`; the coverage counts, the breakdowns, and the `cells` described under Website data contract.
- `arrest.ts:parseNormalizedArrest` - `(value: unknown) => NormalizedArrest`.
- `arrest.ts:clean` - `(value: string | undefined) => string`; the one cleaning rule of this source: trims, and turns the exact text `NULL` into the empty string. Text in another letter case, such as `null`, is kept.
- `arrest.ts:bookingNumber` - `(row, sheet, index) => string`; the cleaned `Booking_No` of a source row, the key of a booking everywhere in this source.
- `arrest.ts:NormalizedArrest`, `arrest.ts:BookingEnrichment`, `arrest.ts:ArrestRow` - the normalized booking, its beat and income enrichment, and a raw source row.
- `enrichment.ts:enrichBookings` - `(rows, evidence: GeographyEvidence) => Record<bookingNo, BookingEnrichment>`; assigns the arrest beat and the residential tract and income, each with a status.
- `enrichment.ts:parseAcsIncome` - `(rows) => Record<geoid, Income>`; parses the raw ACS B19013 responses.
- `enrichment.ts:GeographyEvidence` - `{ addressTracts, acsRows, beatGeojson, arrestLocationRows }`.
- `beats.ts:patrolBeatBoundaries` - `(input: unknown)` returning the array type inferred from `beats.ts:BeatBoundariesSchema` (no named type is declared); the PD1 and PD2 features of the polygon snapshot as `{ code, name, geometry }` records.
- `beats.ts:BeatBoundariesSchema` - the Zod schema for those records.
- `workbook.ts:readChildSheets` - `(file) => Promise<{ charges, offenses }>`; reads the Charges and Offenses sheets without trimming values.

## Invariants

- `acquire.ts:acquire` takes the workspace from `intakeWorkspace` and throws that function's errors when `INTAKE_WORKSPACE` is not an absolute path to an existing folder.
- `acquire.ts:receiptSchema` (not exported) requires a strict `acquisition-receipt.json` with five 64-character lowercase hex SHA256 values, the audit sheet name `Beat Location Audit`, header row 4, `arrestLocationAuditRows` as a non-negative integer, `arrestLocationAuditCsvConversion` as a string, and `addressPointService` as a URL.
- `acquire.ts:acquire` throws when the workbook hash differs from the receipt, when the income or arrest-location evidence names a different workbook, when the audit workbook, audit CSV, or beat polygon hash differs from its receipt, when the audit CSV row count differs from the receipt, when no raw ACS file exists, and when `income-receipt.json` is not dataset `2024/acs/acs5`, table `B19013`, vintage `ACS2024_Current`.
- `acquire.ts:verifyResidentialEvidence` (not exported) throws unless all of these hold:
  - The keys of `address-tract-map.json` are exactly the hashes of the workbook's `Booking_Address` values.
  - Each geocoder input CSV has an output CSV with the same number of rows and one row per response identity.
  - Each geocoder input row is a workbook address that has an output row, is submitted once across all input CSVs, and has the street, city, state and ZIP of the workbook address.
  - For an input row whose map entry has status `matched`, the output row is a `Match` whose tract, quality and state agree with the entry.
  - No input row has a map entry with status `pending`. An entry that is in no input CSV is not checked for `pending` here.
  - Every map entry with status `matched` is in an input CSV. An entry with another status need not be.
- `acquire.ts:acquire` writes nothing until every check has passed, including the beat feature checks in `beats.ts:patrolBeatBoundaries`.
- `workbook.ts:readChildSheets` throws `Missing source worksheet <name>` and `Unsupported raw source cell type` for a cell that is not empty, a string, or a number, and requires the columns `Booking_No`, `Charge`, `Charge_Literal`, `Level` on Charges and `Booking_No`, `Offense`, `Description`, `Offenses` on Offenses.
- `arrest.ts:normalizeWorkbook`:
  - It throws `Missing booking enrichment`, and `conflicting booking dimension <key>` when repeated rows of one booking disagree on a date, hour, or district value.
  - It validates each arrest, charge and offense row with an inline Zod object and throws a `ZodError` for a missing column, and for an empty `Booking_No` on a charge or offense row.
  - It links a charge or offense row to its booking by `arrest.ts:bookingNumber`. A row whose booking is not on the Arrest Data sheet is counted in `orphanChargeRows` or `orphanOffenseRows`, which are published in the agency `audit`.
  - A date or time that does not parse is not an error. An unparsed date gives `unknown` for year, month, ISO week and day of week; an unparsed time gives `unknown` for the hour; a blank or `NULL` district gives `unknown`.
  - It rewrites an officer name `LAST,FIRST` to `FIRST LAST` and drops a blank or `NULL` name (`arrest.ts:officerName`, not exported). These are the names that `transform.ts:transform` passes to `data.resolvePersonnel`.
- `arrest.ts:bookingNumber` throws `gov/irvingtx/arrests: <sheet> row <row> has no Booking_No` for a `Booking_No` that is blank or `NULL`, on the Arrest Data, Charges and Offenses sheets. The row number is the row in the sheet, counting the header as row 1. `arrest.ts:normalizeWorkbook` and `enrichment.ts:enrichBookings` both key a booking by this value.
- `arrest.ts:parseNormalizedArrest` validates against a strict schema, so a normalized booking with an unknown key is rejected.
- `arrest.ts:buildProfile` throws `Duplicate normalized booking` and `Conflicting tract income`.
- `beats.ts:BeatBoundariesSchema` rejects a repeated beat code with `Duplicate patrol beat <code>` and a ring with fewer than four positions.
- `enrichment.ts:enrichBookings` assigns a beat, with `beatStatus` `matched`, only when all of these hold. Every other case keeps a null beat and another `beatStatus`.
  - The booking's rows have exactly one arrest location and it is not blank (else `missing_arrest_location` or `conflicting_arrest_locations`).
  - Exactly one audit row has that arrest location (else `missing_geocode_evidence` or `conflicting_geocode_evidence`).
  - The audit row's `Geocode_Quality` is `HIGH` or `MEDIUM` (else `unreliable_geocode`).
  - Exactly one PD1 or PD2 polygon contains the point, and the point is on the boundary of no PD1 or PD2 polygon (else `ambiguous_polygon_match`).
  - When no PD1 or PD2 polygon contains or borders the point, the other polygons decide the status: `other_polygon`, `outside_irving`, `ambiguous_polygon_match`, or `outside_polygon_coverage` when none contains it.
- `enrichment.ts:enrichBookings` and `beats.ts:patrolBeatBoundaries` do not read a beat polygon's `IsActive` value and do not require it. `beats.ts:patrolBeatBoundaries` requires `Code`, `Name` and `BattalionC` to be strings on every feature and throws a `ZodError` otherwise; other properties are ignored. It keeps only the PD1 and PD2 features, the patrol beats; the other features of the snapshot are not published.
- `enrichment.ts:enrichBookings` throws `Invalid reliable arrest geocode evidence`, `Invalid beat polygon coordinate`, `Empty beat polygon`, `Residential geocode is pending`, and `Invalid matched residential tract evidence`.
- `enrichment.ts:parseAcsIncome` throws on an invalid header, row width, tract identity, or income value, and on `Conflicting ACS tract income`.
- `transform.ts:transform` throws:
  - when `data` is absent;
  - when the normalized bookings or `analytics-provenance.json` are missing (`run acquire first`);
  - with a `ZodError` when `analytics-provenance.json` fails its strict `{ beatBoundaries, provenance, audit }` schema;
  - with `Duplicate normalized booking`, through `arrest.ts:buildProfile`;
  - with `Missing patrol boundary for beat <beat>`;
  - with `gov/irvingtx/arrests: the data context has no resolveAgency.` when the data context has no `resolveAgency` method;
  - when the agency `Irving Police Department` does not resolve (`import the roster first`).
- `transform.ts:transform` states its row accounting with two entries:
  - `arrests-normalized.jsonl`: `read` is the number of normalized bookings parsed, and `emitted` is `totalArrests` of the agency profile. Every booking is in the agency profile, whether or not an officer name resolves, so `reported` is 0 and `notSelected` is empty. A booking with no resolved officer is in no officer profile; the agency `coverage` counts those bookings in `arrestsWithNoResolvedOfficer`.
  - `analytics-provenance.json`: one document read and emitted on the agency profile.
- `transform.ts:transform` adds a booking to an officer's profile once, even when two of the booking's officer names resolve to the same `agencyPersonnelId`. A booking whose names resolve to several officers is in each of their profiles.

## Side Effects

- `acquire.ts:acquire` reads `arrests.xlsx` and every file in `geography/` under `<workspace>/gov/irvingtx/arrests/source/`. `acquire.ts:verifyResidentialEvidence` reads the geocode input and output CSVs there.
- `acquire.ts:acquire` writes `<sourceDir>/evidence/arrests.xlsx`, a copy of `geography/` at `<sourceDir>/evidence/geography`, `<sourceDir>/arrests-normalized.jsonl`, and `<sourceDir>/analytics-provenance.json`.
- `acquire.ts:acquire` makes no network call. It copies the receipt's `addressPointService` URL into the provenance.
- `workbook.ts:readChildSheets` reads the workbook file.
- `transform.ts:transform` reads the two files written by acquire, calls `data.resolveAgency` once and `data.resolvePersonnel` once per distinct officer name, and writes `<state>/arrest-report.json`.
- `acquire.ts:acquire` and `transform.ts:transform` log counts through the injected `logger`.

## Verification

- Run: `npx vitest run test/sources/gov/irvingtx/arrests`
