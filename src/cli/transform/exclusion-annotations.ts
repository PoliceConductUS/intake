import { SourceExclusions } from "../../shared/data-annotations.js";
import type {
  ExcludedRecord,
  ExcludedRecords,
} from "../../shared/io/excluded-records.js";
import type { SourceManifest } from "./source-transform.js";

/** Keep the explicit decision even though its subject is removed from the corpus. */
export function attachExclusionEvidence(
  manifest: SourceManifest,
  excluded: ExcludedRecords,
  namespace: string,
): SourceManifest {
  const authorities = manifest.artifacts
    .flatMap((artifact) =>
      artifact.kind === "LicensingAuthorities"
        ? Object.values(artifact.records)
        : [],
    )
    .map((record) => {
      const spec = record.spec as Record<string, unknown>;
      const assigned = SourceExclusions.parse(spec.source_exclusions ?? {});
      return {
        record,
        mapped:
          Array.isArray(spec.source_namespaces) &&
          spec.source_namespaces.includes(namespace),
        assigned,
        incoming: [] as ExcludedRecord[],
      };
    });
  const mapped = authorities.filter((authority) => authority.mapped);
  if (mapped.length > 1)
    throw new Error(
      `Exclusion evidence for ${namespace} requires exactly one explicitly mapped licensing authority.`,
    );
  for (const exclusion of excluded.values()) {
    const owners = authorities.filter(
      (authority) =>
        authority.mapped ||
        authority.assigned[namespace]?.some(
          (entry) =>
            entry.kind === exclusion.kind && entry.key === exclusion.key,
        ),
    );
    if (owners.length !== 1)
      throw new Error(
        `Exclusion evidence for ${namespace} requires exactly one explicitly mapped licensing authority for ${exclusion.kind}:${exclusion.key}.`,
      );
    owners[0].incoming.push(exclusion);
  }
  const replacements = new Map(
    authorities
      .filter(
        (authority) =>
          authority.mapped || Object.hasOwn(authority.assigned, namespace),
      )
      .map((authority) => [
        authority.record,
        {
          ...authority.record,
          spec: {
            ...(authority.record.spec as Record<string, unknown>),
            source_exclusions: SourceExclusions.parse({
              [namespace]: authority.incoming,
            }),
          },
        },
      ]),
  );
  return {
    ...manifest,
    artifacts: manifest.artifacts.map((artifact) => ({
      ...artifact,
      records: Object.fromEntries(
        Object.entries(artifact.records).map(([key, record]) => [
          key,
          replacements.get(record) ?? record,
        ]),
      ),
    })),
  };
}
