import path from "node:path";
import { z } from "zod";
import type { ArtifactsEnvelope as ArtifactsEnvelopeResource } from "./generated/Artifacts.js";
import { Artifacts as GeneratedArtifacts } from "./generated/Artifacts.js";
import { ARTIFACT_MODULES } from "./generated/artifact-modules.js";
import {
  IMPORT_ARTIFACT_KINDS,
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
  /**
   * Absolute path of the file each record was read from, keyed by record key —
   * the per-record `.records/*.yaml` file, or the Artifacts file itself for
   * inline records. Attached at read time so a record's origin can travel with
   * the envelope and be cited in error messages. Absent when unresolved.
   */
  recordSources?: Record<string, string>;
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
  read: (filePath: string, options: Record<string, unknown>) => Promise<any>;
  write: (
    directory: string,
    envelope: any,
    options?: { externalizeRecords?: boolean; recordsDirectory?: string },
  ) => Promise<{ path: string; sha256: string }>;
};

// Maximum records per artifact collection file. A kind's records are written as
// one inline collection, split into chunk files of this size so no single file
// grows unbounded (ADR 0002/0009). LocationPathGeometries are the exception —
// streamed to their own `.records` directory by the run emit-sink because a
// single geometry can be large on its own.
const ARTIFACT_RECORDS_PER_FILE = 10_000;

type ArtifactRecordSpec = {
  safeParse(
    value: unknown,
  ): { success: true; data: unknown } | { success: false; error: z.ZodError };
};

// All three maps are derived by looping over the generated ARTIFACT_MODULES, so
// no kind is enumerated by hand. A uniform view makes the heterogeneous per-kind
// read/write callable.
type RegisteredModule = {
  envelope: ArtifactEnvelopeType;
  recordSpec: ArtifactRecordSpec;
  read: (
    filePath: string,
    options: Parameters<ArtifactReader>[1],
  ) => Promise<ImportArtifactEnvelope>;
  write: ArtifactEnvelopeType["write"];
};
const MODULES = ARTIFACT_MODULES as unknown as Record<
  ImportArtifactKind,
  RegisteredModule
>;

const artifactReaders = Object.fromEntries(
  IMPORT_ARTIFACT_KINDS.map((kind) => [
    kind,
    (filePath: string, options: Parameters<ArtifactReader>[1]) =>
      MODULES[kind].read(filePath, { ...options, expectedKind: kind }),
  ]),
) as Record<ImportArtifactKind, ArtifactReader>;

const artifactEnvelopeTypes = Object.fromEntries(
  IMPORT_ARTIFACT_KINDS.map((kind) => [
    kind,
    { ...MODULES[kind].envelope, write: MODULES[kind].write },
  ]),
) as Record<ImportArtifactKind, ArtifactEnvelopeType>;

const artifactRecordSpecs = Object.fromEntries(
  IMPORT_ARTIFACT_KINDS.map((kind) => [kind, MODULES[kind].recordSpec]),
) as Record<ImportArtifactKind, ArtifactRecordSpec>;

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

    // A record is an envelope (ADR 0034): keep its metadata (action/selector) with
    // it, and validate the spec against the full entity spec for PUT/POST or a
    // partial for PATCH (a partial update sets only some fields).
    const envelope = recordItem as {
      metadata?: { action?: "PUT" | "PATCH" | "POST"; selector?: unknown };
      spec: unknown;
    };
    const specSchema = artifactRecordSpecs[item.kind];
    const schema =
      envelope.metadata?.action === "PATCH" && specSchema instanceof z.ZodObject
        ? specSchema.partial()
        : specSchema;
    const result = schema.safeParse(envelope.spec);
    if (!result.success) {
      throw new Error(
        `Inline Artifacts ${item.kind} record ${recordKey} is malformed at ${firstIssuePath(result.error)}.`,
      );
    }
    records[recordKey] = {
      metadata: {
        name: recordKey,
        ...(envelope.metadata?.action !== undefined
          ? { action: envelope.metadata.action }
          : {}),
        ...(envelope.metadata?.selector !== undefined
          ? { selector: envelope.metadata.selector }
          : {}),
      },
      spec: envelope.spec,
    };
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

