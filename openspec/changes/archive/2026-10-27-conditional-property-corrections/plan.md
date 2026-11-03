# Implementation plan

1. Prove the old path-keyed transform loses the required separation with regression tests; retain the failing CLI-correction-to-generated-path test.
2. Use geography type plus GEOID for state, county, place, subdivision and consolidated-city records, geometry keys and parent references. Alias keys combine the place key and alternate county key. Preserve source polygons.
3. Configure ordinary shared path resolution during generation, after the shared correction stage. Add no source correction hooks. Validate unresolved unique-key collisions.
4. Migrate existing workspace mappings using canonical IO and verified old/new source evidence; preserve established IDs and move path-addressed corrections to their stable keys. Do not write the database or acquired sources.
5. Verify focused tests, generated contracts, typecheck, build and OpenSpec; transform saved Census sources and audit key/reference/identity preservation.
