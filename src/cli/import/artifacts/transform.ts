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

export type AgencyRow = {
  sourceName?: string;
  id: string;
  name: string;
  city: string | null;
  state: string;
  address: string | null;
  zip_code: string | null;
  contact_name: string | null;
  contact_email: string | null;
  slug: string | undefined;
  location_path_id: string | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
  // Envelope-only geocoding hint (administrative-area name/slug); not a column.
  location?: Record<string, unknown>;
};

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

export type ResolvedAgencyState = {
  slug?: string;
  locationPathId?: string;
  latitude?: number;
  longitude?: number;
};

export type ResolvedPersonState = {
  slug?: string;
};

export type ResolvedProperties = {
  agencies: Record<string, ResolvedAgencyState>;
  personnel: Record<string, ResolvedPersonState>;
};

export type PreparationMutation = {
  action: "set";
  entityType: "agency" | "officer" | "agencyOfficer" | "locationPath";
  rowId: string;
  sourceName?: string;
  path: string;
  value: unknown;
  reason: string;
};

export type AgencyColumn = Exclude<keyof AgencyRow, "id">;

// Personnel is facade-based (ADR 0016): the PersonnelFacade owns its columns,
// canonical-id find-or-create, unique-slug generation, and mutation emission.
// It produces no transform row here.

export type AgencyOfficerRow = {
  id: string;
  agency_id: string;
  officer_id: string;
  badge_number: string | null;
  start_date: string;
  end_date: string | null;
  title: string;
  license_id: string | null;
};

export type AgencyOfficerColumn = Exclude<keyof AgencyOfficerRow, "id">;

// License and LicenseAction are facade-based (ADR 0016): the LicenseFacade /
// LicenseActionFacade own their columns, foreign-key finds, and mutations. They
// produce no transform rows here.

export type ImportRows = {
  locationPaths: LocationPathRow[];
  locationPathGeometries?: LocationPathGeometryRow[];
  locationPathAliases: LocationPathAliasRow[];
  agencies: AgencyRow[];
  agencyOfficers: AgencyOfficerRow[];
  preparationMutations: PreparationMutation[];
  ownedColumns: {
    agencies: Record<string, AgencyColumn[]>;
    agencyOfficers: Record<string, AgencyOfficerColumn[]>;
  };
};

const agencySourceColumns: AgencyColumn[] = [
  "name",
  "city",
  "state",
  "address",
  "zip_code",
  "contact_name",
  "contact_email",
  "latitude",
  "longitude",
];

const agencyOfficerSourceColumns: AgencyOfficerColumn[] = [
  "agency_id",
  "officer_id",
  "badge_number",
  "start_date",
  "end_date",
  "title",
  "license_id",
];

function entityMap(
  artifacts: ArtifactsEnvelope,
  entityName:
    | "locationPaths"
    | "locationPathGeometries"
    | "locationPathAliases"
    | "agencies"
    | "personnel"
    | "agencyPersonnel"
    | "licensingAuthorities"
    | "licenses"
    | "licenseActions",
): Record<string, unknown> {
  const kind = importKindByEntityName[entityName];
  return Object.assign(
    {},
    ...artifacts.spec.artifacts
      .filter((artifact) => artifact.kind === kind)
      .map((artifact) => artifact.spec.records),
  ) as Record<string, unknown>;
}

