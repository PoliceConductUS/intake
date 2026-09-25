import { FK_REFERENCES } from "../../shared/io/generated/entity-specs.js";
import { importTypeMetadata } from "../../shared/io/import-type-metadata.js";
import type { ExcludedRecords } from "../../shared/io/index.js";
import type { SourceManifest } from "./source-transform.js";

/**
 * Removes a source's `excluded.yaml` records from the manifest BEFORE the
 * Artifacts envelope is written, so an excluded record never enters the
 * Artifacts (and any consumer of that Artifacts is clean). Removal cascades over
 * the introspected foreign-key graph (`FK_REFERENCES`): a record whose FK field
 * holds an excluded record's key is itself removed, to a fixpoint — e.g.
 * excluding an Agency also drops the AgencyPersonnel assigned to it. Returns the
 * filtered manifest and the removed counts per record kind for logging.
 */
export function excludeManifestRecords(
  manifest: SourceManifest,
  excludedRecords: ExcludedRecords,
): { manifest: SourceManifest; removed: Record<string, number> } {
  const removed = new Map<string, Set<string>>();
  const markRemoved = (recordKind: string, key: string): boolean => {
    let keys = removed.get(recordKind);
    if (keys === undefined) {
      keys = new Set<string>();
      removed.set(recordKind, keys);
    }
    if (keys.has(key)) {
      return false;
    }
    keys.add(key);
    return true;
  };

  for (const record of excludedRecords.values()) {
    markRemoved(record.kind, record.key);
  }

  const recordKindOf = (artifactKind: string): string =>
    importTypeMetadata[artifactKind as keyof typeof importTypeMetadata]
      ?.recordKind ?? artifactKind;

  // Cascade to a fixpoint: removing a record can orphan records that reference it.
  let changed = true;
  while (changed) {
    changed = false;
    for (const artifact of manifest.artifacts) {
      const recordKind = recordKindOf(artifact.kind);
      const references = FK_REFERENCES[recordKind] ?? [];
      if (references.length === 0) {
        continue;
      }
      for (const [key, record] of Object.entries(artifact.records)) {
        if (removed.get(recordKind)?.has(key)) {
          continue;
        }
        const spec = record.spec as Record<string, unknown> | undefined;
        for (const { field, targetKind } of references) {
          const value = spec?.[field];
          if (
            typeof value === "string" &&
            removed.get(targetKind)?.has(value)
          ) {
            if (markRemoved(recordKind, key)) {
              changed = true;
            }
            break;
          }
        }
      }
    }
  }

  const removedCounts: Record<string, number> = {};
  const artifacts = manifest.artifacts.map((artifact) => {
    const recordKind = recordKindOf(artifact.kind);
    const removedKeys = removed.get(recordKind);
    if (removedKeys === undefined || removedKeys.size === 0) {
      return artifact;
    }
    const records: SourceManifest["artifacts"][number]["records"] = {};
    for (const [key, record] of Object.entries(artifact.records)) {
      if (removedKeys.has(key)) {
        removedCounts[recordKind] = (removedCounts[recordKind] ?? 0) + 1;
      } else {
        records[key] = record;
      }
    }
    return { ...artifact, records };
  });

  return { manifest: { artifacts }, removed: removedCounts };
}
