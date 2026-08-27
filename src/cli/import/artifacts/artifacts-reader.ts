import { Artifacts } from "../../../shared/io/index.js";
import type {
  ArtifactsEnvelope,
  ImportArtifactKind,
} from "../../../shared/io/index.js";
import {
  applyOptionalArtifactMutation,
  type ApplyArtifactMutationResult,
} from "./artifact-mutation.js";
import { applyCorrections } from "./data-corrections.js";

/**
 * The import-phase Artifacts reader delegate. Reading is what applies the phase's
 * mutations, so no call site has to remember: it reads the envelope, applies the
 * pre-run corrections (systematic feed fixes), then the ADR 0012 command-local
 * mutations (manual, applied last so they win), and returns the mutated envelope
 * plus the ADR 0012 audit result.
 */
export async function readImportArtifacts(
  artifactsPath: string,
  options: { includeKinds?: readonly ImportArtifactKind[] } = {},
): Promise<{
  artifacts: ArtifactsEnvelope;
  artifactMutation: ApplyArtifactMutationResult;
}> {
  const artifacts = await Artifacts.read(artifactsPath, options);
  applyCorrections(artifacts);
  const artifactMutation = await applyOptionalArtifactMutation(artifacts, {
    artifactsPath,
  });
  return { artifacts, artifactMutation };
}
