# Add nullable agency status fields

## Why

The TCOLE export reports agency status, but intake currently discards it. Preserve that fact and its supplied date without changing agency eligibility.

## What Changes

Add nullable status text and status_date date columns to public.agency, regenerate canonical contracts, and emit the TCOLE fields. Missing dates remain null. Inspect MN POST and map explicit agency status/date values if supplied. The user-approved interpretation of DATE_OFFICIAL is the current status's official date.

## Capabilities

### New Capabilities

- `agency-status`: retain source-reported agency status and nullable status date.

## Impact

One additive Supabase migration, generated Agency contracts, TCOLE transformation, and focused tests. Existing seed inserts remain valid with null defaults; no seed mutation or data reset is required. Apply the migration before running the updated importer. No viewer, audit tables, event kinds, triggers, dependencies, deletion, or changes to selection rules.
