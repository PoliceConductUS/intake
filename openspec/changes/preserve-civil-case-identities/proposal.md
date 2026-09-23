# Preserve established civil-case identities

## Why

Six published civil cases are imported under court:docket IDs instead of their
original production IDs. Their original slugs are consequently not reused.
CivilCase currently bypasses the durable identity ledger (ADR 0028).

## What Changes

CivilCase resolves an existing source-name mapping before using its source-provided
natural ID. Restore confirmed original mappings for both case-producing sources
and published slugs in the durable workspace. Related case-personnel and case-link
records must resolve the restored parent ID through the existing reference chain.
No case-specific exceptions, new registry, or broad identity regeneration.

## Impact

No schema, seed or acquisition changes. Update ADR 0028's established-ID rule.
The six corrections are workspace mapping/cache data only. Retain audit receipts
and verify generation with empty case tables uses the original IDs, slugs and
dependent references. The next normal reset applies them; do not patch database
rows or rewrite existing applied mutation history.
