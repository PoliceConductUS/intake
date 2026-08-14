import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createId } from "@paralleldrive/cuid2";
import type { ArtifactsEnvelope } from "../../../shared/io/Artifacts.js";
import { SourceNameToCanonicalId } from "./SourceNameToCanonicalId.js";
import { yamlResourceFileName } from "../../../shared/io/resource.js";
import {
  importKindByEntityName,
  sourceNameForImportRecord,
} from "../../../shared/io/import-types.js";

export type AgencyMapping = {
  kind?: "Agency";
  canonicalId?: string;
};

export type PersonnelMapping = {
  kind?: "Personnel";
  canonicalId?: string;
};

export type AgencyPersonnelMapping = {
  kind?: "AgencyPersonnel";
  canonicalId?: string;
};

export type LocationPathMapping = {
  kind?: "LocationPath";
  canonicalId?: string;
};

export type LicensingAuthorityMapping = {
  kind?: "LicensingAuthority";
  canonicalId?: string;
};

export type LicenseMapping = {
  kind?: "License";
  canonicalId?: string;
};

export type LicenseActionMapping = {
  kind?: "LicenseAction";
  canonicalId?: string;
};

export type SourceNameToCanonicalIds = {
  locationPaths: Record<string, LocationPathMapping>;
  agencies: Record<string, AgencyMapping>;
  personnel: Record<string, PersonnelMapping>;
  agencyPersonnel: Record<string, AgencyPersonnelMapping>;
  licensingAuthorities?: Record<string, LicensingAuthorityMapping>;
  licenses?: Record<string, LicenseMapping>;
  licenseActions?: Record<string, LicenseActionMapping>;
};

type MappingPathOptions = {
  rootDir?: string;
};

const sourceNameKinds = {
  locationPath: "LocationPath",
  agency: "Agency",
  personnel: "Personnel",
  agencyPersonnel: "AgencyPersonnel",
  licensingAuthority: "LicensingAuthority",
  license: "License",
  licenseAction: "LicenseAction",
} as const;

function artifactsEntityKeys(
  artifacts: ArtifactsEnvelope,
  entityName:
    | "locationPaths"
    | "agencies"
    | "personnel"
    | "agencyPersonnel"
    | "licensingAuthorities"
    | "licenses"
    | "licenseActions",
): string[] {
  const kind = importKindByEntityName[entityName];
  const entityMap = Object.assign(
    {},
    ...artifacts.spec.artifacts
      .filter((artifact) => artifact.kind === kind)
      .map((artifact) => artifact.spec.records),
  ) as Record<string, unknown>;

  return Object.entries(entityMap).map(([recordKey, record]) =>
    sourceNameForImportRecord(recordKey, record),
  );
}

function formatRequiredMappingError(
  mappingType: string,
  sourceName: string,
  mapping: { canonicalId?: string } | undefined,
): string | undefined {
  if (mapping?.canonicalId !== undefined && mapping.canonicalId.length > 0) {
    return undefined;
  }

  return `${mappingType} source name ${sourceName} is missing required field canonicalId.`;
}

export function resolveSourceNameToCanonicalIdPath(
  namespace: string,
  options: MappingPathOptions = {},
): string {
  const rootDir = options.rootDir ?? process.env.INTAKE_WORKSPACE;
  if (rootDir === undefined || rootDir.trim().length === 0) {
    throw new Error(
      "INTAKE_WORKSPACE is required to resolve SourceNameToCanonicalId records.",
    );
  }

  return path.join(rootDir, "intake", "state", "namespaces", namespace);
}

function mappingRecordPath(
  mappingDirectory: string,
  entityDirectory: string,
  sourceName: string,
): string {
  return path.join(
    mappingDirectory,
    entityDirectory,
    yamlResourceFileName(sourceName, "SourceNameToCanonicalId"),
  );
}

async function readMappingRecord<T>(
  mappingPath: string,
  namespace: string,
  expectedKind: string,
): Promise<{ sourceName: string; spec: T }> {
  const mapping = await SourceNameToCanonicalId.read(mappingPath, {
    expectedNamespace: namespace,
  });
  if (mapping.spec.kind !== expectedKind) {
    throw new Error(
      `SourceNameToCanonicalId kind ${mapping.spec.kind} does not match expected kind ${expectedKind}: ${mappingPath}`,
    );
  }

  return {
    sourceName: mapping.metadata.name,
    spec: mapping.spec as T,
  };
}

async function readMappingDirectory<T>(
  mappingDirectory: string,
  namespace: string,
  entityDirectory: string,
  expectedKind: string,
): Promise<Record<string, T>> {
  const entityPath = path.join(mappingDirectory, entityDirectory);
  let entries;
  try {
    entries = await readdir(entityPath);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === "ENOENT") {
      return {};
    }
    throw new Error(
      `SourceNameToCanonicalId directory is not readable: ${entityPath}`,
    );
  }

  const records: Record<string, T> = {};
  for (const entry of entries.filter((fileName) =>
    fileName.endsWith(".SourceNameToCanonicalId.yaml"),
  )) {
    const record = await readMappingRecord(
      path.join(entityPath, entry),
      namespace,
      expectedKind,
    );
    records[record.sourceName] = record.spec as T;
  }
  return records;
}

