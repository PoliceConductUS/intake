import {
  createDatabaseRecord,
  readDatabaseRecordByColumn,
  updateDatabaseRecordFields,
} from "../../database/entities.js";
import type { DatabaseClient } from "../../database/index.js";
import {
  locationPathBboxGeoJson,
  locationPathCentroidGeoJson,
} from "../../database/location-path-spatial.js";
import type { SupportedTableName } from "../../database/schema.js";
import { DatabaseMutations } from "../../import/artifacts/io/DatabaseMutations.js";
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

const databaseMutationMetadataByRecordKind: Record<
  string,
  DatabaseMutationMetadata
> = {
  LocationPath: {
    tableName: "public.location_path",
    keyColumnName: "location_path_id",
  },
  LocationPathGeometry: {
    tableName: "public.location_path_geometry",
    keyColumnName: "location_path_id",
  },
  LocationPathAlias: {
    tableName: "public.location_path_alias",
    keyColumnName: "alias_path",
  },
  Agency: {
    tableName: "public.agency",
    keyColumnName: "id",
  },
  Personnel: {
    tableName: "public.officers",
    keyColumnName: "id",
  },
  AgencyPersonnel: {
    tableName: "public.agency_officers",
    keyColumnName: "id",
  },
  LicensingAuthority: {
    tableName: "public.licensing_authority",
    keyColumnName: "id",
  },
  License: {
    tableName: "public.license",
    keyColumnName: "id",
  },
  LicenseAction: {
    tableName: "public.license_action",
    keyColumnName: "id",
  },
} satisfies Record<string, DatabaseMutationMetadata>;

function databaseMutationMetadata(
  recordKind: string,
): DatabaseMutationMetadata {
  const metadata = databaseMutationMetadataByRecordKind[recordKind];
  if (metadata === undefined) {
    throw new Error(`Unsupported DatabaseMutation record kind: ${recordKind}`);
  }
  return metadata;
}

function mutationKeyValue(
  mutationName: string,
  spec: Record<string, unknown>,
  keyColumnName: string,
): unknown {
  return spec[keyColumnName] ?? mutationName;
}

function assertExpectedValue(
  mutationName: string,
  fieldName: string,
  expected: unknown,
  actual: unknown,
): void {
  if (!Object.is(expected, actual)) {
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
    return {
      ...databaseSpec,
      ...(geometry === undefined ? {} : { boundary: JSON.stringify(geometry) }),
    };
  }

  if (recordKind !== "AgencyPersonnel") {
    return spec;
  }

  const { personnel_id, ...databaseSpec } = spec;
  return personnel_id === undefined
    ? databaseSpec
    : { ...databaseSpec, officer_id: personnel_id };
}

function databaseFieldName(recordKind: string, fieldName: string): string {
  if (recordKind === "AgencyPersonnel" && fieldName === "personnel_id") {
    return "officer_id";
  }
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
  if (recordKind === "LocationPathGeometry" && fieldName === "boundary") {
    return JSON.stringify(value);
  }
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

async function executeCreate(
  client: DatabaseClient,
  mutationName: string,
  recordKind: string,
  spec: Record<string, unknown>,
): Promise<void> {
  const metadata = databaseMutationMetadata(recordKind);
  const databaseSpec = databaseSpecForMutation(recordKind, spec);
  const keyValue = mutationKeyValue(
    mutationName,
    databaseSpec,
    metadata.keyColumnName,
  );
  const current = await readDatabaseRecordByColumn(
    client,
    metadata.tableName,
    metadata.keyColumnName,
    keyValue,
  );
  if (current !== undefined) {
    throw new Error(
      `DatabaseMutation ${mutationName} cannot create existing ${recordKind}.`,
    );
  }
  await createDatabaseRecord(client, metadata.tableName, databaseSpec);
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

  for (const mutationItem of databaseMutations.spec.mutations) {
    const mutation: DatabaseMutationEnvelope =
      "ref" in mutationItem
        ? await readDatabaseMutation(mutationItem.ref, {
            relativeTo: databaseMutationsPath,
            expectedNamespace: databaseMutations.metadata.namespace,
          })
        : {
            apiVersion: databaseMutations.apiVersion,
            kind: mutationItem.kind,
            metadata: {
              name: mutationItem.name,
              namespace: databaseMutations.metadata.namespace,
            },
            spec: mutationItem.spec,
          };
    const { operation, recordKind } = parseDatabaseMutationKind(mutation.kind);
    if (operation === "create") {
      await executeCreate(
        client,
        mutation.metadata.name,
        recordKind,
        mutation.spec,
      );
    } else if (operation === "update") {
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
    incrementDatabaseMutationCounts(counts, mutationItem);
  }

  return counts;
}
