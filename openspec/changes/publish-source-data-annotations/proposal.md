## Why

Source defects currently make employment records and sometimes entire personnel profiles disappear. Visitors and licensing authorities need to see the reported facts, our specific concerns, and downloadable evidence. A contradiction is an error; an unusual duration is a warning, not proof that the source is wrong.

## What Changes

- Preserve source data and import affected records with native `DataAnnotation` records instead of omitting records for factual defects.
- Store field, original value, type (`warning`, `error`, or `correction`), explanation, source namespace and source record ID with each annotation.
- Display annotations beside affected values and show reported dates without calculated tenure.
- Generate `/data-annotations/`: pagination, provider/type filters, and CSV download of all matching annotations across pages.
- Add a paginated annotations subpage linked from each licensing-authority page, listing annotations originating in that authority's data and offering the same full-result download.
- Carry correction annotations in generated mutations, replacing only the owning record/source namespace/source record ID contribution processed in the run, even when corrected values are unchanged. Unprocessed contributions survive; an empty replacement clears only that contribution.
- Generate native annotations during the existing generate stage from effective values and corrections; up/replay only apply ordinary recorded mutations.

## Capabilities

### New Capabilities

- `source-data-annotations`: Preserve reported values and attach typed, source-attributed findings to imported records.
- `public-data-annotations`: Show findings beside data, in a central index, and under the supplying licensing authority, with filtered downloads.

### Modified Capabilities

- `agency-record-selection`: Source factual defects no longer remove otherwise identifiable records or their dependent records.
- `intake-date-validation`: Replace the now-archived temporary date-omission requirement with annotation-based preservation.
- `artifacts-database-import`: Replace invalid-contact omission with source-value preservation and annotations.

## Impact

Intake: shared source-value detection, generation-stage annotation production, DataContext, graph selection, source transform gates that discard factual defects, canonical envelope generators and mutation contracts. Add a forward Supabase migration for public.data_annotation and archive prior array evidence before dropping obsolete array columns; adjust affected value constraints only as needed to retain reported values. Preserve durable IDs, references and provenance.

Site: `../policeconduct.org` data loaders, affected record displays, licensing-authority routes, new central annotation routes and static CSV generation. Generated database/envelope types must be refreshed from their owners. No dependency, separate annotation table, annotation IDs, API, or notification workflow is proposed.

No production reset is required. Apply schema migration, regenerate imports from retained raw sources to restore omitted records and annotations, then rebuild the site. Existing seed records default to an empty annotation array; do not hand-edit generated seed data. Validate reset/migrations/seed in a disposable database.

This change supersedes the implemented omission behavior recorded in `archive/2026-10-27-reject-implausible-date-pairs` and the current `intake-date-validation` spec. Its explicit removal delta takes effect only when this annotation change is implemented and archived; until then omission remains the current behavior. The invalid-contact omission rule is likewise explicitly superseded. The user has explicitly requested this policy change.
