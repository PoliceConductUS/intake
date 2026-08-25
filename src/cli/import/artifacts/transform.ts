import type { ArtifactsEnvelope } from "../../../shared/io/Artifacts.js";
import type {
  LocationPathBbox,
  LocationPathCentroid,
} from "../../database/location-path-spatial.js";
import {
  importKindByEntityName,
  importTypeRegistry,
  sourceNameForImportRecord,
} from "../../../shared/io/import-types.js";
import type { z } from "zod";
import { LocationPathSpec } from "../../../shared/io/generated/entity-specs.js";
import type { SourceNameToCanonicalIdLedger } from "../../state/source-name-to-canonical-id/index.js";

export type LocationPathRow = {
  location_path_id: string;
  path: string;
  level: "state" | "administrative_area" | "place";
  state_or_territory_slug: string;
  administrative_area_slug: string | null;
  place_slug: string | null;
  state_or_territory_name: string;
  administrative_area_name: string | null;
  place_name: string | null;
  parent_location_path_id: string | null;
  centroid?: LocationPathCentroid | null;
  bbox?: LocationPathBbox | null;
};

export type LocationPathAliasRow = {
  alias_path: string;
  location_path_id: string;
};

export type LocationPathGeometryRow = {
  location_path_id: string;
  sourceLocationPathKey: string;
  geometry: unknown;
};

export type PreparationMutation = {
  action: "set";
  entityType: "locationPath";
  rowId: string;
  sourceName?: string;
  path: string;
  value: unknown;
  reason: string;
};

export type ImportRows = {
  locationPaths: LocationPathRow[];
  locationPathGeometries?: LocationPathGeometryRow[];
  locationPathAliases: LocationPathAliasRow[];
  preparationMutations: PreparationMutation[];
};

function entityMap(
  artifacts: ArtifactsEnvelope,
  entityName: "locationPaths" | "locationPathAliases",
): Record<string, unknown> {
  const kind = importKindByEntityName[entityName];
  return Object.assign(
    {},
    ...artifacts.spec.artifacts
      .filter((artifact) => artifact.kind === kind)
      .map((artifact) => artifact.spec.records),
  ) as Record<string, unknown>;
}

function locationPathSourceKeysByPath(
  artifacts: ArtifactsEnvelope,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entityMap(artifacts, "locationPaths")).map(
      ([recordKey, record]) => {
        const source = valueAsRecord(recordKey, record);
        return [
          requiredString(
            recordKey,
            "location_path_id",
            source.location_path_id,
          ),
          sourceNameForImportRecord(recordKey, record),
        ];
      },
    ),
  );
}

function firstIssuePath(error: z.ZodError): string {
  const issue = error.issues[0];
  if (
    issue?.code === "unrecognized_keys" &&
    "keys" in issue &&
    issue.keys.length > 0
  ) {
    return [...issue.path, issue.keys[0]].join(".");
  }
  return issue?.path.join(".") || "record";
}

function validateImportRecords(artifacts: ArtifactsEnvelope): void {
  for (const artifact of artifacts.spec.artifacts) {
    const definition = importTypeRegistry[artifact.kind];
    for (const [recordKey, record] of Object.entries(artifact.spec.records)) {
      const result = definition.recordSchema.safeParse(record);
      if (!result.success) {
        throw new Error(
          `Artifacts ${artifact.kind} record ${recordKey} is malformed at ${firstIssuePath(result.error)}.`,
        );
      }
    }
  }
}

function valueAsStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(
  sourceName: string,
  fieldName: string,
  value: unknown,
): string {
  if (typeof value !== "string") {
    throw new Error(
      `Artifacts entity ${sourceName} is missing required string field ${fieldName}.`,
    );
  }

  return value;
}

function valueAsRecord(
  sourceName: string,
  value: unknown,
): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`Artifacts entity ${sourceName} must be an object.`);
}

async function locationPathRow(
  recordKey: string,
  sourceValue: unknown,
  namespace: string,
  ledger: SourceNameToCanonicalIdLedger,
): Promise<LocationPathRow> {
  const source = valueAsRecord(recordKey, sourceValue);
  const sourceName = sourceNameForImportRecord(recordKey, sourceValue);
  requiredString(sourceName, "location_path_id", source.location_path_id);
  // find-or-create is order-independent: the parent may be materialized here
  // before its own row is processed, and its own row finds the same id.
  const canonicalId = await ledger.findOrCreate(
    namespace,
    "LocationPath",
    sourceName,
  );
  const parentLocationPathSourceKey = valueAsStringOrNull(
    source.parent_location_path_id,
  );
  const parentCanonicalId =
    parentLocationPathSourceKey === null
      ? null
      : await ledger.findOrCreate(
          namespace,
          "LocationPath",
          parentLocationPathSourceKey,
        );
  const databaseFields = Object.fromEntries(
    Object.entries(source).filter(([fieldName]) => !fieldName.startsWith("_")),
  );
  const result = LocationPathSpec.safeParse({
    ...databaseFields,
    location_path_id: canonicalId,
    parent_location_path_id: parentCanonicalId,
  });
  if (!result.success) {
    const issuePath = result.error.issues[0]?.path.join(".") || "record";
    throw new Error(
      `Artifacts location path ${sourceName} is malformed at ${issuePath}.`,
    );
  }

  return result.data;
}

async function locationPathAliasRow(
  sourceName: string,
  sourceValue: unknown,
  locationPathSourceKeyByPath: Record<string, string>,
  namespace: string,
  ledger: SourceNameToCanonicalIdLedger,
): Promise<LocationPathAliasRow> {
  const source = valueAsRecord(sourceName, sourceValue);
  const sourceLocationPathId = requiredString(
    sourceName,
    "location_path_id",
    source.location_path_id,
  );
  const locationPathSourceKey =
    locationPathSourceKeyByPath[sourceLocationPathId] ?? sourceLocationPathId;
  // Reuse a recorded location-path id; fall back to the raw source path when
  // none exists (legacy alias behavior).
  const canonicalLocationPathId =
    (await ledger.read(namespace, "LocationPath", locationPathSourceKey)) ??
    sourceLocationPathId;
  return {
    alias_path: requiredString(sourceName, "alias_path", source.alias_path),
    location_path_id: canonicalLocationPathId,
  };
}

export async function transformArtifacts(
  artifacts: ArtifactsEnvelope,
  ledger: SourceNameToCanonicalIdLedger,
): Promise<ImportRows> {
  validateImportRecords(artifacts);
  const namespace = artifacts.metadata.namespace;

  // Location paths are materialized first (find-or-create writes their ledger
  // files) so aliases — awaited afterwards — find those ids.
  const locationPaths = await Promise.all(
    Object.entries(entityMap(artifacts, "locationPaths")).map(
      ([recordKey, sourceValue]) =>
        locationPathRow(recordKey, sourceValue, namespace, ledger),
    ),
  );

  const locationPathSourceKeyByPath = locationPathSourceKeysByPath(artifacts);
  const locationPathAliases = await Promise.all(
    Object.entries(entityMap(artifacts, "locationPathAliases")).map(
      ([sourceName, sourceValue]) =>
        locationPathAliasRow(
          sourceName,
          sourceValue,
          locationPathSourceKeyByPath,
          namespace,
          ledger,
        ),
    ),
  );

  return {
    locationPaths,
    locationPathAliases,
    preparationMutations: [],
  };
}
