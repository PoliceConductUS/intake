# database

## Overview

The database access used by the other `src/cli` modules: the `DatabaseClient`
type and its `pg` factory, generic record reads and writes by table, and the
queries for `location_path`, the agency graph, the schema migrations, the
`public.data_mutation_applied` ledger and identity restoration.

It registers no CLI command.

## Interface

- `index.ts:DatabaseClient` - `{ connect(), query(text, values?), end() }`.
- `index.ts:DatabaseClientFactory` - `(databaseUrl) => DatabaseClient`.
- `index.ts:defaultDatabaseClientFactory` - `(databaseUrl)`; a `pg.Client`
  whose queries run one after another.
- `index.ts:rowsFromResult` - `(result)` returns the result's `rows`, or an
  empty list.
- `entities.ts:databaseRecordProjection` - `(tableName)` returns the select
  list; spatial columns are read as GeoJSON.
- `entities.ts:readDatabaseRecordByColumn`,
  `entities.ts:readDatabaseRecordByColumns`,
  `entities.ts:readDatabaseRecordsByColumn`,
  `entities.ts:readDatabaseRecordsByColumns` - reads by one or more columns.
- `entities.ts:createDatabaseRecords` -
  `(client, tableName, records, keyColumn)` returns the set of keys
  inserted. An empty `records` returns an empty set without a query.
- `entities.ts:updateDatabaseRecordFields` -
  `(client, tableName, keyColumnName, keyValue, values)`. An empty `values`
  returns without a query.
- `schema.ts:loadDatabaseSchemaMetadata` - `(client)` returns
  `DatabaseSchemaMetadata`: `{ importSchema: { appliedMigrations } }`.
- `schema.ts:DatabaseSchemaMetadata` - `{ importSchema }`.
- `schema.ts:ImportDatabaseSchema` - `{ appliedMigrations }`, a list of
  `{ version, name }`.
- `schema.ts:SupportedTableName` - the generated union of entity tables.
- `data-mutation-ledger.ts:readCurrentSchemaVersion`,
  `data-mutation-ledger.ts:readAppliedDataMutationVersions`,
  `data-mutation-ledger.ts:readAppliedDataMutationChecksums`,
  `data-mutation-ledger.ts:recordDataMutationApplied` - the ledger of applied
  data mutations.
- `location-paths.ts:readLocationPathById`,
  `location-paths.ts:readLocationPathByPath`,
  `location-paths.ts:readLocationPathAliasByPath`,
  `location-paths.ts:readLocationPathsContainingPoint` - `location_path`
  reads.
- `location-paths.ts:DatabaseLocationPathRow`,
  `location-paths.ts:DatabaseLocationPathAliasRow` - the row types, inferred
  from `LocationPathCreateSpec` and `LocationPathAliasCreateSpec`.
- `location-path-spatial.ts:geoJsonValue`,
  `location-path-spatial.ts:locationPathCentroidGeoJson`,
  `location-path-spatial.ts:locationPathBboxGeoJson` - GeoJSON helpers.
- `location-path-spatial.ts:LocationPathCentroid` - a GeoJSON `Point` with
  one pair of numbers.
- `location-path-spatial.ts:LocationPathBbox` - a GeoJSON `Polygon` whose
  one ring has five pairs of numbers.
- `agency-graph.ts:agencyTableIsEmpty` - `(client)` returns a boolean.
- `agency-graph.ts:readExistingAgencyGraph` - `(client, incoming)` returns the
  existing graph records.
- `restore-identity.ts:assertDatabaseIdentityRestorationReady` -
  `(client, event)` returns `{ table, key }`.
- `restore-identity.ts:restoreDatabaseIdentity` - `(client, event)`.

## Invariants

- `index.ts:serializeQueries` (not exported) - after a connection error, the next query
  rejects with `Database connection lost`.
