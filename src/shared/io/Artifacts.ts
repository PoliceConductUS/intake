import path from "node:path";
import type { z } from "zod";
import type { ArtifactsEnvelope as ArtifactsEnvelopeResource } from "./generated/Artifacts.js";
import { Artifacts as GeneratedArtifacts } from "./generated/Artifacts.js";
import {
  Agencies,
  AgencySpec,
  read as readAgencies,
  write as writeAgencies,
} from "./generated/Agencies.js";
import {
  AgencyPersonnel,
  AgencyPersonnelSpec,
  read as readAgencyPersonnel,
  write as writeAgencyPersonnel,
} from "./generated/AgencyPersonnel.js";
import {
  LocationPathAliases,
  LocationPathAliasSpec,
  read as readLocationPathAliases,
  write as writeLocationPathAliases,
} from "./generated/LocationPathAliases.js";
import {
  LocationPathGeometries,
  LocationPathGeometrySpec,
  read as readLocationPathGeometries,
  write as writeLocationPathGeometries,
} from "./generated/LocationPathGeometries.js";
import {
  LocationPaths,
  LocationPathSpec,
  read as readLocationPaths,
  write as writeLocationPaths,
} from "./generated/LocationPaths.js";
import {
  Personnel,
  PersonnelSpec,
  read as readPersonnel,
  write as writePersonnel,
} from "./generated/Personnel.js";
import {
  compareImportArtifactKinds,
  type ImportArtifactKind,
} from "./import-types.js";
import { readYamlDocumentDigest } from "./internal/yaml-document.js";
import { firstIssuePath } from "./resource.js";

export type { ImportArtifactKind };

export type ImportArtifactEnvelope = {
  apiVersion: string;
  kind: ImportArtifactKind;
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    createdAt?: string;
    producedAt?: string;
    producer?: string;
  };
  spec: {
    warnings?: string[];
    audit?: Record<string, unknown>;
    records: Record<string, unknown>;
  };
};

export type ArtifactsArtifactReference = NonNullable<
  ArtifactsEnvelopeResource["spec"]["artifacts"]
>[number];

type InlineArtifactsArtifact = {
  kind: ImportArtifactKind;
  spec: Record<string, unknown> & {
    records: Record<string, unknown>;
  };
};

export type ArtifactsEnvelope = Omit<ArtifactsEnvelopeResource, "spec"> & {
  spec: Omit<ArtifactsEnvelopeResource["spec"], "artifacts"> & {
    artifacts: InlineArtifactsArtifact[];
  };
};

type ArtifactsReadOptions = Parameters<typeof GeneratedArtifacts.read>[1] & {
  raw?: boolean;
  includeKinds?: readonly ImportArtifactKind[];
};

type ArtifactReader = (
  filePath: string,
  options: {
    expectedKind?: ImportArtifactKind;
    expectedNamespace?: string;
    expectedSha256?: string;
  },
) => Promise<ImportArtifactEnvelope>;

type ArtifactEnvelopeType = {
  new: (input: any) => ImportArtifactEnvelope;
  write: (
    directory: string,
    envelope: any,
    options?: { externalizeRecords?: boolean; recordsDirectory?: string },
  ) => Promise<{ path: string; sha256: string }>;
};

// Kinds whose records are written one-file-per-record under a `.records`
// directory (an envelope-of-refs plus a singular record envelope per record),
// instead of a single large multi-record YAML file. LocationPaths /
// LocationPathAliases stay inline; LocationPathGeometries are streamed to their
// own `.records` directory by the run emit-sink.
const EXTERNALIZE_RECORD_KINDS = new Set<ImportArtifactKind>([
  "Agencies",
  "Personnel",
  "AgencyPersonnel",
]);

type ArtifactRecordSpec = {
  safeParse(
    value: unknown,
  ): { success: true; data: unknown } | { success: false; error: z.ZodError };
};

