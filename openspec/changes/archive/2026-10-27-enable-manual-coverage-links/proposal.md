## Why

The manual intake source cannot currently accept coverage articles or their existing agency-personnel relationships, despite shared schemas supporting both records. Enabling the existing model-driven path allows the requested article association.

## What Changes

Add CoverageLink and CoverageLinkAgencyPersonnel to the manual source's supported kinds, using existing validation, acquisition and transformation.

## Capabilities

### New Capabilities

- `manual-coverage-links`: Acquire coverage links and existing personnel relationships without changing their supplied references.

### Modified Capabilities

None.

## Impact

Two additions in sources/org.policeconduct.manual/kinds.ts and one focused acquisition/transformation regression test. No migration, seed rows, database reset, generated type refresh, production migration, dependencies or downstream contract changes.
