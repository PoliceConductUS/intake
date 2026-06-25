export const IMPORT_ARTIFACT_KINDS = [
  "LocationPaths",
  "LocationPathGeometries",
  "LocationPathAliases",
  "Agencies",
  "Personnel",
  "AgencyPersonnel",
] as const;

export type ImportArtifactKind = (typeof IMPORT_ARTIFACT_KINDS)[number];

export const IMPORT_OPERATIONS = [
  "create",
  "read",
  "update",
  "delete",
  "list",
] as const;

export type ImportOperation = (typeof IMPORT_OPERATIONS)[number];

export const IMPORT_OPERATION_SUFFIXES = {
  create: "Create",
  read: "Read",
  update: "Update",
  delete: "Delete",
  list: "List",
} satisfies Record<ImportOperation, string>;

export type ImportEntityName =
  | "locationPaths"
  | "locationPathGeometries"
  | "locationPathAliases"
  | "agencies"
  | "personnel"
  | "agencyPersonnel";

export type ImportTypeMetadata = {
  kind: ImportArtifactKind;
  recordKind: string;
  entityName: ImportEntityName;
  targetTable?: string;
  dependsOn: readonly ImportArtifactKind[];
};

export const importTypeMetadata = {
  LocationPaths: {
    kind: "LocationPaths",
    recordKind: "LocationPath",
    entityName: "locationPaths",
    targetTable: "public.location_path",
    dependsOn: [],
  },
  LocationPathGeometries: {
    kind: "LocationPathGeometries",
    recordKind: "LocationPathGeometry",
    entityName: "locationPathGeometries",
    targetTable: "public.location_path_geometry",
    dependsOn: ["LocationPaths"],
  },
  LocationPathAliases: {
    kind: "LocationPathAliases",
    recordKind: "LocationPathAlias",
    entityName: "locationPathAliases",
    targetTable: "public.location_path_alias",
    dependsOn: ["LocationPaths"],
  },
  Agencies: {
    kind: "Agencies",
    recordKind: "Agency",
    entityName: "agencies",
    targetTable: "public.agency",
    dependsOn: ["LocationPaths", "LocationPathAliases"],
  },
  Personnel: {
    kind: "Personnel",
    recordKind: "Personnel",
    entityName: "personnel",
    targetTable: "public.officers",
    dependsOn: [],
  },
  AgencyPersonnel: {
    kind: "AgencyPersonnel",
    recordKind: "AgencyPersonnel",
    entityName: "agencyPersonnel",
    targetTable: "public.agency_officers",
    dependsOn: ["Agencies", "Personnel"],
  },
} satisfies Record<ImportArtifactKind, ImportTypeMetadata>;