export async function loadSourceNameToCanonicalIds(
  namespace: string,
  options: MappingPathOptions = {},
): Promise<SourceNameToCanonicalIds> {
  const mappingDirectory = resolveSourceNameToCanonicalIdPath(
    namespace,
    options,
  );
  try {
    await mkdir(mappingDirectory, { recursive: true });
  } catch {
    throw new Error(
      `SourceNameToCanonicalId directory is not writable: ${mappingDirectory}`,
    );
  }

  let directoryStat;
  try {
    directoryStat = await stat(mappingDirectory);
  } catch {
    throw new Error(
      `SourceNameToCanonicalId directory is not readable: ${mappingDirectory}`,
    );
  }

  if (!directoryStat.isDirectory()) {
    throw new Error(
      `SourceNameToCanonicalId path is not a directory: ${mappingDirectory}`,
    );
  }

  const mappings: SourceNameToCanonicalIds = {
    locationPaths: await readMappingDirectory(
      mappingDirectory,
      namespace,
      "LocationPath",
      sourceNameKinds.locationPath,
    ),
    agencies: await readMappingDirectory(
      mappingDirectory,
      namespace,
      "Agency",
      sourceNameKinds.agency,
    ),
    personnel: await readMappingDirectory(
      mappingDirectory,
      namespace,
      "Personnel",
      sourceNameKinds.personnel,
    ),
    agencyPersonnel: await readMappingDirectory(
      mappingDirectory,
      namespace,
      "AgencyPersonnel",
      sourceNameKinds.agencyPersonnel,
    ),
    licensingAuthorities: await readMappingDirectory(
      mappingDirectory,
      namespace,
      "LicensingAuthority",
      sourceNameKinds.licensingAuthority,
    ),
    licenses: await readMappingDirectory(
      mappingDirectory,
      namespace,
      "License",
      sourceNameKinds.license,
    ),
    licenseActions: await readMappingDirectory(
      mappingDirectory,
      namespace,
      "LicenseAction",
      sourceNameKinds.licenseAction,
    ),
  };

  return mappings;
}

export async function persistSourceNameToCanonicalIds(
  namespace: string,
  mappings: SourceNameToCanonicalIds,
  options: MappingPathOptions = {},
): Promise<void> {
  const mappingDirectory = resolveSourceNameToCanonicalIdPath(
    namespace,
    options,
  );

  for (const [entityDirectory, expectedKind, records] of [
    ["LocationPath", sourceNameKinds.locationPath, mappings.locationPaths],
    ["Agency", sourceNameKinds.agency, mappings.agencies],
    ["Personnel", sourceNameKinds.personnel, mappings.personnel],
    [
      "AgencyPersonnel",
      sourceNameKinds.agencyPersonnel,
      mappings.agencyPersonnel,
    ],
    [
      "LicensingAuthority",
      sourceNameKinds.licensingAuthority,
      mappings.licensingAuthorities ?? {},
    ],
    ["License", sourceNameKinds.license, mappings.licenses ?? {}],
    [
      "LicenseAction",
      sourceNameKinds.licenseAction,
      mappings.licenseActions ?? {},
    ],
  ] as const) {
    await mkdir(path.join(mappingDirectory, entityDirectory), {
      recursive: true,
    });
    for (const [sourceName, record] of Object.entries(records)) {
      await SourceNameToCanonicalId.write(
        path.dirname(
          mappingRecordPath(mappingDirectory, entityDirectory, sourceName),
        ),
        SourceNameToCanonicalId.new({
          metadata: {
            name: sourceName,
            namespace,
          },
          spec: {
            ...record,
            kind: expectedKind,
          },
        }),
      );
    }
  }
}

export function assertRequiredMappingFields(
  artifacts: ArtifactsEnvelope,
  mappings: SourceNameToCanonicalIds,
): void {
  assertCanonicalMappingFields(artifacts, mappings);
}

