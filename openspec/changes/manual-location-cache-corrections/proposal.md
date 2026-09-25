# Manual missing places and cache corrections

## Why

The reviewed 29 Texas communities are legitimate places absent from Census place boundaries. They require durable manual records and an operator-facing way to inspect and correct resolved properties such as agency location assignments.

## What Changes

- Record the 29 confirmed communities through the manual source, retaining published IDs and paths through durable identity mappings.
- Add `cache get <namespace> <kind> <source-id> <property>` and `cache set <namespace> <kind> <source-id> <property> <value> [--force]`.
- Resolve the source identity through the existing ledger, validate kind/property/value against the canonical entity model, and read/write through canonical ResolvedProperty IO.
- Store explicit manual cache overrides with source provenance. They take precedence over automatically resolved cache entries until changed. Retain prior automatic entries and record replacement history. Existing values require `--force`; otherwise return an error showing them.
- During reset, apply manual location records after Census and before agency imports; apply the complete manual source at the end.

- Remove checked-in resolved-property cache seeding and its files; the CLI is the canonical method for manual cache corrections.

## Impact

Cache envelope schema, CLI, reset sequencing, durable manual workspace records, tests and documentation. No SQL migration, dependency, generated entity contract change, or automatic agency assignment is required. Cache corrections remain explicit operator actions.

## Capabilities

### Modified Capabilities

- `config-driven-source-import`: manual geography and CLI-managed cache overrides.
