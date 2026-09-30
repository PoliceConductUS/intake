# Manual location creation

## Why

Real communities missing from Census need durable location records and URLs. The manual source currently offers aliases but not LocationPath creation.

## What Changes

Allow LocationPath records through the existing manual acquire, transform, import, and replay workflow. A manually created community may omit geometry. Parent references use existing location paths; canonical IDs use the existing durable mapping ledger. This does not change automatic address resolution or add community records without operator input.

## Capabilities

### Modified Capabilities

- `artifacts-database-import`: manually supplied locations persist through import and replay.

## Impact

Manual source supported kinds, operator documentation, and regression tests. The automatic source-order loader must respect the existing standalone flag, keeping manual curation out of automatic dependency ordering. No schema migration, seed change, generated type refresh, production deployment, or database reset is required. Existing IDs and URLs retain their current preservation rules.
