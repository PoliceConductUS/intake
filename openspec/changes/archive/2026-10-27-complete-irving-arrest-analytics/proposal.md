## Why

The Irving source discards all but the first charge and counts repeated booking rows as arrests. Its officer-only aggregates omit unmatched-officer records and have neither verified arrest beats nor residential-area income. These summaries cannot support the requested accurate analysis.

## What Changes

Preserve original workbook and all child rows, group arrests by Booking_No with explicit repeated-row reconciliation, retain all charges and offenses, and produce lossless count aggregates. Enrich home addresses with Census tract ACS income and arrest addresses with official Irving beat polygons. Store complete agency and officer aggregates, with actual unmatched/conflicting coverage and provenance.

## Capabilities

### New Capabilities

- `irving-arrest-analytics`: complete neutral arrest/charge aggregation with arrest beats and residential-area income.

### Modified Capabilities

- `agency-record-selection`: agency aggregate records are included as agency descendants.

## Impact

Irving source modules and focused tests; new agency_arrest_profile table and generated canonical envelope contracts; shared declarative agency graph edge. Existing arrest_profile JSON contract changes and rows must be recomputed from original inputs. Apply additive migration to configured development DB then normal data acquire/transform/generate/up. No production publish or website implementation. Validate migration in an isolated test database, generated contracts, source reconciliation, actual DB values, and no-op reimport. No destructive reset of the populated DB.