- `index.ts:defaultDatabaseClientFactory` - the session sets
  `extra_float_digits=3`; `date`, `timestamptz` are read as strings and
  `numeric` as a number.
- `entities.ts:createDatabaseRecords` - the insert columns are the defined
  columns of the first record. It throws
  `Cannot insert into <table>: record <i> (<key column> <key>) does not have the columns of record 0 (<differences>).`
  before any query when another record has a different set of defined
  columns. The insert is a plain `insert ... returning <key>`, so the
  database rejects an existing key.
- `restore-identity.ts:assertDatabaseIdentityRestorationReady` - throws
  `Unsupported restoration entity kind.` when the kind has no table or
  primary key in `TABLE_BY_KIND` and `PRIMARY_KEY_BY_KIND`. It throws unless
  every incoming foreign key is `ON UPDATE CASCADE`, the original ID is free,
  and exactly the expected current row exists.
- `restore-identity.ts:restoreDatabaseIdentity` - calls
  `assertDatabaseIdentityRestorationReady` before the update. It throws
  unless exactly one row is updated. The caller owns the transaction.
- `location-path-spatial.ts:locationPathCentroidGeoJson` - returns `null`
  unless the value is a `Point` with two finite numbers.
- `location-path-spatial.ts:locationPathBboxGeoJson` - returns `null` unless
  the value is a `Polygon` whose first ring has five pairs of finite numbers.
- `location-path-spatial.ts:geoJsonValue` - runs `JSON.parse` on a string,
  so it throws on invalid JSON. Any other value is returned unchanged.

## Side Effects

- `index.ts:defaultDatabaseClientFactory` - opens a PostgreSQL connection
  when `connect` is called. The module sets `pg` type parsers when it loads.
- `entities.ts:createDatabaseRecords` - `insert` into the given table.
- `entities.ts:updateDatabaseRecordFields` - `update` of the given table.
- `entities.ts:createDatabaseRecords`,
  `entities.ts:updateDatabaseRecordFields` - both write
  `location_path.centroid`, `location_path.bbox` and
  `location_path_geometry.boundary` through `ST_GeomFromGeoJSON`.
- `entities.ts:readDatabaseRecordByColumn`,
  `entities.ts:readDatabaseRecordByColumns`,
  `entities.ts:readDatabaseRecordsByColumn`,
  `entities.ts:readDatabaseRecordsByColumns` - `select` from the given
  table.
- `schema.ts:loadDatabaseSchemaMetadata`,
  `data-mutation-ledger.ts:readCurrentSchemaVersion` - `select` from
  `supabase_migrations.schema_migrations`.
- `data-mutation-ledger.ts:recordDataMutationApplied` - `insert` into
  `public.data_mutation_applied`.
- `data-mutation-ledger.ts:readAppliedDataMutationVersions`,
  `data-mutation-ledger.ts:readAppliedDataMutationChecksums` - `select` from
  `public.data_mutation_applied`.
- `location-paths.ts:readLocationPathById`,
  `location-paths.ts:readLocationPathByPath` - `select` from
  `public.location_path`.
- `location-paths.ts:readLocationPathAliasByPath` - `select` from
  `public.location_path_alias`.
- `location-paths.ts:readLocationPathsContainingPoint` - `select` joining
  `public.location_path` and `public.location_path_geometry`.
- `agency-graph.ts:agencyTableIsEmpty` - `select` from `public.agency`.
- `agency-graph.ts:readExistingAgencyGraph` - `select` from the tables of the
  agency graph kinds.
- `restore-identity.ts:assertDatabaseIdentityRestorationReady` - `select`
  from `pg_constraint`, then `select ... for update` on the rows of the
  expected current ID and the original ID.
- `restore-identity.ts:restoreDatabaseIdentity` - the reads of
  `assertDatabaseIdentityRestorationReady`, then `update` of the primary key
  of one row.

## Verification

- Run: `npx vitest run test/cli/database`
