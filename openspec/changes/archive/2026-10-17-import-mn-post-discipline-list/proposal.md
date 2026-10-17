## Why

MN POST collection starts from agency rosters. The supplied discipline workbook has 571 distinct license numbers, including 494 non-active licenses missing from the earlier collection. Discipline must apply to personnel independently of agency assignment.

## What Changes

- Read the supplied workbooks and collect exact license-number search results and details.
- Admit personnel from those results even without a current roster assignment.
- Preserve explicit employment-history links without inferring where discipline occurred.
- Reconcile all input license numbers and report missing action details explicitly.
- Retain the 34 unresolved licenses as requested, with raw source evidence and explicit coverage reports.
- Use official complaint IDs for actions whose displayed case labels are not unique; preserve existing canonical IDs through the shared, audited source-alias command.
- Carry explicit personnel roots through canonical Artifacts IO so unassigned people remain importable.

## Capabilities

### New Capabilities

- `mn-post-discipline-coverage`: spreadsheet-driven personnel and discipline acquisition.

## Impact

MN POST source acquisition and transform, shared personnel admission, typed Artifacts metadata, a shared source-alias CLI operation, and regression tests. No schema change, data reset, or viewer contract change. Import through the existing durable mapping and mutation chain.
