# Omit invalid TCOLE agency candidates

## Why

Live regeneration fails because newly exposed inactive departments emit city null, which the existing Agency artifact contract rejects. The user directed sources to omit invalid records rather than weakening validation or omitting their invalid fields.

## What Changes

Validate each TCOLE agency candidate against the canonical Agency spec. Report and omit invalid agency records. Existing source filtering of assignment and contact references removes dependents of omitted agencies. Preserve the raw workbook. Shared eligibility still handles valid candidates across sources.

## Capabilities

### Modified Capabilities

- `agency-record-selection`: distinguish source validity from shared eligibility.

## Impact

Only the TCOLE producer and regression tests change. No schema, seed, generated type, dependency, database deletion, or reset changes.