export function assertCanonicalMappingFields(
  artifacts: ArtifactsEnvelope,
  mappings: SourceNameToCanonicalIds,
): void {
  const errors: string[] = [];

  for (const sourceName of artifactsEntityKeys(artifacts, "locationPaths")) {
    const mapping = mappings.locationPaths[sourceName];
    const error = formatRequiredMappingError(
      "Location path",
      sourceName,
      mapping,
    );
    if (error !== undefined) {
      errors.push(error);
    }
  }

  for (const sourceName of artifactsEntityKeys(artifacts, "agencies")) {
    const mapping = mappings.agencies[sourceName];
    const error = formatRequiredMappingError("Agency", sourceName, mapping);
    if (error !== undefined) {
      errors.push(error);
    }
  }

  for (const sourceName of artifactsEntityKeys(artifacts, "personnel")) {
    const mapping = mappings.personnel[sourceName];
    const error = formatRequiredMappingError("Personnel", sourceName, mapping);
    if (error !== undefined) {
      errors.push(error);
    }
  }

  for (const sourceName of artifactsEntityKeys(artifacts, "agencyPersonnel")) {
    const mapping = mappings.agencyPersonnel[sourceName];
    const error = formatRequiredMappingError(
      "Agency-personnel",
      sourceName,
      mapping,
    );
    if (error !== undefined) {
      errors.push(error);
    }
  }

  for (const sourceName of artifactsEntityKeys(
    artifacts,
    "licensingAuthorities",
  )) {
    const mapping = mappings.licensingAuthorities?.[sourceName];
    const error = formatRequiredMappingError(
      "Licensing authority",
      sourceName,
      mapping,
    );
    if (error !== undefined) {
      errors.push(error);
    }
  }

  // License ids are still minted in resolveArtifactsSourceNameToCanonicalIds (the
  // row-based AgencyPersonnel transform consumes them), so they are asserted here
  // as before. LicenseAction identity is owned solely by the LicenseActionFacade
  // canonical-id resolver (ADR 0016 #4) and is not asserted — mirroring
  // LicensingAuthorities.
  for (const sourceName of artifactsEntityKeys(artifacts, "licenses")) {
    const mapping = mappings.licenses?.[sourceName];
    const error = formatRequiredMappingError("License", sourceName, mapping);
    if (error !== undefined) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      ["SourceNameToCanonicalId records are incomplete.", ...errors].join("\n"),
    );
  }
}

export async function resolveArtifactsSourceNameToCanonicalIds(
  artifacts: ArtifactsEnvelope,
  mappings: SourceNameToCanonicalIds,
  options: MappingPathOptions = {},
): Promise<SourceNameToCanonicalIds> {
  const namespace = artifacts.metadata.namespace;
  const resolvedMappings: SourceNameToCanonicalIds = {
    locationPaths: { ...mappings.locationPaths },
    agencies: { ...mappings.agencies },
    personnel: { ...mappings.personnel },
    agencyPersonnel: { ...mappings.agencyPersonnel },
    licensingAuthorities: { ...(mappings.licensingAuthorities ?? {}) },
    licenses: { ...(mappings.licenses ?? {}) },
    licenseActions: { ...(mappings.licenseActions ?? {}) },
  };
  let createdMappings = false;

  for (const sourceName of artifactsEntityKeys(artifacts, "locationPaths")) {
    if (resolvedMappings.locationPaths[sourceName] === undefined) {
      resolvedMappings.locationPaths[sourceName] = {
        kind: sourceNameKinds.locationPath,
        canonicalId: createId(),
      };
      createdMappings = true;
    }
  }

  for (const sourceName of artifactsEntityKeys(artifacts, "agencies")) {
    if (resolvedMappings.agencies[sourceName] === undefined) {
      resolvedMappings.agencies[sourceName] = {
        kind: sourceNameKinds.agency,
        canonicalId: createId(),
      };
      createdMappings = true;
    }
  }

  for (const sourceName of artifactsEntityKeys(artifacts, "personnel")) {
    if (resolvedMappings.personnel[sourceName] === undefined) {
      resolvedMappings.personnel[sourceName] = {
        kind: sourceNameKinds.personnel,
        canonicalId: createId(),
      };
      createdMappings = true;
    }
  }

  for (const sourceName of artifactsEntityKeys(artifacts, "agencyPersonnel")) {
    if (resolvedMappings.agencyPersonnel[sourceName] === undefined) {
      resolvedMappings.agencyPersonnel[sourceName] = {
        kind: sourceNameKinds.agencyPersonnel,
        canonicalId: createId(),
      };
      createdMappings = true;
    }
  }

  // LicensingAuthority and LicenseAction identity is owned solely by their
  // facades' canonical-id resolvers (ADR 0016, self-contained find-or-create +
  // persist), so this stage no longer mints their ids.
  //
  // License is different: the row-based AgencyPersonnel transform (not yet
  // migrated to a facade) still resolves `agency_officer.license_id` against
  // `mappings.licenses` at transform time — before any facade runs. So License
  // ids must exist in the ledger before transform. This stage remains the License
  // minter; the LicenseFacade's canonical-id resolver find-or-creates against the
  // same ledger and simply finds the id here. When AgencyPersonnel migrates to a
  // facade FK find, this loop can be removed like the others.
  for (const sourceName of artifactsEntityKeys(artifacts, "licenses")) {
    if (resolvedMappings.licenses![sourceName] === undefined) {
      resolvedMappings.licenses![sourceName] = {
        kind: sourceNameKinds.license,
        canonicalId: createId(),
      };
      createdMappings = true;
    }
  }

  if (createdMappings) {
    await persistSourceNameToCanonicalIds(namespace, resolvedMappings, options);
  }

  return resolvedMappings;
}
