import { Artifacts } from "../../../shared/io/index.js";
import type {
  ArtifactsEnvelope,
  ImportArtifactKind,
} from "../../../shared/io/index.js";
import {
  applyOptionalArtifactMutation,
  type ApplyArtifactMutationResult,
} from "./artifact-mutation.js";

/** Reads source artifacts and applies explicit ADR 0012 operator mutations. */
export async function readImportArtifacts(
  artifactsPath: string,
  options: { includeKinds?: readonly ImportArtifactKind[] } = {},
): Promise<{
  artifacts: ArtifactsEnvelope;
  artifactMutation: ApplyArtifactMutationResult;
}> {
  const artifacts = await Artifacts.read(artifactsPath, options);
  const artifactMutation = await applyOptionalArtifactMutation(artifacts, {
    artifactsPath,
  });
  return { artifacts, artifactMutation };
}
