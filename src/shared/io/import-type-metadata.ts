export const IMPORT_ARTIFACT_KINDS = [
  "LocationPaths",
  "LocationPathGeometries",
  "LocationPathAliases",
  "Agencies",
  "Personnel",
  "AgencyPersonnel",
  "LicensingAuthorities",
  "Licenses",
  "LicenseActions",
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
  | "agencyPersonnel"
  | "licensingAuthorities"
  | "licenses"
  | "licenseActions";

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
    dependsOn: ["Agencies", "Personnel", "Licenses"],
  },
  LicensingAuthorities: {
    kind: "LicensingAuthorities",
    recordKind: "LicensingAuthority",
    entityName: "licensingAuthorities",
    targetTable: "public.licensing_authority",
    dependsOn: ["LocationPaths"],
  },
  Licenses: {
    kind: "Licenses",
    recordKind: "License",
    entityName: "licenses",
    targetTable: "public.license",
    dependsOn: ["LicensingAuthorities", "Personnel"],
  },
  LicenseActions: {
    kind: "LicenseActions",
    recordKind: "LicenseAction",
    entityName: "licenseActions",
    targetTable: "public.license_action",
    dependsOn: ["Licenses"],
  },
} satisfies Record<ImportArtifactKind, ImportTypeMetadata>;

/**
 * The import artifact kinds in database-dependency order: a topological sort of
 * each kind's `dependsOn`, so a referenced entity is always processed and
 * applied before the entity that references it. This is the single source of
 * truth for emission/apply order — do not hand-order mutations. `IMPORT_ARTIFACT_KINDS`
 * itself is only a declaration list and is deliberately NOT dependency-ordered.
 */
export const IMPORT_ARTIFACT_KINDS_IN_DEPENDENCY_ORDER: readonly ImportArtifactKind[] =
  (() => {
    const ordered: ImportArtifactKind[] = [];
    const done = new Set<ImportArtifactKind>();
    const onStack = new Set<ImportArtifactKind>();
    const visit = (kind: ImportArtifactKind): void => {
      if (done.has(kind)) {
        return;
      }
      if (onStack.has(kind)) {
        throw new Error(
          `Cyclic import dependency involving ${kind}; dependsOn must be a DAG.`,
        );
      }
      onStack.add(kind);
      for (const dependency of importTypeMetadata[kind].dependsOn) {
        visit(dependency);
      }
      onStack.delete(kind);
      done.add(kind);
      ordered.push(kind);
    };
    for (const kind of IMPORT_ARTIFACT_KINDS) {
      visit(kind);
    }
    return ordered;
  })();

/** Each record kind (e.g. `Agency`) in database-dependency order. */
export const IMPORT_RECORD_KINDS_IN_DEPENDENCY_ORDER: readonly string[] =
  IMPORT_ARTIFACT_KINDS_IN_DEPENDENCY_ORDER.map(
    (kind) => importTypeMetadata[kind].recordKind,
  );
