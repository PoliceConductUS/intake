# Design

Acquire preserves the input workbook and downloaded evidence (geocoder responses, ACS responses, official beat polygons), all with hashes/provenance. A pure normalization stage groups Booking_No once and retains every charge/offense tuple and multiplicity. Distinct charge tuple identity includes all supplied charge columns; Charge alone is not an ID. Repeated booking source rows remain inspectable, with conflicting addresses handled explicitly.

The normalized contract is strict and rejects old first-charge records. Date/beat/income dimensions count bookings; charge dimensions report source row count, distinct full charge tuples, and distinct bookings involving each charge category. Sparse joint cells retain month, arrest beat and residential tract/income with offense and level counts for website filters. Unknown or conflicting source/geocode coverage is measured from actual inputs. No arrestee names, addresses, booking IDs or exact address coordinates in public aggregate fields.

Income is ACS 2024 B19013 estimate, margin of error, annotations, and vintage for the matched residential tract. No dollar bands are invented at intake. Beat polygon source/vintage and geocode provenance are retained. Existing private verified Census cache can be acquired as evidence when its source address keys and vintage match. No guessing from District codes.

AgencyArrestProfile (agency_id unique, coverage/breakdowns JSONB) includes all bookings. Existing ArrestProfile retains its officer assignment FK and contains only bookings resolvable to that officer; agency totals never sum officer totals. Both use canonical generated IO and the shared diff/apply pipeline. Canonical IDs remain durable through the source ledger.