// Merge the per-record source-file paths across all artifacts of one kind (the
// absolute path each record was read from, attached by Artifacts.read), keyed by
// record key — so a transform error can cite the file that holds the bad data.
function recordSourcesFor(
  artifacts: ArtifactsEnvelope,
  entityName: Parameters<typeof entityMap>[1],
): Record<string, string> {
  const kind = importKindByEntityName[entityName];
  return Object.assign(
    {},
    ...artifacts.spec.artifacts
      .filter((artifact) => artifact.kind === kind)
      .map((artifact) => artifact.recordSources ?? {}),
  ) as Record<string, string>;
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

function valueAsNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function valueAsObjectOrUndefined(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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

function hasOwnField(
  source: Record<string, unknown>,
  fieldName: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(source, fieldName);
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
  resolvedProperties: ResolvedProperties = { agencies: {}, personnel: {} },
): Promise<ImportRows> {
  validateImportRecords(artifacts);
  const namespace = artifacts.metadata.namespace;
  const agencyPersonnelSources = recordSourcesFor(artifacts, "agencyPersonnel");
  const ownedColumns: ImportRows["ownedColumns"] = {
    agencies: {},
    agencyOfficers: {},
  };

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
  const agencies = await Promise.all(
    Object.entries(entityMap(artifacts, "agencies")).map(
      async ([recordKey, sourceValue]): Promise<AgencyRow> => {
        const sourceName = sourceNameForImportRecord(recordKey, sourceValue);
        const source = valueAsRecord(sourceName, sourceValue);
        const canonicalId = await ledger.findOrCreate(
          namespace,
          "Agency",
          sourceName,
        );
        const resolvedAgency = resolvedProperties.agencies[canonicalId] ?? {};
        const sourceOwnedColumns = agencySourceColumns.filter((columnName) =>
          hasOwnField(source, columnName),
        );
        const mappingOwnedColumns: AgencyColumn[] = [];
        if (resolvedAgency.slug !== undefined) {
          mappingOwnedColumns.push("slug");
        }
        if (resolvedAgency.locationPathId !== undefined) {
          mappingOwnedColumns.push("location_path_id");
        }
        if (resolvedAgency.latitude !== undefined) {
          mappingOwnedColumns.push("latitude");
        }
        if (resolvedAgency.longitude !== undefined) {
          mappingOwnedColumns.push("longitude");
        }
        ownedColumns.agencies[canonicalId] = [
          ...sourceOwnedColumns,
          ...mappingOwnedColumns,
        ];

        return {
          sourceName,
          id: canonicalId,
          name: requiredString(sourceName, "name", source.name),
          city: valueAsStringOrNull(source.city),
          state: requiredString(sourceName, "state", source.state),
          address: valueAsStringOrNull(source.address),
          zip_code: valueAsStringOrNull(source.zip_code),
          contact_name: valueAsStringOrNull(source.contact_name),
          contact_email: valueAsStringOrNull(source.contact_email),
          slug: resolvedAgency.slug,
          location_path_id: resolvedAgency.locationPathId,
          latitude:
            valueAsNumberOrUndefined(source.latitude) ??
            resolvedAgency.latitude,
          longitude:
            valueAsNumberOrUndefined(source.longitude) ??
            resolvedAgency.longitude,
          ...(valueAsObjectOrUndefined(source.location) === undefined
            ? {}
            : { location: valueAsObjectOrUndefined(source.location) }),
        };
      },
    ),
  );

  // Personnel rows are no longer built here; they are produced by the
  // PersonnelFacade (ADR 0016), which resolves its own canonical id, generates a
  // unique slug, and emits its own mutations.

  const agencyOfficers = await Promise.all(
    Object.entries(entityMap(artifacts, "agencyPersonnel")).map(
      async ([recordKey, sourceValue]): Promise<AgencyOfficerRow> => {
        const sourceName = sourceNameForImportRecord(recordKey, sourceValue);
        const source = valueAsRecord(sourceName, sourceValue);
        const canonicalId = await ledger.findOrCreate(
          namespace,
          "AgencyPersonnel",
          sourceName,
        );
        const sourceAgencyId = valueAsStringOrNull(source.agency_id);
        const sourceOfficerId = valueAsStringOrNull(source.officer_id);
        if (sourceAgencyId === null) {
          throw new Error(
            `Agency-personnel source record ${sourceName} is missing required field agency_id.`,
          );
        }
        if (sourceOfficerId === null) {
          throw new Error(
            `Agency-personnel source record ${sourceName} is missing required field officer_id.`,
          );
        }

        // agency_id is the one foreign key consumed downstream (the
        // excluded-agency cascade), so it is resolved to the agency's canonical
        // id. Agencies are materialized before agency officers, so a
        // same-namespace reference is found; a reference to an agency that does
        // not exist in this namespace is an error (no forward references).
        const agencyCanonicalId = await ledger.read(
          namespace,
          "Agency",
          sourceAgencyId,
        );
        if (agencyCanonicalId === undefined) {
          const sourceFile = agencyPersonnelSources[recordKey];
          throw new Error(
            [
              `Agency-personnel source record ${sourceName} references agency "${sourceAgencyId}", which does not exist in namespace ${namespace}.`,
              sourceFile && `Source: ${sourceFile}.`,
            ]
              .filter(Boolean)
              .join(" "),
          );
        }

        ownedColumns.agencyOfficers[canonicalId] =
          agencyOfficerSourceColumns.filter((columnName) =>
            hasOwnField(source, columnName),
          );

        // officer_id / license_id carry the raw source reference; they are not
        // consumed downstream. The AgencyPersonnel record's own foreign-key
        // resolution finds and enforces these when it emits the mutation.
        return {
          id: canonicalId,
          agency_id: agencyCanonicalId,
          officer_id: sourceOfficerId,
          badge_number: valueAsStringOrNull(source.badge_number),
          start_date: requiredString(
            sourceName,
            "start_date",
            source.start_date,
          ),
          end_date: valueAsStringOrNull(source.end_date),
          title: requiredString(sourceName, "title", source.title),
          license_id: valueAsStringOrNull(source.license_id),
        };
      },
    ),
  );

  // License and LicenseAction rows are no longer built here; they are produced
  // by LicenseFacade / LicenseActionFacade (ADR 0016), which resolve their own
  // canonical ids and same-source foreign keys and emit their own mutations.

  return {
    locationPaths,
    locationPathAliases,
    agencies,
    agencyOfficers,
    preparationMutations: [],
    ownedColumns,
  };
}
