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

The manual source runs explicitly, using the commands above, and is excluded
from automatic multi-source updates. Its already generated mutations are still
included when replaying the full data chain.

This creates the location; it does not infer an agency's membership in a
boundary-free community. Such agency assignments still require the existing
explicit manual resolved-property mechanism. No boundary, nearest-place rule,
or postal-name fallback is added.
