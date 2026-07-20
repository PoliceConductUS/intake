## Why

The civic index state pages need an "Officer licensing" section (how officers
earn and keep the state license) as factual counterbalance to the
decertification report card. Licensing-requirements facts currently have no
home in the database and no committed raw-data location, so they cannot be
imported or re-imported.

## What Changes

**Licensing summary data model**

- From: `public.location_reports` holds only `decertification_report_card`
  rows; licensing facts have no data home.
- To: `public.location_reports` also carries `report_type =
'licensing_summary'` rows (one per state, `report_key =
'licensing-summary'`), with sources in `public.location_report_sources`.
  No schema migration is required; the payload contract is specified.
- Reason: The state civic index page renders licensing facts next to the
  decertification card; both are state-level location reports.
- Impact: New payload contract; app-side rendering consumes it later.

**Committed per-state raw data**

- From: `supabase/seed.sql` is gitignored, so hand-curated report content has
  no durable, reviewable home.
- To: `data/licensing/<state-slug>/licensing.json` is the committed raw input
  per state licensing organization, with explicit checked-in IDs, source
  links, and a `verified`/`pending` status. Texas is populated and verified;
  all other states are pending stubs awaiting research.
- Reason: Raw inputs and provenance must be preserved and re-importable.
- Impact: New `data/licensing/` tree with 51 state folders.

**Licensing import command**

- From: No import path exists for location reports.
- To: `intake import licensing [state-slugs...]` validates the committed
  files and deterministically replaces each verified state's licensing
  summary row and its sources in `DATABASE_URL` (delete-then-insert by
  `(location_path_id, report_key)`, explicit IDs from the file). Pending
  states are reported visibly as skipped. `--dry-run` prints the plan.
- Reason: The operator must be able to import and re-import as source data
  is collected, without touching seed data.
- Impact: New CLI subcommand and tests.

## Capabilities

### New Capabilities

- `state-licensing-summaries`: committed per-state licensing raw data, the
  `licensing_summary` location-report payload contract, and the
  deterministic import/re-import command.

### Modified Capabilities

- None.

## Impact

Affected areas: `data/licensing/` (new), `src/cli/import/licensing/` (new),
`test/import/licensing.test.ts` (new). No migrations; no seed changes; no
data reset required. Downstream: policeconduct.org state pages will read the
new report_type.
