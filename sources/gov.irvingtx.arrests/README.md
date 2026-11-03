# Irving arrest analytics

The source imports agency and officer aggregates from the complete Irving workbook and explicitly acquired geographic evidence. It does not choose a primary charge.

## Private acquisition inputs

Under `$INTAKE_WORKSPACE/gov.irvingtx.arrests/source/`:

- `arrests.xlsx`: original workbook, with Arrest Data, Charges and Offenses sheets.
- `geography/acquisition-receipt.json`: SHA256 pins for the original workbook, source workbook used for both enrichment datasets, original location-audit workbook and its CSV export, plus source/sheet/conversion metadata.
- `geography/arrest-location-audit.xlsx` and `.csv`: original coordinate audit and complete sheet export (all source columns). CSV columns include arrest location, Latitude, Longitude, Geocode_Method and Geocode_Quality. The importer verifies file hashes and row count.
- `geography/beat-polygons.geojson` and `beat-receipt.json`: official Irving polygon snapshot, source URL, hash and retrieval metadata.
- `geography/address-tract-map.json`, `geocode-acs2024-*-input.csv`, and matching output CSVs: residential Census geocode evidence. Original address hashes, submitted address components, response identities and matched tract/state/quality must agree.
- `geography/acs2024-state-*.json` and `income-receipt.json`: raw Census ACS 2024 five-year B19013 responses and dataset/vintage metadata.

Acquisition copies the original workbook and full geographic evidence bundle into the command evidence directory. These contain private addresses and names; they are not public website artifacts. Normalized booking records also remain private. Old first-charge-only normalized files are rejected.

Run the ordinary `data acquire gov.irvingtx.arrests`, `data transform gov.irvingtx.arrests`, `data generate gov.irvingtx.arrests`, and `data up` commands with the intended workspace/database configuration. Inspect generated changes before applying. `data verify` verifies the applied chain; repeated transform/generate must yield an empty diff.

## Website data contract

`public.agency_arrest_profile` has one record per agency, joined through `agency_id`. It includes all supplied bookings regardless of officer resolution. `public.arrest_profile` remains one record per resolved `agency_personnel_id`; its aggregates cover only those matched bookings. Do not sum officer profiles to derive agency totals.

Both tables expose `coverage` and `breakdowns` JSON. Coverage counts:

- `totalArrests`: distinct Booking_No values.
- `sourceArrestRows`: original arrest rows, including repeated bookings.
- `chargeRows`: every linked source charge row, including exact repeats.
- `distinctChargeRecords`: unique complete code/literal/level tuples within each booking. This is not a certified count of distinct legal charges because the supplied Charge value is not a unique identifier.
- `arrestsWithLinkedCharges` and `arrestsWithoutLinkedCharges`: booking-level linkage coverage. Missing links do not establish absence of legal charges.
- `offenseRows`, `distinctOffenseRecords`, `arrestsWithLinkedOffenses`: separate Offenses-sheet coverage.
- `firstMonth`, `lastMonth`: observed source period.

The agency additionally exposes `audit` raw/linked/orphan source reconciliation, `arrestsWithNoResolvedOfficer`, `unresolvedNameCount`, `officersProfiled`, and `dataQualityFindings`. The finding code `bookings_without_matching_charge_records` has `count`, `totalBookings` and `reason: unknown`. The website can state the verified count of bookings without matching charge records as a supplied-data quality issue.

Breakdowns preserve arrest counts by time, `by_arrest_beat`, `by_residential_tract`, coverage status, and `by_source_district` (uninterpreted original source codes, not assigned police beats). For offense and level there are three distinct measures: `charge_rows_by_*`, `distinct_charge_records_by_*`, and `arrests_by_*`. An arrest with several charge categories contributes once to each relevant category, so category booking counts must not be summed as if mutually exclusive.

`cells` contains joint month/arrest-beat/residential-tract/status counts and all three charge measures. Website filters can aggregate these cells. `residential_income_by_tract` supplies exact ACS median household income estimate, margin of error, estimate/MOE annotations, and `topcoded`. A topcoded 250000 value represents 250,000+, not an exact median. Income is a residential-area proxy, not personal income. All income values use the pinned 2020–2024 ACS period in 2024 inflation-adjusted dollars.

A beat is assigned from the arrest location's evidence point and official PD1/PD2 patrol polygons. The enclosing OTHER polygon is a coverage class, not a competing beat. Conflicting locations, unreliable points and unmatched locations retain explicit status and remain in overall counts. The downloaded polygons supply no historical effective dates. No home-beat concept is produced.

These aggregates support counts, charge distributions and charges per booking. Population arrest rates require separate matching population denominators. Public output excludes arrestee names, street addresses, booking identifiers and exact address points. Provenance includes source hashes, dataset/version information and documented geographic coverage.

`breakdowns.arrest_beat_boundaries` on the agency profile contains the official patrol snapshot as `{code, name, geometry}` records. Geometry is Polygon or MultiPolygon. Personnel profiles reuse their agency's boundaries with their own beat counts; boundaries are not duplicated into every personnel profile. Reacquire and transform existing inputs to produce this required map contract. The website currently displays beat maps on personnel and agency pages only; city and higher rollups remain deferred.
