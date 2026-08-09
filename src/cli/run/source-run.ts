import { Artifacts } from "../../shared/io/index.js";
import type {
  ArtifactsEnvelope,
  ImportArtifactKind,
} from "../../shared/io/index.js";

export type EmittedRecords = Record<string, { spec: unknown }>;
export type SourceManifest = {
  artifacts: Array<{ kind: ImportArtifactKind; records: EmittedRecords }>;
};
export type RunDeps = {
  paths: string[];
  readXlsx: (filePath: string) => Promise<Array<Record<string, string>>>;
};
export type SourceRun = (deps: RunDeps) => Promise<SourceManifest>;

export function buildArtifactsEnvelope(
  sourceId: string,
  digest: string,
  manifest: SourceManifest,
): ArtifactsEnvelope {
  return Artifacts.new({
    metadata: { name: `${sourceId}-${digest}`, namespace: sourceId },
    spec: {
      artifacts: manifest.artifacts.map((artifact) => ({
        kind: artifact.kind,
        spec: { records: artifact.records },
      })),
    },
  }) as ArtifactsEnvelope;
}
