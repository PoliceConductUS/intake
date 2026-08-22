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
  "Disciplines",
  "DisciplineAgencyOfficers",
  "CoverageLinks",
  "CoverageLinkAgencyOfficers",
  "AgencyPhoneNumbers",
  "FederalAgencies",
  "FederalAgencyBranches",
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
  | "licenseActions"
  | "disciplines"
  | "disciplineAgencyOfficers"
  | "coverageLinks"
  | "coverageLinkAgencyOfficers"
  | "agencyPhoneNumbers"
  | "federalAgencies"
  | "federalAgencyBranches";

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
  Disciplines: {
    kind: "Disciplines",
    recordKind: "Discipline",
    entityName: "disciplines",
    targetTable: "public.discipline",
    dependsOn: [],
  },
  DisciplineAgencyOfficers: {
    kind: "DisciplineAgencyOfficers",
    recordKind: "DisciplineAgencyOfficer",
    entityName: "disciplineAgencyOfficers",
    targetTable: "public.discipline_agency_officers",
    dependsOn: ["Disciplines", "AgencyPersonnel"],
  },
  CoverageLinks: {
    kind: "CoverageLinks",
    recordKind: "CoverageLink",
    entityName: "coverageLinks",
    targetTable: "public.coverage_links",
    dependsOn: [],
  },
  CoverageLinkAgencyOfficers: {
    kind: "CoverageLinkAgencyOfficers",
    recordKind: "CoverageLinkAgencyOfficer",
    entityName: "coverageLinkAgencyOfficers",
    targetTable: "public.coverage_link_agency_officers",
    dependsOn: ["CoverageLinks", "AgencyPersonnel"],
  },
  AgencyPhoneNumbers: {
    kind: "AgencyPhoneNumbers",
    recordKind: "AgencyPhoneNumber",
    entityName: "agencyPhoneNumbers",
    targetTable: "public.agency_phone_numbers",
    dependsOn: ["Agencies"],
  },
  FederalAgencies: {
    kind: "FederalAgencies",
    recordKind: "FederalAgency",
    entityName: "federalAgencies",
    targetTable: "public.federal_agency",
    dependsOn: [],
  },
  FederalAgencyBranches: {
    kind: "FederalAgencyBranches",
    recordKind: "FederalAgencyBranch",
    entityName: "federalAgencyBranches",
    targetTable: "public.federal_agency_branch",
    dependsOn: ["FederalAgencies", "Agencies"],
  },
} satisfies Record<ImportArtifactKind, ImportTypeMetadata>;
