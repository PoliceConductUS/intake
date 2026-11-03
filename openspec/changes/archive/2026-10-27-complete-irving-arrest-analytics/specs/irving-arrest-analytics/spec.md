## ADDED Requirements

### Requirement: Preserve complete arrest and charge evidence

Intake SHALL preserve the original workbook and every supplied charge and offense row. An arrest SHALL be counted once per Booking_No. No charge SHALL be selected as primary or discarded because another row exists. Source charge row counts, distinct complete charge tuples, and bookings involving a charge category SHALL be separately named and reconciled. Raw repeated rows SHALL remain inspectable.

#### Scenario: Multiple and repeated charge rows

- **WHEN** a booking has three charge rows, including two identical full tuples
- **THEN** intake retains all three rows, counts one booking, reports three source charge rows and two distinct reported charge tuples, and does not assert the duplicate rows are distinct legal charges

#### Scenario: Observed incomplete source joins

- **WHEN** the actual workbook contains a booking without a matching child row or a child row without an arrest
- **THEN** intake preserves and reports those source records explicitly without inventing a charge or interpreting absence as confirmed absence of charges

#### Scenario: Literal whitespace in source charge records

- **WHEN** supplied charge literals differ only in whitespace
- **THEN** their exact original values remain in normalized evidence and distinct source tuple counts; intake does not silently trim and collapse them

### Requirement: Keep arrest geography and residential income distinct

Intake SHALL assign arrest beat only from the arrest location and official Irving beat polygons, with source provenance. Residential addresses SHALL only supply Census geography and ACS income estimates for this analysis. Intake SHALL preserve estimate vintage, margins of error and annotations, and SHALL NOT describe area income as personal income. Conflicting observed addresses SHALL not be resolved by row order.

#### Scenario: Arrest and residence differ

- **WHEN** an arrest address is in one beat and the home address is in another area
- **THEN** the arrest beat comes from the arrest address and income comes from the home census tract, with no home-beat field

### Requirement: Complete public aggregates

Intake SHALL import an agency aggregate of every source booking and officer aggregates for resolvable assignments. It SHALL retain sufficient aggregate dimensions for arrests and complete charge distributions by arrest beat, residential tract income and time. Counts SHALL expose their units and source coverage. Public aggregates SHALL exclude arrestee names, addresses, booking identifiers and precise address points. Agency totals SHALL not be calculated by summing officer profiles.

#### Scenario: Officer cannot resolve

- **WHEN** a booking's officer cannot be matched to the roster
- **THEN** that booking and its charge records remain in the agency aggregate and the unresolved-officer coverage is reported

#### Scenario: Repeat import

- **WHEN** unchanged source and enrichment evidence are reimported
- **THEN** shared comparison produces no database changes and existing canonical IDs remain stable

### Requirement: Expose missing-charge source quality

The agency aggregate SHALL include an explicit data-quality finding with the number of bookings without matching charge records, total booking denominator, and unknown reason. These bookings SHALL remain in arrest totals. The finding SHALL describe incomplete supplied data and SHALL NOT assert that no legal charges existed.

#### Scenario: Irving supplied export gap

- **WHEN** the verified workbook has 9,447 of 41,211 bookings without matching charge records
- **THEN** the persisted agency finding exposes count 9447, totalBookings 41211, reason unknown, and a stable finding code for the website

### Requirement: Interpret source polygon classes

Intake SHALL identify patrol beats using the official PD1 and PD2 polygon classes. Non-patrol OTHER and outside-city coverage polygons SHALL not compete with a patrol match. A shared patrol boundary or multiple patrol matches SHALL remain ambiguous. When no patrol matches, source outside-city and OTHER classifications MAY describe coverage without inventing a patrol beat.

#### Scenario: Enclosing OTHER polygon

- **WHEN** a point falls inside one PD1 beat and the enclosing OTHER polygon
- **THEN** it receives the PD1 beat because OTHER is not a patrol beat
