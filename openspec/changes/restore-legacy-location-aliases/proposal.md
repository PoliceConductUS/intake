# Restore confirmed legacy location spelling aliases

## Why

The production comparison found 104 absent location IDs. Nineteen old paths
already resolve through aliases. Twenty more paths are confirmed spelling,
spacing, punctuation, or abbreviation variants of current canonical places.
Other missing paths include distinct communities, conflicting counties, and
changed administrative geographies and cannot be resolved by name alone.

## What Changes

Add the twenty reviewed spelling aliases through `org.policeconduct.manual`,
then generate and apply a normal appended data-mutation entry. Keep the batch
and its evidence in this change. Review all 104 rows individually and record
remaining candidates and reasons for withholding aliases.

## Impact

No schema migration, seed change, new acquisition, location creation, agency
relocation, or production deployment. Canonical location IDs and paths remain
unchanged. Aliases restore old path resolution, not the retired location IDs.
The manual source state and appended replay entry preserve the aliases on reset.
