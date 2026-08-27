import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  SourceManifest,
  SourceRun,
} from "../../src/cli/run/source-run.js";
import { readLatest } from "./chain.js";
import { describeKind } from "./entity-model.js";
import { artifactKindFor, PRODUCES } from "./kinds.js";

export const produces: readonly ImportArtifactKind[] = PRODUCES;

// Emit the latest curated records (ADR 0031) as artifacts, grouped by kind and
// keyed by each record's identity column (from the shared model). Import resolves
// FKs and identity as for any other source.
export const run: SourceRun = async ({ state }): Promise<SourceManifest> => {
  const output = await readLatest(state);
  const byArtifactKind = new Map<ImportArtifactKind, EmittedRecords>();
  for (const entry of output.entries) {
    const artifactKind = artifactKindFor(entry.kind);
    const identity = describeKind(entry.kind).identity;
    const key = String(entry.record[identity] ?? JSON.stringify(entry.record));
    const records = byArtifactKind.get(artifactKind) ?? {};
    records[key] = { spec: entry.record };
    byArtifactKind.set(artifactKind, records);
  }
  return {
    artifacts: [...byArtifactKind.entries()].map(([kind, records]) => ({
      kind,
      records,
    })),
  };
};
