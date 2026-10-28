import { SourceExclusions } from "../../shared/data-annotations.js";
import type { ExcludedRecords } from "../../shared/io/excluded-records.js";
import type { SourceManifest } from "./source-transform.js";

/** Keep the explicit decision even though its subject is removed from the corpus. */
export function attachExclusionEvidence(
  manifest: SourceManifest,
  excluded: ExcludedRecords,
  namespace: string,
): SourceManifest {
  const owners = manifest.artifacts
    .flatMap((artifact) =>
      artifact.kind === "LicensingAuthorities"
        ? Object.values(artifact.records)
        : [],
    )
    .filter((record) => {
      const spec = record.spec as Record<string, unknown>;
      return (
        Array.isArray(spec.source_namespaces) &&
        spec.source_namespaces.includes(namespace)
      );
    });
  if (owners.length !== 1) {
    if (excluded.size === 0 && owners.length === 0) return manifest;
    throw new Error(
      `Exclusion evidence for ${namespace} requires exactly one explicitly mapped licensing authority.`,
    );
  }
  const owner = owners[0];
  const exclusions = SourceExclusions.parse({
    [namespace]: [...excluded.values()],
  });
  return {
    ...manifest,
    artifacts: manifest.artifacts.map((artifact) => ({
      ...artifact,
      records: Object.fromEntries(
        Object.entries(artifact.records).map(([key, record]) => [
          key,
          record === owner
            ? {
                ...record,
                spec: {
                  ...(record.spec as Record<string, unknown>),
                  source_exclusions: exclusions,
                },
              }
            : record,
        ]),
      ),
    })),
  };
}
