# Restore a published review through manual intake

## Why

The December 4, 2023 first-party report was omitted by source-only rebuilds.
The manual source does not yet advertise Review or ReviewPersonnel records.

## What Changes

Allow Review and ReviewPersonnel through the existing manual acquire/transform
workflow, alongside the already supported ReviewLink. Preserve published IDs,
slugs, narrative and resolved personnel references using workspace mappings and
cache, never per-record code. ReviewPersonnel consults an established mapping
before its existing composed-ID rule, retaining that rule for unmapped records.

## Impact

No schema, seed or generated-contract changes. Restore only the requested report
and its evidence/personnel associations. Curated data lives in the workspace.
Use ordinary transform/generate/up commands; no direct database writes or reset.
Other reviews remain omitted pending the user's decision.
