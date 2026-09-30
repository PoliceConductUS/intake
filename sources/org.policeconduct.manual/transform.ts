import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  SourceManifest,
  SourceTransform,
} from "../../src/cli/transform/source-transform.js";
import { readLatest } from "./chain.js";
import { describeKind } from "./entity-model.js";
import { artifactKindFor, PRODUCES } from "./kinds.js";

export const produces: readonly ImportArtifactKind[] = PRODUCES;

// A manual curation source: run alone to stage creates/updates into the database
// (e.g. a location alias that fixes a misspelled city), then re-run the group
// import that needed it. Excluded from multi-source group runs (ADR 0031).
export const standalone = true;

// Emit the latest curated records (ADR 0031) as artifacts, grouped by kind and
// keyed by each record's identity column (from the shared model). Import resolves
// FKs and identity as for any other source.
export const transform: SourceTransform = async ({
  state,
}): Promise<SourceManifest> => {
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
