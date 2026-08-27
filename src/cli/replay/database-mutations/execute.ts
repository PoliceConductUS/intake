import {
  createDatabaseRecords,
  readDatabaseRecordByColumn,
  updateDatabaseRecordFields,
} from "../../database/entities.js";
import type { DatabaseClient } from "../../database/index.js";
import {
  locationPathBboxGeoJson,
  locationPathCentroidGeoJson,
} from "../../database/location-path-spatial.js";
import type { SupportedTableName } from "../../database/schema.js";
import {
  PRIMARY_KEY_BY_KIND,
  TABLE_BY_KIND,
} from "../../../shared/io/generated/entity-specs.js";
import { valuesEqual } from "../../../shared/values-equal.js";
import path from "node:path";
import {
  DatabaseMutations,
  type DatabaseMutationItem,
  type DatabaseMutationsEnvelope,
} from "../../import/artifacts/io/DatabaseMutations.js";
import {
  parseDatabaseMutationKind,
  readDatabaseMutation,
  type DatabaseMutationEnvelope,
} from "../../import/artifacts/io/DatabaseMutation.js";
import {
  emptyDatabaseMutationCounts,
  incrementDatabaseMutationCounts,
  type DatabaseMutationCounts,
} from "../../import/artifacts/io/DatabaseMutationCounts.js";

export type { DatabaseMutationCounts };

type DatabaseMutationMetadata = {
  tableName: SupportedTableName;
  keyColumnName: string;
};

// A kind's table and primary-key column both come from the generated model
// (TABLE_BY_KIND / PRIMARY_KEY_BY_KIND), so this can never drift from the schema.
function databaseMutationMetadata(
  recordKind: string,
): DatabaseMutationMetadata {
  const tableName = TABLE_BY_KIND[recordKind];
  const keyColumnName = PRIMARY_KEY_BY_KIND[recordKind];
  if (tableName === undefined || keyColumnName === undefined) {
    throw new Error(`Unsupported DatabaseMutation record kind: ${recordKind}`);
  }
  return { tableName: tableName as SupportedTableName, keyColumnName };
}

function assertExpectedValue(
  mutationName: string,
  fieldName: string,
  expected: unknown,
  actual: unknown,
): void {
  if (!valuesEqual(expected, actual)) {
    throw new Error(
      `DatabaseMutation ${mutationName} expected ${fieldName} to be ${String(expected)} but found ${String(actual)}.`,
    );
  }
}

function databaseSpecForMutation(
  recordKind: string,
  spec: Record<string, unknown>,
): Record<string, unknown> {
  if (recordKind === "LocationPath") {
    const { centroid, bbox, ...databaseSpec } = spec;
    return {
      ...databaseSpec,
      ...(centroid === undefined
        ? {}
        : { centroid: locationPathCentroidGeoJson(centroid) }),
      ...(bbox === undefined ? {} : { bbox: locationPathBboxGeoJson(bbox) }),
    };
  }

  if (recordKind === "LocationPathGeometry") {
    const {
      geometry,
      sourceLocationPathKey: _sourceLocationPathKey,
      selectedYear: _selectedYear,
      ...databaseSpec
    } = spec;
    // geometry is a pre-serialized GeoJSON string (opaque blob), fed straight to
    // ST_GeomFromGeoJSON.
    return {
      ...databaseSpec,
      ...(geometry === undefined ? {} : { boundary: geometry }),
    };
  }

  return spec;
}

function databaseFieldName(recordKind: string, fieldName: string): string {
  if (recordKind === "LocationPathGeometry" && fieldName === "geometry") {
    return "boundary";
  }
  return fieldName;
}

function databaseFieldValue(
  recordKind: string,
  fieldName: string,
  value: unknown,
): unknown {
  if (recordKind !== "LocationPath") {
    return value;
  }
  if (fieldName === "centroid") {
    return locationPathCentroidGeoJson(value);
  }
  if (fieldName === "bbox") {
    return locationPathBboxGeoJson(value);
  }
  return value;
}

type PendingCreate = {
  mutationName: string;
  databaseSpec: Record<string, unknown>;
};

// Postgres caps a statement at 65535 bind parameters; keep a margin.
const MAX_INSERT_PARAMETERS = 60000;

function definedColumns(spec: Record<string, unknown>): string[] {
  return Object.entries(spec)
    .filter(([, value]) => value !== undefined)
    .map(([columnName]) => columnName);
}

async function executeCreateBatch(
  client: DatabaseClient,
  recordKind: string,
  creates: readonly PendingCreate[],
): Promise<void> {
  if (creates.length === 0) {
    return;
  }
  const metadata = databaseMutationMetadata(recordKind);
  const insertedKeys = await createDatabaseRecords(
    client,
    metadata.tableName,
    creates.map((create) => create.databaseSpec),
    metadata.keyColumnName,
  );
  for (const create of creates) {
    const keyValue = String(create.databaseSpec[metadata.keyColumnName]);
    if (!insertedKeys.has(keyValue)) {
      throw new Error(
        `DatabaseMutation ${create.mutationName} cannot create existing ${recordKind}.`,
      );
    }
  }
}

