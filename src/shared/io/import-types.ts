import type { z } from "zod";
import {
  IMPORT_ARTIFACT_KINDS,
  IMPORT_OPERATION_SUFFIXES,
  IMPORT_OPERATIONS,
  type ImportArtifactKind,
  type ImportEntityName,
  type ImportOperation,
  importTypeMetadata,
  type ImportTypeMetadata,
} from "./import-type-metadata.js";
import {
  AgencyPersonnelSpec,
  AgencyPhoneNumberSpec,
  AgencySpec,
  CivilCaseSpec,
  CivilCasePersonnelSpec,
  CivilCaseLinkSpec,
  CoverageLinkAgencyPersonnelSpec,
  CoverageLinkSpec,
  DisciplineAgencyPersonnelSpec,
  DisciplineSpec,
  FederalAgencyBranchSpec,
  FederalAgencySpec,
  LicenseActionSpec,
  LicenseSpec,
  LicensingAuthoritySpec,
  LocationPathAliasSpec,
  LocationPathGeometrySpec,
  LocationPathSpec,
  PersonnelSpec,
} from "./generated/entity-specs.js";

export { IMPORT_ARTIFACT_KINDS };
export type { ImportArtifactKind, ImportEntityName };

export const INTAKE_API_VERSION = "policeconduct.org/intake/v1alpha1";

export { IMPORT_OPERATIONS, IMPORT_OPERATION_SUFFIXES };
export type { ImportOperation };

export type ImportTypeDefinition = ImportTypeMetadata & {
  recordSchema: z.ZodType<Record<string, unknown>>;
};

const recordSchemas = {
  LocationPaths: LocationPathSpec,
  LocationPathGeometries: LocationPathGeometrySpec,
  LocationPathAliases: LocationPathAliasSpec,
  Agencies: AgencySpec,
  Personnel: PersonnelSpec,
  AgencyPersonnel: AgencyPersonnelSpec,
  LicensingAuthorities: LicensingAuthoritySpec,
  Licenses: LicenseSpec,
  LicenseActions: LicenseActionSpec,
  Disciplines: DisciplineSpec,
  DisciplineAgencyPersonnel: DisciplineAgencyPersonnelSpec,
  CoverageLinks: CoverageLinkSpec,
  CoverageLinkAgencyPersonnel: CoverageLinkAgencyPersonnelSpec,
  AgencyPhoneNumbers: AgencyPhoneNumberSpec,
  FederalAgencies: FederalAgencySpec,
  FederalAgencyBranches: FederalAgencyBranchSpec,
  CivilCases: CivilCaseSpec,
  CivilCasePersonnel: CivilCasePersonnelSpec,
  CivilCaseLinks: CivilCaseLinkSpec,
} satisfies Record<ImportArtifactKind, z.ZodType<Record<string, unknown>>>;