const artifactReaders: Record<ImportArtifactKind, ArtifactReader> = {
  Agencies: (filePath, options) =>
    readAgencies(filePath, { ...options, expectedKind: "Agencies" }),
  AgencyPersonnel: (filePath, options) =>
    readAgencyPersonnel(filePath, {
      ...options,
      expectedKind: "AgencyPersonnel",
    }),
  LocationPathAliases: (filePath, options) =>
    readLocationPathAliases(filePath, {
      ...options,
      expectedKind: "LocationPathAliases",
    }),
  LocationPathGeometries: (filePath, options) =>
    readLocationPathGeometries(filePath, {
      ...options,
      expectedKind: "LocationPathGeometries",
    }),
  LocationPaths: (filePath, options) =>
    readLocationPaths(filePath, { ...options, expectedKind: "LocationPaths" }),
  Personnel: (filePath, options) =>
    readPersonnel(filePath, { ...options, expectedKind: "Personnel" }),
};

const artifactEnvelopeTypes: Record<ImportArtifactKind, ArtifactEnvelopeType> =
  {
    Agencies: { ...Agencies, write: writeAgencies },
    AgencyPersonnel: { ...AgencyPersonnel, write: writeAgencyPersonnel },
    LocationPathAliases: {
      ...LocationPathAliases,
      write: writeLocationPathAliases,
    },
    LocationPathGeometries: {
      ...LocationPathGeometries,
      write: writeLocationPathGeometries,
    },
    LocationPaths: { ...LocationPaths, write: writeLocationPaths },
    Personnel: { ...Personnel, write: writePersonnel },
  };

const artifactRecordSpecs: Record<ImportArtifactKind, ArtifactRecordSpec> = {
  Agencies: AgencySpec,
  AgencyPersonnel: AgencyPersonnelSpec,
  LocationPathAliases: LocationPathAliasSpec,
  LocationPathGeometries: LocationPathGeometrySpec,
  LocationPaths: LocationPathSpec,
  Personnel: PersonnelSpec,
};

function sortedArtifactReferences(
  artifactsEnvelope: ArtifactsEnvelopeResource,
  includeKinds?: readonly ImportArtifactKind[],
): ArtifactsArtifactReference[] {
  const includeKindSet =
    includeKinds === undefined ? undefined : new Set(includeKinds);
  return artifactsEnvelope.spec.artifacts
    .filter((artifact) => {
      if (includeKindSet === undefined) {
        return true;
      }
      const kind = "ref" in artifact ? artifact.ref.kind : artifact.kind;
      return includeKindSet.has(kind);
    })
    .sort((left, right) =>
      compareImportArtifactKinds(
        "ref" in left ? left.ref.kind : left.kind,
        "ref" in right ? right.ref.kind : right.kind,
      ),
    );
}

async function readArtifactReference(
  artifactsPath: string,
  artifactsNamespace: string,
  reference: Extract<ArtifactsArtifactReference, { ref: { path: string } }>,
): Promise<ImportArtifactEnvelope> {
  const artifactPath = path.resolve(
    path.dirname(artifactsPath),
    reference.ref.path,
  );
  return artifactReaders[reference.ref.kind](artifactPath, {
    expectedKind: reference.ref.kind,
    expectedNamespace: artifactsNamespace,
    expectedSha256: reference.ref.sha256,
  });
}

function artifactFromInlineItem(
  artifactsEnvelope: ArtifactsEnvelopeResource,
  item: Exclude<ArtifactsArtifactReference, { ref: { path: string } }>,
): ImportArtifactEnvelope {
  const artifact = artifactEnvelopeTypes[item.kind].new({
    metadata: {
      name: artifactsEnvelope.metadata.name,
      namespace: artifactsEnvelope.metadata.namespace,
    },
    spec: item.spec,
  });
  const records: Record<string, unknown> = {};

  for (const [recordKey, recordItem] of Object.entries(artifact.spec.records)) {
    if (
      typeof recordItem === "object" &&
      recordItem !== null &&
      !Array.isArray(recordItem) &&
      "ref" in recordItem
    ) {
      throw new Error(
        `Inline Artifacts ${item.kind} record ${recordKey} cannot use ref.`,
      );
    }

    records[recordKey] = (recordItem as { spec: unknown }).spec;
    const result = artifactRecordSpecs[item.kind].safeParse(records[recordKey]);
    if (!result.success) {
      throw new Error(
        `Inline Artifacts ${item.kind} record ${recordKey} is malformed at ${firstIssuePath(result.error)}.`,
      );
    }
  }

  return {
    ...artifact,
    spec: {
      ...artifact.spec,
      records,
    },
  };
}

