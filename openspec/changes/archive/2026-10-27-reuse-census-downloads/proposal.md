# Reuse matching Census downloads

## Why

Census acquisition starts in a new command directory and cannot reuse a completed acquisition. Its filename-only resume check also fails to detect changed or damaged files.

## What Changes

Provide acquisition modules with the previous completed and interrupted output directories. Census checks selected ZIPs in those directories and the current output, comparing remote archive metadata through small HTTP range requests and validating local entry checksums. Matching files are copied into the new acquisition; missing or differing files are downloaded. Earlier acquisition directories remain unchanged. Resuming a different vintage does not carry unrelated ZIPs into the selected input set.

## Capabilities

### Modified Capabilities

- `config-driven-source-import`: reuse verified Census downloads across acquisition commands.

## Impact

Acquisition context, Census downloader, shared ZIP integrity reader, and regression tests. No dependencies, schema migrations, seed changes, generated types, database reset, or identity changes.
