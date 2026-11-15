# Select records reachable from qualifying agencies

## Why

TCOLE filters departments by STATUS before shared intake can evaluate agency assignments and case relationships. Eligibility belongs in shared intake so sources apply the same rule and historical assignments at qualifying agencies remain available.

## What Changes

- Root agencies are the union of agencies with null-ended assignments and agencies linked to civil cases, evaluated before and after incoming updates.
- Traverse shared directed inclusion edges, including current and historical assignments, personnel, and related records.
- Preserve updates to existing canonical records independently of new-record eligibility. Intake never deletes records.
- Preserve source artifacts, source mappings, canonical IDs and URLs, explicit exclusions, and independent reference data.

## Capabilities

### New Capabilities

- `agency-record-selection`: shared agency qualification and directed record selection.

## Impact

Changes TCOLE candidate emission, shared import selection, focused tests, and documentation. No schema migration, generated database type refresh, dependency change, or seed edit is needed. No live database reset or production migration is performed. Existing artifacts and mutations must be regenerated to use the rule. CourtListener acquisition and matching remain unchanged; an agency may be filtered before CourtListener queries it, as accepted by the user.