export const importTypeRegistry = {
  LocationPaths: {
    ...importTypeMetadata.LocationPaths,
    recordSchema: recordSchemas.LocationPaths,
  },
  LocationPathGeometries: {
    ...importTypeMetadata.LocationPathGeometries,
    recordSchema: recordSchemas.LocationPathGeometries,
  },
  LocationPathAliases: {
    ...importTypeMetadata.LocationPathAliases,
    recordSchema: recordSchemas.LocationPathAliases,
  },
  Agencies: {
    ...importTypeMetadata.Agencies,
    recordSchema: recordSchemas.Agencies,
  },
  Personnel: {
    ...importTypeMetadata.Personnel,
    recordSchema: recordSchemas.Personnel,
  },
  AgencyPersonnel: {
    ...importTypeMetadata.AgencyPersonnel,
    recordSchema: recordSchemas.AgencyPersonnel,
  },
  LicensingAuthorities: {
    ...importTypeMetadata.LicensingAuthorities,
    recordSchema: recordSchemas.LicensingAuthorities,
  },
  Licenses: {
    ...importTypeMetadata.Licenses,
    recordSchema: recordSchemas.Licenses,
  },
  LicenseActions: {
    ...importTypeMetadata.LicenseActions,
    recordSchema: recordSchemas.LicenseActions,
  },
  Disciplines: {
    ...importTypeMetadata.Disciplines,
    recordSchema: recordSchemas.Disciplines,
  },
  DisciplineAgencyPersonnel: {
    ...importTypeMetadata.DisciplineAgencyPersonnel,
    recordSchema: recordSchemas.DisciplineAgencyPersonnel,
  },
  CoverageLinks: {
    ...importTypeMetadata.CoverageLinks,
    recordSchema: recordSchemas.CoverageLinks,
  },
  CoverageLinkAgencyPersonnel: {
    ...importTypeMetadata.CoverageLinkAgencyPersonnel,
    recordSchema: recordSchemas.CoverageLinkAgencyPersonnel,
  },
  AgencyPhoneNumbers: {
    ...importTypeMetadata.AgencyPhoneNumbers,
    recordSchema: recordSchemas.AgencyPhoneNumbers,
  },
  FederalAgencies: {
    ...importTypeMetadata.FederalAgencies,
    recordSchema: recordSchemas.FederalAgencies,
  },
  FederalAgencyBranches: {
    ...importTypeMetadata.FederalAgencyBranches,
    recordSchema: recordSchemas.FederalAgencyBranches,
  },
  CivilCases: {
    ...importTypeMetadata.CivilCases,
    recordSchema: recordSchemas.CivilCases,
  },
  CivilCasePersonnel: {
    ...importTypeMetadata.CivilCasePersonnel,
    recordSchema: recordSchemas.CivilCasePersonnel,
  },
  CivilCaseLinks: {
    ...importTypeMetadata.CivilCaseLinks,
    recordSchema: recordSchemas.CivilCaseLinks,
  },
} satisfies Record<ImportArtifactKind, ImportTypeDefinition>;

function visitImportKind(
  kind: ImportArtifactKind,
  visiting: Set<ImportArtifactKind>,
  visited: Set<ImportArtifactKind>,
  order: ImportArtifactKind[],
): void {
  if (visited.has(kind)) {
    return;
  }
  if (visiting.has(kind)) {
    throw new Error(`Import type dependency cycle includes ${kind}.`);
  }
  visiting.add(kind);
  for (const dependency of importTypeRegistry[kind].dependsOn) {
    visitImportKind(dependency, visiting, visited, order);
  }
  visiting.delete(kind);
  visited.add(kind);
  order.push(kind);
}

export function importArtifactKindOrder(): ImportArtifactKind[] {
  const order: ImportArtifactKind[] = [];
  const visited = new Set<ImportArtifactKind>();
  for (const kind of IMPORT_ARTIFACT_KINDS) {
    visitImportKind(kind, new Set(), visited, order);
  }
  return order;
}

const orderIndex = new Map(
  importArtifactKindOrder().map((kind, index) => [kind, index]),
);

export function compareImportArtifactKinds(
  left: ImportArtifactKind,
  right: ImportArtifactKind,
): number {
  return orderIndex.get(left)! - orderIndex.get(right)!;
}

export function sourceNameForImportRecord(
  recordName: string,
  _record: unknown,
): string {
  return recordName;
}

export function mutationKindForRecordKind(
  operation: ImportOperation,
  recordKind: string,
): string {
  return `${recordKind}${IMPORT_OPERATION_SUFFIXES[operation]}`;
}

export function parseMutationKind(mutationKind: string): {
  operation: ImportOperation;
  recordKind: string;
} {
  for (const [operation, suffix] of Object.entries(
    IMPORT_OPERATION_SUFFIXES,
  ) as [ImportOperation, string][]) {
    if (mutationKind.endsWith(suffix) && mutationKind.length > suffix.length) {
      return {
        operation,
        recordKind: mutationKind.slice(0, -suffix.length),
      };
    }
  }
  throw new Error(`Unsupported DatabaseMutation kind: ${mutationKind}`);
}

export const IMPORT_MUTATION_KINDS = Object.values(importTypeRegistry).flatMap(
  (definition) =>
    IMPORT_OPERATIONS.map((operation) =>
      mutationKindForRecordKind(operation, definition.recordKind),
    ),
) as [string, ...string[]];
