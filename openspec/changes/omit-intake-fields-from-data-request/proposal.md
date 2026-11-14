## Why

The public data-request document is generated from the schema but was last
generated at schema `20261010000000`. Since then the schema gained columns and
tables that only intake fills in. Regenerating as-is would ask agencies to
supply intake's own bookkeeping, and nothing detected that the committed
document had gone stale. The document is sent to records custodians, so it must
ask only for what a provider can supply.

## What Changes

**Fields only the Institute fills in**

- From: the generator lists every column except database-managed and
  intake-computed ones.
- To: it also omits `ai_complaint_summary`,
  `complaint_summary_unavailability`, `created_by`, `data_source_values`,
  `normalized_url`, `source_exclusions`, `source_namespaces`, and
  `updated_by`.
- Reason: a provider cannot supply them; they are under the Institute's
  exclusive control.
- Impact: `normalized_url`, `created_by`, and `updated_by` were in the
  previously committed document and are removed from it.

**Record types the Institute produces**

- From: `ArrestProfile` and the location kinds are omitted.
- To: `AgencyArrestProfile`, `DataAnnotation`, and `PersonnelPhoto` are
  omitted too.
- Reason: derived summaries, annotations, and files in intake's workspace are
  not provider records.
- Impact: non-breaking; the committed document never listed them.

**Regenerated document**

- `docs/data-request-format.md` is regenerated at schema `20261113000000`.
  One `start_date` field changes from required to optional, following the
  schema.
- A new test fails when a committed generated file differs from its
  generator's output.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `data-request-document`: adds a requirement that the Simplified Export
  Format omits fields and record types under the Institute's exclusive
  control, and that the committed document matches its generator.

## Impact

- Code: `scripts/lib/data-request-doc-generator.ts`.
- Document: `docs/data-request-format.md`.
- Tests: `test/data-request-doc.test.ts`,
  `test/generated-files.integration.test.ts`.
- Migrations: none. Intake sources: none. No data reset.
- Downstream: anyone holding the previous document sees a new format version.
