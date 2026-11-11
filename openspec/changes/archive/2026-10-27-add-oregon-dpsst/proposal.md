## Why

Oregon supplies public officer and agency records with actual employment dates.
The existing intake pipeline has no Oregon source.

## What Changes

Add `gov.or.dpsst` acquisition of paginated public name searches, employment and
certification detail pages, and linked agency pages. Preserve raw HTML and an
acquisition manifest. Transform these into existing agency, personnel, assignment,
authority, license, license-action and agency-phone artifacts. Report unsupported
or incomplete source records visibly and preserve their raw evidence.

## Capabilities

### New Capabilities

- `oregon-dpsst`: reproducible acquisition and transformation of Oregon CJ IRIS.

### Modified Capabilities

None. Shared import behavior remains unchanged.

## Impact

New source modules and tests only. No dependencies, Supabase migrations, seed
changes, database reset, generated contract refresh, or production migration.
Live verification uses the configured local intake pipeline; no production writes.
