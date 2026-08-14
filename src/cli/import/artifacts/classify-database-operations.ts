import type { DatabaseClient } from "../../database/index.js";
import {
  readDatabaseRecordByColumn,
  readDatabaseRecordById,
} from "../../database/entities.js";
import { readLocationPathAliasByPath } from "../../database/location-paths.js";
import type { SupportedTableName } from "../../database/schema.js";
import type { DatabaseRowOperations } from "./operations.js";
import type { ImportRows, LocationPathRow } from "./transform.js";

async function rowExists(
  client: DatabaseClient,
  tableName: SupportedTableName,
  rowId: string,
): Promise<boolean> {
  return (await readDatabaseRecordById(client, tableName, rowId)) !== undefined;
}

export async function classifyDatabaseOperations(
  client: DatabaseClient,
  rows: ImportRows,
  databaseLocationPaths: readonly LocationPathRow[] = [],
  preparedOperations?: DatabaseRowOperations,
): Promise<DatabaseRowOperations> {
  const operations: DatabaseRowOperations = preparedOperations ?? {
    locationPaths: {},
    locationPathGeometries: {},
    locationPathAliases: {},
    agencies: {},
    officers: {},
    agencyOfficers: {},
    licensingAuthorities: {},
    licenses: {},
    licenseActions: {},
  };
  const databaseLocationPathIds = new Set(
    databaseLocationPaths.map((locationPath) => locationPath.location_path_id),
  );
  const databaseLocationPathIdByPath = new Map(
    databaseLocationPaths.map((locationPath) => [
      locationPath.path,
      locationPath.location_path_id,
    ]),
  );

  for (const locationPath of rows.locationPaths) {
    if (operations.locationPaths[locationPath.location_path_id] !== undefined) {
      continue;
    }
    const existingIdForPath = databaseLocationPathIdByPath.get(
      locationPath.path,
    );
    if (
      existingIdForPath !== undefined &&
      existingIdForPath !== locationPath.location_path_id
    ) {
      throw new Error(
        `Location path ${locationPath.path} already exists with location_path_id ${existingIdForPath}, but import mapped it to ${locationPath.location_path_id}.`,
      );
    }
    const exists =
      databaseLocationPathIds.has(locationPath.location_path_id) ||
      existingIdForPath !== undefined;
    operations.locationPaths[locationPath.location_path_id] = exists
      ? "read"
      : "create";
  }

  for (const locationPathGeometry of rows.locationPathGeometries ?? []) {
    if (
      operations.locationPathGeometries[
        locationPathGeometry.location_path_id
      ] !== undefined
    ) {
      continue;
    }
    const exists =
      (await readDatabaseRecordByColumn(
        client,
        "public.location_path_geometry",
        "location_path_id",
        locationPathGeometry.location_path_id,
      )) !== undefined;
    operations.locationPathGeometries[locationPathGeometry.location_path_id] =
      exists ? "read" : "create";
  }

  for (const locationPathAlias of rows.locationPathAliases) {
    if (
      operations.locationPathAliases[locationPathAlias.alias_path] !== undefined
    ) {
      continue;
    }
    const exists =
      (await readLocationPathAliasByPath(
        client,
        locationPathAlias.alias_path,
      )) !== undefined;
    operations.locationPathAliases[locationPathAlias.alias_path] = exists
      ? "read"
      : "create";
  }

  for (const agency of rows.agencies) {
    if (operations.agencies[agency.id] !== undefined) {
      continue;
    }
    const exists = await rowExists(client, "public.agency", agency.id);
    operations.agencies[agency.id] = exists
      ? (rows.ownedColumns.agencies[agency.id] ?? []).length > 0
        ? "update"
        : "read"
      : "create";
  }

  // Personnel is facade-based (ADR 0016): the PersonnelFacade owns create-vs-update
  // via its resolvers and emits its own mutations, so officers have no transform
  // rows to classify here.

  for (const agencyOfficer of rows.agencyOfficers) {
    const exists = await rowExists(
      client,
      "public.agency_officers",
      agencyOfficer.id,
    );
    operations.agencyOfficers[agencyOfficer.id] = exists
      ? (rows.ownedColumns.agencyOfficers[agencyOfficer.id] ?? []).length > 0
        ? "update"
        : "read"
      : "create";
  }

  // LicensingAuthority, License, and LicenseAction are facade-based (ADR 0016):
  // each facade owns create-vs-update via composable resolvers and emits its own
  // mutations (counted like every other entity via countDatabaseMutations). They
  // have no transform rows to classify here, so their `operations` maps stay
  // empty.

  return operations;
}
