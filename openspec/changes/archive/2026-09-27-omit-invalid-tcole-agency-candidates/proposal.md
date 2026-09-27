# Omit invalid TCOLE agency candidates

## Why

Live regeneration fails because newly exposed inactive departments emit city null, which the existing Agency artifact contract rejects. The user directed sources to omit invalid records rather than weakening validation or omitting their invalid fields.

## What Changes

Validate each TCOLE agency candidate against the canonical Agency spec. Report and omit invalid agency records. Existing source filtering of assignment and contact references removes dependents of omitted agencies. Preserve the raw workbook. Reject the user-approved placeholder address/city values and malformed or all-zero-prefix ZIPs in the shared schema across sources. Shared eligibility still handles valid candidates across sources.

## Capabilities

### Modified Capabilities

- `agency-record-selection`: distinguish source validity from shared eligibility.

## Impact

The canonical shared Agency field schemas, their generator metadata, TCOLE producer, and regression tests change. The generated envelope contract becomes stricter for agency address fields. No database schema migration, seed change, dependency, database deletion, or reset is needed.
