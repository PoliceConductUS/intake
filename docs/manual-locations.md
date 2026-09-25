# Add a location manually

Use `org.policeconduct.manual` for a verified community missing from Census.
Choose the existing intake workspace and database before running these commands.
The county parent must already exist. A community does not need a polygon,
centroid, or bounding box.

For example, to record Ivanhoe under Fannin County:

```bash
MANUAL_KIND=LocationPath MANUAL_RECORD='{
  "location_path_id": "/tx/fannin-county/ivanhoe/",
  "path": "/tx/fannin-county/ivanhoe/",
  "level": "place",
  "display_name": "Ivanhoe",
  "parent_location_path_id": "/tx/fannin-county/"
}' npm run cli -- data acquire org.policeconduct.manual

npm run cli -- data transform org.policeconduct.manual
npm run cli -- data generate org.policeconduct.manual
npm run cli -- data up
```

The same fields are available in the interactive interview when `MANUAL_KIND`
and `MANUAL_RECORD` are omitted. Leave optional geometry-related fields blank.

Here `location_path_id` is a stable source-local name, not a canonical database
ID. Intake assigns or reuses its canonical ID through the workspace mapping
ledger. `parent_location_path_id` is the existing parent's path; import resolves
it to the parent's canonical ID. An unknown parent fails rather than creating
or guessing one. For a previously published location, preserve its original
path and existing canonical identity mapping.

Aliases can be acquired as `LocationPathAlias` records referencing the new
place's path, including in the same batch before transform/import. The manual
source saves its records in workspace state, and generated mutations join the
workspace's data chain. Rebuilding from schema migrations and that chain restores
the same location IDs, paths, parents, and aliases. Preserve the workspace,
including its mappings and manual state.

The manual source runs explicitly using the commands above and is excluded from
`data update`. `data reset --no-acquire` loads manual locations and aliases after
Census, before agency imports, then applies the complete manual source after the
automatic sources. Its generated mutations are included when replaying the chain.

This creates the location; it does not infer an agency's membership in a
boundary-free community. Such agency assignments require an explicit cached
resolution. Inspect the agency's current cache and set its location by canonical
ID, using its namespace and source ID:

```bash
npm run cli -- cache get <namespace> Agency <source-id> location_path_id
npm run cli -- cache set <namespace> Agency <source-id> location_path_id <canonical-location-id>
```

If a value already exists, set reports an error and shows the current cache.
Add `--force` to replace it explicitly. `get` shows one `entries` array. Its
single entry without an `inputFingerprint` is the active override. Replaced
overrides have unique `previous-override-N` fingerprints. New CLI overrides
record `recordedAt`, source identity, and `commandId`; the command's envelope
under the workspace's `command/` directory records its arguments. Previous
entries keep this evidence. A manual override remains authoritative until
changed; it is retained across database resets. Source-supplied fields retain
their existing precedence over resolver values. Generation must run afterward
to update the database. No community boundary is invented.
