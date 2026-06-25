import { stat } from "node:fs/promises";
import path from "node:path";
import {
  type ArtifactMutationOperation,
  type ArtifactMutationSpec,
} from "./io/ArtifactMutation.js";
import {
  ArtifactMutations,
  type ArtifactMutationsEnvelope,
} from "./io/ArtifactMutations.js";
import type {
  ArtifactsEnvelope,
  ImportArtifactKind,
} from "../../../shared/io/index.js";
import { yamlResourceFileName } from "../../../shared/io/resource.js";

export type ArtifactMutationReference = {
  path: string;
  digest: string;
};

export type ApplyArtifactMutationResult =
  | { applied: false }
  | { applied: true; reference: ArtifactMutationReference };

type ArtifactMutationItem = ArtifactMutationSpec;
type ArtifactMutationEntityName = "agencies" | "personnel" | "agencyPersonnel";
type ArtifactMutationTargetKind = ArtifactMutationItem["target"]["kind"];

function mutationFilePath(
  artifacts: ArtifactsEnvelope,
  artifactsPath: string | undefined,
): string | undefined {
  if (artifactsPath === undefined || artifactsPath.trim().length === 0) {
    return undefined;
  }

  return path.join(
    path.dirname(artifactsPath),
    yamlResourceFileName(artifacts.metadata.name, "ArtifactMutations"),
  );
}

function targetEntityName(
  kind: ArtifactMutationTargetKind,
): ArtifactMutationEntityName {
  if (kind === "Agency") {
    return "agencies";
  }
  if (kind === "Personnel") {
    return "personnel";
  }
  return "agencyPersonnel";
}

function entityRecordForMutation(
  artifacts: ArtifactsEnvelope,
  entityName: ArtifactMutationEntityName,
  sourceName: string,
): Record<string, unknown> {
  const kindByEntityName = {
    agencies: "Agencies",
    personnel: "Personnel",
    agencyPersonnel: "AgencyPersonnel",
  } satisfies Record<ArtifactMutationEntityName, ImportArtifactKind>;
  const records = Object.assign(
    {},
    ...artifacts.spec.artifacts
      .filter((artifact) => artifact.kind === kindByEntityName[entityName])
      .map((artifact) => artifact.spec.records),
  ) as Record<string, unknown>;
  const entityRecord = records[sourceName];

  if (
    typeof entityRecord !== "object" ||
    entityRecord === null ||
    Array.isArray(entityRecord)
  ) {
    throw new Error(
      `Artifact mutation references missing ${entityName} source name ${sourceName}.`,
    );
  }

  return entityRecord as Record<string, unknown>;
}

function applyMutation(
  artifacts: ArtifactsEnvelope,
  entityName: ArtifactMutationEntityName,
  sourceName: string,
  mutation: ArtifactMutationOperation,
): void {
  const entityRecord = entityRecordForMutation(
    artifacts,
    entityName,
    sourceName,
  );
  const pathParts = mutation.path.split(".");
  let target = entityRecord;
  for (const pathPart of pathParts.slice(0, -1)) {
    const currentValue = target[pathPart];
    if (
      typeof currentValue !== "object" ||
      currentValue === null ||
      Array.isArray(currentValue)
    ) {
      target[pathPart] = {};
    }
    target = target[pathPart] as Record<string, unknown>;
  }
  target[pathParts[pathParts.length - 1]!] = mutation.value;
}

function applyMutationOperations(
  artifacts: ArtifactsEnvelope,
  mutationItem: ArtifactMutationItem,
): void {
  const entityName = targetEntityName(mutationItem.target.kind);
  for (const operation of mutationItem.operations) {
    applyMutation(artifacts, entityName, mutationItem.target.name, operation);
  }
}

async function readArtifactMutationFile(mutationPath: string): Promise<{
  mutation: Omit<ArtifactMutationsEnvelope, "spec"> & {
    spec: { mutations: ArtifactMutationItem[] };
  };
  reference: ArtifactMutationReference;
}> {
  const mutation = await ArtifactMutations.read(mutationPath);

  return {
    mutation,
    reference: {
      path: mutationPath,
      digest: await ArtifactMutations.digest(mutationPath),
    },
  };
}

export async function applyOptionalArtifactMutation(
  artifacts: ArtifactsEnvelope,
  options: { artifactsPath?: string } = {},
): Promise<ApplyArtifactMutationResult> {
  const mutationPath = mutationFilePath(artifacts, options.artifactsPath);
  if (mutationPath === undefined) {
    return { applied: false };
  }

  try {
    const mutationStat = await stat(mutationPath);
    if (!mutationStat.isFile()) {
      throw new Error(`Artifact mutation path is not a file: ${mutationPath}`);
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "ENOENT") {
      return { applied: false };
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Artifact mutation is not readable: ${mutationPath}`);
  }

  const namespace = artifacts.metadata.namespace;
  const { mutation, reference } = await readArtifactMutationFile(mutationPath);
  if (mutation.metadata.namespace !== "manual") {
    throw new Error(
      `Artifact mutation namespace ${mutation.metadata.namespace} does not match manual namespace.`,
    );
  }
  if (mutation.metadata.name !== artifacts.metadata.name) {
    throw new Error(
      `Artifact mutation metadata.name ${mutation.metadata.name} does not match Artifacts metadata.name ${artifacts.metadata.name}.`,
    );
  }
  for (const mutationItem of mutation.spec.mutations) {
    if (
      mutationItem.target.namespace !== namespace ||
      mutationItem.target.command.name !== artifacts.metadata.name
    ) {
      throw new Error(
        `Artifact mutation target ${mutationItem.target.namespace}/${mutationItem.target.command.name} does not match Artifacts identity ${namespace}/${artifacts.metadata.name}.`,
      );
    }

    applyMutationOperations(artifacts, mutationItem);
  }

  return {
    applied: true,
    reference,
  };
}
