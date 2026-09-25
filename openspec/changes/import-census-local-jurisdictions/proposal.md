# Import Census local jurisdictions

## Why

The Census namespace currently imports only PLACE features and loses legitimate website places such as Alba township, Jackson County, Minnesota.

## What Changes

Import legal/local county subdivisions and consolidated cities in the existing 50-state-plus-DC scope. Exclude statistical divisions. Skip subdivisions whose full polygon is covered by the union of existing PLACE polygons. Retain the full original Census boundary for each remaining subdivision, preserve existing canonical paths and IDs, and distinguish geography resolution classes. Prefer a containing PLACE, then county subdivision, then consolidated city; reject ambiguity within the winning class.

## Capabilities

### Modified Capabilities

- `artifacts-database-import`: Census place coverage and containing-place selection.

## Impact

Census acquisition, transformation, source validation, location resolution, ADR 0024, and tests. A new additive migration records `location_path.resolution_class`; existing rows have the primary class. Generated envelope/database types must be refreshed. Existing source files lack COUSUB/CONCITY and require Census acquisition before the updated transform. No database reset, production deployment, agency reacquisition, or rewrite of existing identity mappings is required.
