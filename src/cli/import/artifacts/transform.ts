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
import {
  assertCanonicalMappingFields,
  type SourceNameToCanonicalIds,
} from "../../state/source-name-to-canonical-id/index.js";

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
  addresses?: Record<string, unknown>;
  emails?: Record<string, unknown>;
  location?: Record<string, unknown>;
  phones?: Record<string, unknown>;
  urls?: Record<string, unknown>;
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

export type ResolvedLicensingAuthorityState = {
  locationPathId?: string;
};

export type ResolvedProperties = {
  agencies: Record<string, ResolvedAgencyState>;
  personnel: Record<string, ResolvedPersonState>;
  licensingAuthorities?: Record<string, ResolvedLicensingAuthorityState>;
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

export type OfficerRow = {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  prefix: string | null;
  suffix: string | null;
  slug: string | undefined;
};

export type OfficerColumn = Exclude<keyof OfficerRow, "id">;

export type AgencyOfficerRow = {
  id: string;
  agency_id: string;
  personnel_id: string;
  badge_number: string | null;
  start_date: string;
  end_date: string | null;
  title: string;
  license_id: string | null;
};

export type AgencyOfficerColumn = Exclude<keyof AgencyOfficerRow, "id">;

export type LicensingAuthorityRow = {
  id: string;
  name: string;
  abbreviation: string | null;
  website: string | null;
  location_path_id: string;
};

export type LicensingAuthorityColumn = Exclude<
  keyof LicensingAuthorityRow,
  "id"
>;

export type LicenseRow = {
  id: string;
  officer_id: string;
  license_type: string;
  status: string | null;
  first_awarded: string | null;
  issued_by_authority_id: string;
};

export type LicenseColumn = Exclude<keyof LicenseRow, "id">;

export type LicenseActionRow = {
  id: string;
  license_id: string;
  action: string;
  action_date: string | null;
  status: string | null;
};

export type LicenseActionColumn = Exclude<keyof LicenseActionRow, "id">;

export type ImportRows = {
  locationPaths: LocationPathRow[];
  locationPathGeometries?: LocationPathGeometryRow[];
  locationPathAliases: LocationPathAliasRow[];
  agencies: AgencyRow[];
  officers: OfficerRow[];
  agencyOfficers: AgencyOfficerRow[];
  licensingAuthorities?: LicensingAuthorityRow[];
  licenses?: LicenseRow[];
  licenseActions?: LicenseActionRow[];
  preparationMutations: PreparationMutation[];
  ownedColumns: {
    agencies: Record<string, AgencyColumn[]>;
    officers: Record<string, OfficerColumn[]>;
    agencyOfficers: Record<string, AgencyOfficerColumn[]>;
    licensingAuthorities?: Record<string, LicensingAuthorityColumn[]>;
    licenses?: Record<string, LicenseColumn[]>;
    licenseActions?: Record<string, LicenseActionColumn[]>;
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

const officerSourceColumns: OfficerColumn[] = [
  "first_name",
  "last_name",
  "middle_name",
  "prefix",
  "suffix",
];

const agencyOfficerSourceColumns: AgencyOfficerColumn[] = [
  "agency_id",
  "personnel_id",
  "badge_number",
  "start_date",
  "end_date",
  "title",
  "license_id",
];

const licensingAuthoritySourceColumns: LicensingAuthorityColumn[] = [
  "name",
  "abbreviation",
  "website",
  "location_path_id",
];

const licenseSourceColumns: LicenseColumn[] = [
  "officer_id",
  "license_type",
  "status",
  "first_awarded",
  "issued_by_authority_id",
];

const licenseActionSourceColumns: LicenseActionColumn[] = [
  "license_id",
  "action",
  "action_date",
  "status",
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

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "record"
  );
}

function canonicalSuffix(id: unknown): string {
  const normalized = String(id)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  return normalized.slice(-6) || "record";
}

function personnelSlug(input: {
  canonicalId: string;
  firstName: string;
  lastName: string;
  resolvedSlug?: string;
}): string {
  return (
    input.resolvedSlug ??
    `${slugify(`${input.firstName} ${input.lastName}`)}-${canonicalSuffix(input.canonicalId)}`
  );
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

function locationPathRow(
  recordKey: string,
  sourceValue: unknown,
  mappings: SourceNameToCanonicalIds,
): LocationPathRow {
  const source = valueAsRecord(recordKey, sourceValue);
  const sourceName = sourceNameForImportRecord(recordKey, sourceValue);
  requiredString(sourceName, "location_path_id", source.location_path_id);
  const mapping = mappings.locationPaths[sourceName];
  const parentLocationPathSourceKey = valueAsStringOrNull(
    source.parent_location_path_id,
  );
  const parentCanonicalId =
    parentLocationPathSourceKey === null
      ? null
      : mappings.locationPaths[parentLocationPathSourceKey]?.canonicalId;
  if (parentLocationPathSourceKey !== null && parentCanonicalId === undefined) {
    throw new Error(
      `Artifacts location path ${sourceName} references unmapped parent location path ${parentLocationPathSourceKey}.`,
    );
  }
  const databaseFields = Object.fromEntries(
    Object.entries(source).filter(([fieldName]) => !fieldName.startsWith("_")),
  );
  const result = LocationPathSpec.safeParse({
    ...databaseFields,
    location_path_id: mapping?.canonicalId,
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

function locationPathAliasRow(
  sourceName: string,
  sourceValue: unknown,
  locationPathSourceKeyByPath: Record<string, string>,
  mappings: SourceNameToCanonicalIds,
): LocationPathAliasRow {
  const source = valueAsRecord(sourceName, sourceValue);
  const sourceLocationPathId = requiredString(
    sourceName,
    "location_path_id",
    source.location_path_id,
  );
  const locationPathSourceKey =
    locationPathSourceKeyByPath[sourceLocationPathId] ?? sourceLocationPathId;
  const canonicalLocationPathId =
    mappings.locationPaths[locationPathSourceKey]?.canonicalId ??
    sourceLocationPathId;
  return {
    alias_path: requiredString(sourceName, "alias_path", source.alias_path),
    location_path_id: canonicalLocationPathId,
  };
}

function locationPathGeometryRow(
  sourceName: string,
  sourceValue: unknown,
  mappings: SourceNameToCanonicalIds,
): LocationPathGeometryRow {
  const source = valueAsRecord(sourceName, sourceValue);
  const sourceLocationPathKey = requiredString(
    sourceName,
    "sourceLocationPathKey",
    source.sourceLocationPathKey,
  );
  const canonicalLocationPathId =
    mappings.locationPaths[sourceLocationPathKey]?.canonicalId;
  if (canonicalLocationPathId === undefined) {
    throw new Error(
      `Artifacts location path geometry ${sourceName} references unmapped location path ${sourceLocationPathKey}.`,
    );
  }

  return {
    location_path_id: canonicalLocationPathId,
    sourceLocationPathKey,
    geometry: source.geometry,
  };
}

export function transformArtifacts(
  artifacts: ArtifactsEnvelope,
  mappings: SourceNameToCanonicalIds,
  resolvedProperties: ResolvedProperties = { agencies: {}, personnel: {} },
): ImportRows {
  validateImportRecords(artifacts);
  assertCanonicalMappingFields(artifacts, mappings);
  const ownedColumns: ImportRows["ownedColumns"] = {
    agencies: {},
    officers: {},
    agencyOfficers: {},
    licensingAuthorities: {},
    licenses: {},
    licenseActions: {},
  };

  const locationPaths = Object.entries(
    entityMap(artifacts, "locationPaths"),
  ).map(([recordKey, sourceValue]) =>
    locationPathRow(recordKey, sourceValue, mappings),
  );

  const locationPathSourceKeyByPath = locationPathSourceKeysByPath(artifacts);
  const locationPathAliases = Object.entries(
    entityMap(artifacts, "locationPathAliases"),
  ).map(([sourceName, sourceValue]) =>
    locationPathAliasRow(
      sourceName,
      sourceValue,
      locationPathSourceKeyByPath,
      mappings,
    ),
  );
  const locationPathGeometries = Object.entries(
    entityMap(artifacts, "locationPathGeometries"),
  ).map(([sourceName, sourceValue]) =>
    locationPathGeometryRow(sourceName, sourceValue, mappings),
  );

  const agencies = Object.entries(entityMap(artifacts, "agencies")).map(
    ([recordKey, sourceValue]): AgencyRow => {
      const sourceName = sourceNameForImportRecord(recordKey, sourceValue);
      const source = valueAsRecord(sourceName, sourceValue);
      const mapping = mappings.agencies[sourceName];
      const canonicalId = mapping.canonicalId!;
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
          valueAsNumberOrUndefined(source.latitude) ?? resolvedAgency.latitude,
        longitude:
          valueAsNumberOrUndefined(source.longitude) ??
          resolvedAgency.longitude,
        ...(valueAsObjectOrUndefined(source.addresses) === undefined
          ? {}
          : { addresses: valueAsObjectOrUndefined(source.addresses) }),
        ...(valueAsObjectOrUndefined(source.emails) === undefined
          ? {}
          : { emails: valueAsObjectOrUndefined(source.emails) }),
        ...(valueAsObjectOrUndefined(source.location) === undefined
          ? {}
          : { location: valueAsObjectOrUndefined(source.location) }),
        ...(valueAsObjectOrUndefined(source.phones) === undefined
          ? {}
          : { phones: valueAsObjectOrUndefined(source.phones) }),
        ...(valueAsObjectOrUndefined(source.urls) === undefined
          ? {}
          : { urls: valueAsObjectOrUndefined(source.urls) }),
      };
    },
  );

  const officers = Object.entries(entityMap(artifacts, "personnel")).map(
    ([recordKey, sourceValue]): OfficerRow => {
      const sourceName = sourceNameForImportRecord(recordKey, sourceValue);
      const source = valueAsRecord(sourceName, sourceValue);
      const mapping = mappings.personnel[sourceName];
      const canonicalId = mapping.canonicalId!;
      const resolvedPerson = resolvedProperties.personnel[canonicalId] ?? {};
      const firstName = requiredString(
        sourceName,
        "first_name",
        source.first_name,
      );
      const lastName = requiredString(
        sourceName,
        "last_name",
        source.last_name,
      );
      const sourceOwnedColumns = officerSourceColumns.filter((columnName) =>
        hasOwnField(source, columnName),
      );
      ownedColumns.officers[canonicalId] = [...sourceOwnedColumns, "slug"];

      return {
        id: canonicalId,
        first_name: firstName,
        last_name: lastName,
        middle_name: valueAsStringOrNull(source.middle_name),
        prefix: valueAsStringOrNull(source.prefix),
        suffix: valueAsStringOrNull(source.suffix),
        slug: personnelSlug({
          canonicalId,
          firstName,
          lastName,
          resolvedSlug: resolvedPerson.slug,
        }),
      };
    },
  );

  const agencyOfficers = Object.entries(
    entityMap(artifacts, "agencyPersonnel"),
  ).map(([recordKey, sourceValue]): AgencyOfficerRow => {
    const sourceName = sourceNameForImportRecord(recordKey, sourceValue);
    const source = valueAsRecord(sourceName, sourceValue);
    const mapping = mappings.agencyPersonnel[sourceName];
    const canonicalId = mapping.canonicalId!;
    const sourceAgencyId = valueAsStringOrNull(source.agency_id);
    const sourcePersonnelId = valueAsStringOrNull(source.personnel_id);
    const agencyMapping =
      sourceAgencyId === null ? undefined : mappings.agencies[sourceAgencyId];
    const personnelMapping =
      sourcePersonnelId === null
        ? undefined
        : mappings.personnel[sourcePersonnelId];

    if (sourceAgencyId === null || agencyMapping?.canonicalId === undefined) {
      throw new Error(
        `Agency-personnel source record ${sourceName} references unmapped agency ${sourceAgencyId}.`,
      );
    }

    if (
      sourcePersonnelId === null ||
      personnelMapping?.canonicalId === undefined
    ) {
      throw new Error(
        `Agency-personnel source record ${sourceName} references unmapped personnel ${sourcePersonnelId}.`,
      );
    }

    ownedColumns.agencyOfficers[canonicalId] =
      agencyOfficerSourceColumns.filter((columnName) =>
        hasOwnField(source, columnName),
      );

    const sourceLicenseKey = valueAsStringOrNull(source.license_id);
    let licenseCanonicalId: string | null = null;
    if (sourceLicenseKey !== null) {
      licenseCanonicalId =
        mappings.licenses?.[sourceLicenseKey]?.canonicalId ?? null;
      if (licenseCanonicalId === null) {
        throw new Error(
          `Agency-personnel source record ${sourceName} references unmapped license ${sourceLicenseKey}.`,
        );
      }
    }

    return {
      id: canonicalId,
      agency_id: agencyMapping.canonicalId,
      personnel_id: personnelMapping.canonicalId,
      badge_number: valueAsStringOrNull(source.badge_number),
      start_date: requiredString(sourceName, "start_date", source.start_date),
      end_date: valueAsStringOrNull(source.end_date),
      title: requiredString(sourceName, "title", source.title),
      license_id: licenseCanonicalId,
    };
  });

  const licensingAuthorities = Object.entries(
    entityMap(artifacts, "licensingAuthorities"),
  ).map(([recordKey, sourceValue]): LicensingAuthorityRow => {
    const sourceName = sourceNameForImportRecord(recordKey, sourceValue);
    const source = valueAsRecord(sourceName, sourceValue);
    const canonicalId =
      mappings.licensingAuthorities?.[sourceName]?.canonicalId;
    if (canonicalId === undefined) {
      throw new Error(
        `Artifacts licensing authority ${sourceName} has no canonical id mapping.`,
      );
    }
    // The source emits a namespace-LOCAL state value (e.g. "tx"); the intake
    // root resolves it to a canonical location_path via getByPath and surfaces
    // it here in resolvedProperties (mirroring how agencies read their resolved
    // locationPathId). Resolve-or-fail per ADR 0006 — no ledger lookup.
    const state = requiredString(
      sourceName,
      "location_path_id",
      source.location_path_id,
    );
    const locationPathCanonicalId =
      resolvedProperties.licensingAuthorities?.[canonicalId]?.locationPathId;
    if (locationPathCanonicalId === undefined) {
      throw new Error(
        `Artifacts licensing authority ${sourceName} references location ${state} which is not an imported location_path.`,
      );
    }
    ownedColumns.licensingAuthorities![canonicalId] =
      licensingAuthoritySourceColumns.filter((columnName) =>
        hasOwnField(source, columnName),
      );

    return {
      id: canonicalId,
      name: requiredString(sourceName, "name", source.name),
      abbreviation: valueAsStringOrNull(source.abbreviation),
      website: valueAsStringOrNull(source.website),
      location_path_id: locationPathCanonicalId,
    };
  });

  const licenses = Object.entries(entityMap(artifacts, "licenses")).map(
    ([recordKey, sourceValue]): LicenseRow => {
      const sourceName = sourceNameForImportRecord(recordKey, sourceValue);
      const source = valueAsRecord(sourceName, sourceValue);
      const canonicalId = mappings.licenses?.[sourceName]?.canonicalId;
      if (canonicalId === undefined) {
        throw new Error(
          `Artifacts license ${sourceName} has no canonical id mapping.`,
        );
      }
      const sourceOfficerId = requiredString(
        sourceName,
        "officer_id",
        source.officer_id,
      );
      const officerCanonicalId =
        mappings.personnel[sourceOfficerId]?.canonicalId;
      if (officerCanonicalId === undefined) {
        throw new Error(
          `Artifacts license ${sourceName} references unmapped personnel ${sourceOfficerId}.`,
        );
      }
      const sourceAuthorityId = requiredString(
        sourceName,
        "issued_by_authority_id",
        source.issued_by_authority_id,
      );
      const authorityCanonicalId =
        mappings.licensingAuthorities?.[sourceAuthorityId]?.canonicalId;
      if (authorityCanonicalId === undefined) {
        throw new Error(
          `Artifacts license ${sourceName} references unmapped licensing authority ${sourceAuthorityId}.`,
        );
      }
      ownedColumns.licenses![canonicalId] = licenseSourceColumns.filter(
        (columnName) => hasOwnField(source, columnName),
      );

      return {
        id: canonicalId,
        officer_id: officerCanonicalId,
        license_type: requiredString(
          sourceName,
          "license_type",
          source.license_type,
        ),
        status: valueAsStringOrNull(source.status),
        first_awarded: valueAsStringOrNull(source.first_awarded),
        issued_by_authority_id: authorityCanonicalId,
      };
    },
  );

  const licenseActions = Object.entries(
    entityMap(artifacts, "licenseActions"),
  ).map(([recordKey, sourceValue]): LicenseActionRow => {
    const sourceName = sourceNameForImportRecord(recordKey, sourceValue);
    const source = valueAsRecord(sourceName, sourceValue);
    const canonicalId = mappings.licenseActions?.[sourceName]?.canonicalId;
    if (canonicalId === undefined) {
      throw new Error(
        `Artifacts license action ${sourceName} has no canonical id mapping.`,
      );
    }
    const sourceLicenseId = requiredString(
      sourceName,
      "license_id",
      source.license_id,
    );
    const licenseCanonicalId =
      mappings.licenses?.[sourceLicenseId]?.canonicalId;
    if (licenseCanonicalId === undefined) {
      throw new Error(
        `Artifacts license action ${sourceName} references unmapped license ${sourceLicenseId}.`,
      );
    }
    ownedColumns.licenseActions![canonicalId] =
      licenseActionSourceColumns.filter((columnName) =>
        hasOwnField(source, columnName),
      );

    return {
      id: canonicalId,
      license_id: licenseCanonicalId,
      action: requiredString(sourceName, "action", source.action),
      action_date: valueAsStringOrNull(source.action_date),
      status: valueAsStringOrNull(source.status),
    };
  });

  return {
    locationPaths,
    locationPathGeometries,
    locationPathAliases,
    agencies,
    officers,
    agencyOfficers,
    licensingAuthorities,
    licenses,
    licenseActions,
    preparationMutations: [],
    ownedColumns,
  };
}
