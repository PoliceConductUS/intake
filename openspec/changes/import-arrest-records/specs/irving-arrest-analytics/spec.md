## REMOVED Requirements

### Requirement: Complete public aggregates

**Reason**: The owner asked for a complete import of arrest records (2026-11-22). Aggregates become views over `arrest`, `arrest_charge`, `arrest_offense` and `arrest_agency_personnel`.

**Migration**: Use `arrest_coverage` and `arrest_breakdown` from the `arrest-records` capability. The tables `arrest_profile` and `agency_arrest_profile` are dropped.

### Requirement: Expose missing-charge source quality

**Reason**: The JSON finding in the agency aggregate is replaced by an annotation on each booking without charge records.

**Migration**: Read annotations with code `arrest_without_charge_records`; count them per agency for the total.