async function artifactRecordSources(
  artifactsPath: string,
  artifactsNamespace: string,
  item: ArtifactsArtifactReference,
): Promise<Record<string, string>> {
  // Inline records have no per-record file — they live in the Artifacts file.
  if (!("ref" in item)) {
    const artifactsAbsolute = path.resolve(artifactsPath);
    const inlineRecords = (item.spec as { records?: Record<string, unknown> })
      .records;
    const inlineSources: Record<string, string> = {};
    for (const recordKey of Object.keys(inlineRecords ?? {})) {
      inlineSources[recordKey] = artifactsAbsolute;
    }
    return inlineSources;
  }

  const artifactPath = path.resolve(path.dirname(artifactsPath), item.ref.path);
  const rawArtifact = (await artifactEnvelopeTypes[item.ref.kind].read(
    artifactPath,
    {
      raw: true,
      expectedKind: item.ref.kind,
      expectedNamespace: artifactsNamespace,
      expectedSha256: item.ref.sha256,
    },
  )) as { spec: { records: Record<string, unknown> } };
  const artifactDirectory = path.dirname(artifactPath);
  const sources: Record<string, string> = {};
  for (const [recordKey, recordItem] of Object.entries(
    rawArtifact.spec.records,
  )) {
    const recordRefPath =
      typeof recordItem === "object" &&
      recordItem !== null &&
      "ref" in recordItem &&
      typeof (recordItem as { ref?: { path?: unknown } }).ref?.path === "string"
        ? (recordItem as { ref: { path: string } }).ref.path
        : undefined;
    // Externalized record → its own file; inline-in-artifact record → the
    // artifact file that holds it.
    sources[recordKey] =
      recordRefPath === undefined
        ? artifactPath
        : path.resolve(artifactDirectory, recordRefPath);
  }
  return sources;
}

async function resolveArtifactsReferences(
  artifactsPath: string,
  artifactsEnvelope: ArtifactsEnvelopeResource,
  options: { includeKinds?: readonly ImportArtifactKind[] } = {},
): Promise<ArtifactsEnvelope> {
  const artifacts: InlineArtifactsArtifact[] = [];
  for (const artifactReference of sortedArtifactReferences(
    artifactsEnvelope,
    options.includeKinds,
  )) {
    const artifact = await artifactFromArtifactsItem(
      artifactsPath,
      artifactsEnvelope,
      artifactReference,
    );
    artifacts.push({
      kind: artifact.kind,
      spec: artifact.spec,
      recordSources: await artifactRecordSources(
        artifactsPath,
        artifactsEnvelope.metadata.namespace,
        artifactReference,
      ),
    });
  }

  return {
    ...artifactsEnvelope,
    spec: {
      ...artifactsEnvelope.spec,
      artifacts,
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

    // Each artifact kind is written as a collection (records inline), split into
    // chunk files of at most ARTIFACT_RECORDS_PER_FILE records so no single file
    // grows unbounded. All chunks of a kind are listed as refs; the read side
    // merges same-kind refs, so chunking is transparent to consumers. (Records
    // are NOT one-file-per-row — that rule is for the ledger, not artifacts.)
    for (const artifactItem of envelope.spec.artifacts) {
      if ("ref" in artifactItem) {
        artifactReferences.push(artifactItem);
        continue;
      }

      const recordEntries = Object.entries(
        artifactItem.spec.records as Record<string, unknown>,
      );
      const chunkCount = Math.max(
        1,
        Math.ceil(recordEntries.length / ARTIFACT_RECORDS_PER_FILE),
      );
      for (let index = 0; index < chunkCount; index += 1) {
        const chunkRecords = Object.fromEntries(
          recordEntries.slice(
            index * ARTIFACT_RECORDS_PER_FILE,
            (index + 1) * ARTIFACT_RECORDS_PER_FILE,
          ),
        );
        const artifact = artifactEnvelopeTypes[artifactItem.kind].new({
          metadata: {
            name:
              chunkCount === 1
                ? envelope.metadata.name
                : `${envelope.metadata.name}-${index}`,
            namespace: envelope.metadata.namespace,
          },
          spec:
            index === 0
              ? { ...artifactItem.spec, records: chunkRecords }
              : { records: chunkRecords },
        });
        const written = await artifactEnvelopeTypes[artifactItem.kind].write(
          directory,
          artifact,
        );
        artifactReferences.push({
          ref: {
            path: path.basename(written.path),
            kind: artifactItem.kind,
            sha256: written.sha256,
          },
        });
      }
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