async function executeUpdate(
  client: DatabaseClient,
  mutationName: string,
  recordKind: string,
  spec: Record<string, unknown>,
): Promise<void> {
  const metadata = databaseMutationMetadata(recordKind);
  const operations = spec.operations;
  if (!Array.isArray(operations)) {
    throw new Error(
      `DatabaseMutation ${mutationName} update operations are malformed.`,
    );
  }
  const current = await readDatabaseRecordByColumn(
    client,
    metadata.tableName,
    metadata.keyColumnName,
    mutationName,
  );
  if (current === undefined) {
    throw new Error(
      `DatabaseMutation ${mutationName} cannot update missing ${recordKind}.`,
    );
  }

  const values: Record<string, unknown> = {};
  for (const operation of operations) {
    if (
      typeof operation !== "object" ||
      operation === null ||
      Array.isArray(operation)
    ) {
      throw new Error(
        `DatabaseMutation ${mutationName} operation is malformed.`,
      );
    }
    const typedOperation = operation as Record<string, unknown>;
    const fieldName = databaseFieldName(
      recordKind,
      String(typedOperation.path),
    );
    if (typedOperation.action === "check") {
      assertExpectedValue(
        mutationName,
        fieldName,
        databaseFieldValue(recordKind, fieldName, typedOperation.value),
        current[fieldName],
      );
      continue;
    }
    if (typedOperation.action !== "set") {
      throw new Error(
        `DatabaseMutation ${mutationName} operation action is unsupported.`,
      );
    }
    assertExpectedValue(
      mutationName,
      fieldName,
      databaseFieldValue(recordKind, fieldName, typedOperation.from),
      current[fieldName],
    );
    values[fieldName] = databaseFieldValue(
      recordKind,
      fieldName,
      typedOperation.to,
    );
  }

  await updateDatabaseRecordFields(
    client,
    metadata.tableName,
    metadata.keyColumnName,
    mutationName,
    values,
  );
}

// Yield each individual mutation (with its item, for counting), expanding
// "DatabaseMutations" chunk refs recursively so a chunked envelope replays the
// same as an inline one — one mutation resident at a time.
async function* iterateMutations(
  databaseMutations: DatabaseMutationsEnvelope,
  databaseMutationsPath: string,
): AsyncGenerator<{
  mutation: DatabaseMutationEnvelope;
  item: DatabaseMutationItem;
}> {
  const namespace = databaseMutations.metadata.namespace;
  for (const item of databaseMutations.spec.mutations) {
    if ("ref" in item && item.ref.kind === "DatabaseMutations") {
      const chunkPath = path.resolve(
        path.dirname(databaseMutationsPath),
        item.ref.path,
      );
      const chunk = await DatabaseMutations.read(chunkPath, { raw: true });
      yield* iterateMutations(chunk, chunkPath);
      continue;
    }
    const mutation: DatabaseMutationEnvelope =
      "ref" in item
        ? await readDatabaseMutation(item.ref, {
            relativeTo: databaseMutationsPath,
            expectedNamespace: namespace,
          })
        : {
            apiVersion: databaseMutations.apiVersion,
            kind: item.kind,
            metadata: { name: item.name, namespace },
            spec: item.spec,
          };
    yield { mutation, item };
  }
}

export async function executeDatabaseMutations(
  client: DatabaseClient,
  databaseMutationsPath: string,
): Promise<DatabaseMutationCounts> {
  const databaseMutations = await DatabaseMutations.read(
    databaseMutationsPath,
    {
      raw: true,
    },
  );
  const counts = emptyDatabaseMutationCounts();

  // Creates are emitted contiguously and ahead of every update (ADR 0020), so
  // buffer a run of same-kind, same-column creates and flush it as one multi-row
  // insert — on a kind/column change, the parameter cap, or the first non-create.
  let pending:
    | { recordKind: string; signature: string; creates: PendingCreate[] }
    | undefined;
  const flushPending = async (): Promise<void> => {
    if (pending !== undefined) {
      const batch = pending;
      pending = undefined;
      await executeCreateBatch(client, batch.recordKind, batch.creates);
    }
  };

  for await (const { mutation, item } of iterateMutations(
    databaseMutations,
    databaseMutationsPath,
  )) {
    const { operation, recordKind } = parseDatabaseMutationKind(mutation.kind);
    if (operation === "create") {
      const databaseSpec = databaseSpecForMutation(recordKind, mutation.spec);
      const columns = definedColumns(databaseSpec);
      const signature = `${recordKind}(${columns.join(",")})`;
      const rowCap = Math.max(
        1,
        Math.floor(MAX_INSERT_PARAMETERS / columns.length),
      );
      if (
        pending !== undefined &&
        (pending.signature !== signature || pending.creates.length >= rowCap)
      ) {
        await flushPending();
      }
      if (pending === undefined) {
        pending = { recordKind, signature, creates: [] };
      }
      pending.creates.push({
        mutationName: mutation.metadata.name,
        databaseSpec,
      });
    } else {
      await flushPending();
      if (operation === "update") {
        await executeUpdate(
          client,
          mutation.metadata.name,
          recordKind,
          mutation.spec,
        );
      } else if (operation !== "read") {
        throw new Error(
          `DatabaseMutation operation ${operation} is not supported.`,
        );
      }
    }
    incrementDatabaseMutationCounts(counts, item);
  }
  await flushPending();

  return counts;
}
