import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { createId } from "@paralleldrive/cuid2";
import { SourceNameToCanonicalId } from "./SourceNameToCanonicalId.js";
import { yamlResourceFileName } from "../../../shared/io/resource.js";

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
  discipline: "Discipline",
  disciplineAgencyOfficer: "DisciplineAgencyOfficer",
  coverageLink: "CoverageLink",
  coverageLinkAgencyOfficer: "CoverageLinkAgencyOfficer",
} as const;

/**
 * The entity kinds the ledger tracks. Each kind is also its per-record
 * subdirectory name under the namespace's ledger directory.
 */
export type LedgerEntityKind =
  (typeof sourceNameKinds)[keyof typeof sourceNameKinds];

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

  return path.join(rootDir, "state", "intake", "namespaces", namespace);
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

async function mappingRecordExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error(
        `SourceNameToCanonicalId path is not a file: ${filePath}`,
      );
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * A stateless accessor over the durable `SourceNameToCanonicalId` ledger (the
 * Identity Map's durable half — ADR 0017). Every lookup derives the single
 * record's file path from the in-memory `(namespace, kind, sourceName)` and reads
 * that one file — there is NO bulk directory scan and NO in-memory cache. A prior
 * design bulk-loaded every ledger file up front (`readdir` + parse of hundreds of
 * thousands of files); that is deliberately gone and must never return.
 *
 * `namespace` is per call, not per accessor: a record's identity lives under its
 * own source namespace (`state/<namespace>/`), which is not
 * necessarily the running command's namespace — e.g. a `gov.tx.tcole` agency
 * resolves a `LocationPath` id owned by the census namespace (ADR 0015).
 */
export type SourceNameToCanonicalIdLedger = {
  /** The canonical id for a source key, or `undefined` if none is recorded yet. */
  read(
    namespace: string,
    kind: LedgerEntityKind,
    sourceName: string,
  ): Promise<string | undefined>;
  /**
   * The canonical id for a source key: the recorded id if present, otherwise a
   * freshly minted `cuid2` that is durably written to its own record file before
   * returning (find-or-create — "get-or-materialize in the Identity Map").
   */
  findOrCreate(
    namespace: string,
    kind: LedgerEntityKind,
    sourceName: string,
  ): Promise<string>;
};

export function createSourceNameToCanonicalIdLedger(
  options: MappingPathOptions = {},
): SourceNameToCanonicalIdLedger {
  async function read(
    namespace: string,
    kind: LedgerEntityKind,
    sourceName: string,
  ): Promise<string | undefined> {
    const filePath = mappingRecordPath(
      resolveSourceNameToCanonicalIdPath(namespace, options),
      kind,
      sourceName,
    );
    if (!(await mappingRecordExists(filePath))) {
      return undefined;
    }
    const envelope = await SourceNameToCanonicalId.read(filePath, {
      expectedNamespace: namespace,
    });
    if (envelope.spec.kind !== kind) {
      throw new Error(
        `SourceNameToCanonicalId kind ${envelope.spec.kind} does not match expected kind ${kind}: ${filePath}`,
      );
    }
    return envelope.spec.canonicalId;
  }

  async function findOrCreate(
    namespace: string,
    kind: LedgerEntityKind,
    sourceName: string,
  ): Promise<string> {
    const existing = await read(namespace, kind, sourceName);
    if (existing !== undefined) {
      return existing;
    }

    const canonicalId = createId();
    await SourceNameToCanonicalId.write(
      path.join(resolveSourceNameToCanonicalIdPath(namespace, options), kind),
      SourceNameToCanonicalId.new({
        metadata: { name: sourceName, namespace },
        spec: { kind, canonicalId },
      }),
    );
    return canonicalId;
  }

  return { read, findOrCreate };
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
