import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  SourceManifest,
  SourceRun,
} from "../../src/cli/run/source-run.js";
import { readLatestAliases } from "./aliases.js";

export const produces: readonly ImportArtifactKind[] = ["LocationPathAliases"];

// Turn the latest curated-alias output (ADR 0031) into LocationPathAlias records.
// location_path_id carries the canonical path; import resolves it to a real
// location_path (resolve-or-fail). alias_path is the record's natural key.
export const run: SourceRun = async ({ state }): Promise<SourceManifest> => {
  const output = await readLatestAliases(state);
  const records: EmittedRecords = {};
  for (const entry of output.aliases) {
    records[entry.alias_path] = {
      spec: {
        alias_path: entry.alias_path,
        location_path_id: entry.location_path_id,
      },
    };
  }
  return { artifacts: [{ kind: "LocationPathAliases", records }] };
};
