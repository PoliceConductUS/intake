# Repair TCOLE True identities

## Why

The historical identity mapper interpreted Excel boolean name cells as raw XML
`1`. Five confirmed people and their employment records were omitted from the
identity maps and assigned replacement IDs during reconstruction.

## What Changes

Correct the historical reader and its regression test. Restore the five proven
personnel identities, published slugs, and corresponding employment identities
in the durable ledger and local reconstruction. Preserve all other field values,
license IDs, relationships, and raw input files. Retain the original replay
lineage as evidence and reconstruct a corrected lineage using canonical IO.

## Impact

No schema migration, generated contract change, or production deployment.
The local reconstruction must replay the corrected data successfully. Current
intake already decodes boolean cells as text; add a regression exercising real
Excel cells so this behavior cannot regress to numeric names.
