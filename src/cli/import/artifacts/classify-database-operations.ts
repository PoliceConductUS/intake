import type { DatabaseClient } from "../../database/index.js";
import {
  readDatabaseRecordByColumn,
  readDatabaseRecordById,
} from "../../database/entities.js";
import { readLocationPathAliasByPath } from "../../database/location-paths.js";
import type { SupportedTableName } from "../../database/schema.js";
import { readActiveSuppressedIds } from "../../database/suppression.js";
import type {
  DatabaseRowOperations,
  SuppressedSkip,
  SuppressedSkipEntity,
} from "./operations.js";
import type { ImportRows, LocationPathRow } from "./transform.js";

async function rowExists(
  client: DatabaseClient,
  tableName: SupportedTableName,
  rowId: string,
): Promise<boolean> {
  return (await readDatabaseRecordById(client, tableName, rowId)) !== undefined;
}

/**
 * Classify an existing row, recording the skip when suppression is what
 * demoted it.
 *
 * The order of the checks is the point. A record with no owned columns is not
 * a skip -- this import had nothing to write for it, suppressed or not, and
 * reporting it as a skipped takedown would inflate the number that matters.
 * Only a write we were actually going to make and then withheld counts.
 */
function classifyExistingRow(
  skips: Map<string, SuppressedSkip>,
  suppressedIds: ReadonlySet<string>,
  entity: SuppressedSkipEntity,
  recordId: string,
  ownedColumns: readonly string[],
  subjectIds: readonly string[],
): "read" | "update" {
  if (ownedColumns.length === 0) {
    return "read";
  }
  const suppressedSubjectIds = [...new Set(subjectIds)].filter((subjectId) =>
    suppressedIds.has(subjectId),
  );
  if (suppressedSubjectIds.length === 0) {
    return "update";
  }
  // Keyed rather than appended: rows.officers is classified without the
  // already-seen guard the agency loop has, so the same record can be visited
  // twice. A change diff that double-counts an honoured takedown is its own
  // small lie.
  skips.set(`${entity}:${recordId}`, {
    entity,
    recordId,
    suppressedSubjectIds,
    withheldColumns: [...ownedColumns],
  });
  return "read";
}

export async function classifyDatabaseOperations(
  client: DatabaseClient,
  rows: ImportRows,
  databaseLocationPaths: readonly LocationPathRow[] = [],
  preparedOperations?: DatabaseRowOperations,
): Promise<DatabaseRowOperations> {
  // Read suppression state here rather than accepting it as a parameter: a
  // caller that forgets to pass it would plan writes against suppressed
  // records, and the resulting import would abort on the database guard
  // instead of skipping the record. There is no way to opt out of this read.
  const suppressedIds = await readActiveSuppressedIds(client);
  const operations: DatabaseRowOperations = preparedOperations ?? {
    locationPaths: {},
    locationPathGeometries: {},
    locationPathAliases: {},
    agencies: {},
    officers: {},
    agencyOfficers: {},
    suppressedSkips: [],
  };
  // Owned by classification, and rebuilt on every call. `preparedOperations`
  // reaches us through a cast from ImportOperations, which has no such field,
  // so it can arrive undefined; and a re-run must not accumulate skips from
  // the previous pass.
  const suppressedSkips = new Map<string, SuppressedSkip>();
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
      ? classifyExistingRow(
          suppressedSkips,
          suppressedIds,
          "agency",
          agency.id,
          rows.ownedColumns.agencies[agency.id] ?? [],
          [agency.id],
        )
      : "create";
  }

  for (const officer of rows.officers) {
    const exists = await rowExists(client, "public.officers", officer.id);
    operations.officers[officer.id] = exists
      ? classifyExistingRow(
          suppressedSkips,
          suppressedIds,
          "personnel",
          officer.id,
          rows.ownedColumns.officers[officer.id] ?? [],
          [officer.id],
        )
      : "create";
  }

  for (const agencyOfficer of rows.agencyOfficers) {
    const exists = await rowExists(
      client,
      "public.agency_officers",
      agencyOfficer.id,
    );
    operations.agencyOfficers[agencyOfficer.id] = exists
      ? classifyExistingRow(
          suppressedSkips,
          suppressedIds,
          "agencyPersonnel",
          agencyOfficer.id,
          rows.ownedColumns.agencyOfficers[agencyOfficer.id] ?? [],
          [
            agencyOfficer.id,
            agencyOfficer.personnel_id,
            agencyOfficer.agency_id,
          ],
        )
      : "create";
  }

  operations.suppressedSkips = [...suppressedSkips.values()];

  return operations;
}
