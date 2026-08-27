import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  SourceManifest,
  SourceRun,
} from "../../src/cli/run/source-run.js";

// Scaffold (ADR 0030). Not yet active: emitting a report needs the Review /
// ReviewPersonnel entity kinds and the resolveAgency / resolveLocationPath run
// resolvers, none of which exist yet. Until then this source produces nothing.
// When wired: traverse only verified reportNew submissions, resolve
// officer@agency / location / civil case (resolve-or-fail), apply the cached AI
// verdict as a high publication bar, emit Review/ReviewPersonnel for the ones
// that clear it, and write every other submission to the review-report file.
export const produces: readonly ImportArtifactKind[] = [];

export const run: SourceRun = async (): Promise<SourceManifest> => {
  return { artifacts: [] };
};
