# Select a published Census release

## Why

The current Gazetteer page publishes 2026 before TIGER2026 shapefiles are available. Acquisition constructs nonexistent TIGER URLs and fails after downloading Gazetteer files.

## What Changes

Select the newest Gazetteer year also listed in the official TIGER shapefile release index. Follow the Gazetteer page's published year link when needed. Check that the required TIGER files are listed before downloading any source ZIPs. Log the selected year. Never mix years or treat network errors as reasons to silently change releases.

## Capabilities

### Modified Capabilities

- `config-driven-source-import`: Census acquisition selects a shared published vintage.

## Impact

Census acquisition discovery and tests only. No database migration, seed change, generated type refresh, reset, or identity mapping changes.