async function artifactFromArtifactsItem(
  artifactsPath: string,
  artifactsEnvelope: ArtifactsEnvelopeResource,
  item: ArtifactsArtifactReference,
): Promise<ImportArtifactEnvelope> {
  if ("ref" in item) {
    return readArtifactReference(
      artifactsPath,
      artifactsEnvelope.metadata.namespace,
      item,
    );
  }

  return artifactFromInlineItem(artifactsEnvelope, item);
}

async function resolveArtifactsReferences(
  artifactsPath: string,
  artifactsEnvelope: ArtifactsEnvelopeResource,
  options: { includeKinds?: readonly ImportArtifactKind[] } = {},
): Promise<ArtifactsEnvelope> {
  const artifacts: ImportArtifactEnvelope[] = [];
  for (const artifactReference of sortedArtifactReferences(
    artifactsEnvelope,
    options.includeKinds,
  )) {
    artifacts.push(
      await artifactFromArtifactsItem(
        artifactsPath,
        artifactsEnvelope,
        artifactReference,
      ),
    );
  }

  return {
    ...artifactsEnvelope,
    spec: {
      ...artifactsEnvelope.spec,
      artifacts: artifacts.map((artifact) => ({
        kind: artifact.kind,
        spec: artifact.spec,
      })),
    },
  };
}

async function readArtifactsEnvelope(
  filePath: string,
  options: ArtifactsReadOptions & { raw: true },
): Promise<ArtifactsEnvelopeResource>;
async function readArtifactsEnvelope(
  filePath: string,
  options?: ArtifactsReadOptions & { raw?: false },
): Promise<ArtifactsEnvelope>;
async function readArtifactsEnvelope(
  filePath: string,
  options: ArtifactsReadOptions = {},
): Promise<ArtifactsEnvelopeResource | ArtifactsEnvelope> {
  const artifactsEnvelope = await GeneratedArtifacts.read(filePath, options);
  if (options.raw === true) {
    return artifactsEnvelope;
  }
  return resolveArtifactsReferences(filePath, artifactsEnvelope, {
    includeKinds: options.includeKinds,
  });
}

export const Artifacts = {
  ...GeneratedArtifacts,
  read: readArtifactsEnvelope,
  digest(filePath: string): Promise<string> {
    return readYamlDocumentDigest(filePath, "Artifacts");
  },
  async write(
    directory: string,
    envelope: ArtifactsEnvelopeResource,
  ): Promise<{ path: string }> {
    const artifactReferences = [];

    for (const artifactItem of envelope.spec.artifacts) {
      if ("ref" in artifactItem) {
        artifactReferences.push(artifactItem);
        continue;
      }

      const artifact = artifactEnvelopeTypes[artifactItem.kind].new({
        metadata: {
          name: envelope.metadata.name,
          namespace: envelope.metadata.namespace,
        },
        spec: artifactItem.spec,
      });
      const written = await artifactEnvelopeTypes[artifactItem.kind].write(
        directory,
        artifact,
        EXTERNALIZE_RECORD_KINDS.has(artifactItem.kind)
          ? { externalizeRecords: true }
          : undefined,
      );
      artifactReferences.push({
        ref: {
          path: path.basename(written.path),
          kind: artifactItem.kind,
          sha256: written.sha256,
        },
      });
    }

    return GeneratedArtifacts.write(directory, {
      ...envelope,
      spec: {
        ...envelope.spec,
        artifacts: artifactReferences,
      },
    });
  },
};
