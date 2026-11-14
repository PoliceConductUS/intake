import { isDeepStrictEqual } from "node:util";
import { FK_REFERENCES } from "../../shared/io/generated/entity-specs.js";
import { importTypeMetadata } from "../../shared/io/import-type-metadata.js";
import type { ExcludedRecords } from "../../shared/io/index.js";
import type { SourceManifest } from "./source-transform.js";

export function selectActiveExcludedRecords(
  manifest: SourceManifest,
  excludedRecords: ExcludedRecords,
): ExcludedRecords {
  return new Map(
    [...excludedRecords].filter(([, exclusion]) => {
      const when = exclusion.when;
      if (when === undefined) return true;
      return manifest.artifacts.some((artifact) => {
        if (
          importTypeMetadata[artifact.kind].recordKind !== exclusion.kind ||
          !Object.hasOwn(artifact.records, exclusion.key)
        )
          return false;
        const spec = artifact.records[exclusion.key].spec;
        return (
          typeof spec === "object" &&
          spec !== null &&
          Object.entries(when).every(
            ([field, value]) =>
              Object.hasOwn(spec, field) &&
              isDeepStrictEqual(
                (spec as Record<string, unknown>)[field],
                value,
              ),
          )
        );
      });
    }),
  );
}

export function cascadeExcludedRecord(
  artifactKind: SourceManifest["artifacts"][number]["kind"],
  key: string,
  spec: unknown,
  removed: Map<string, Set<string>>,
): boolean {
  const recordKind = importTypeMetadata[artifactKind].recordKind;
  if (removed.get(recordKind)?.has(key)) return false;
  const values = spec as Record<string, unknown> | undefined;
  if (
    !(FK_REFERENCES[recordKind] ?? []).some(({ field, targetKind }) => {
      const value = values?.[field];
      return typeof value === "string" && removed.get(targetKind)?.has(value);
    })
  )
    return false;
  const keys = removed.get(recordKind) ?? new Set<string>();
  keys.add(key);
  removed.set(recordKind, keys);
  return true;
}

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
): {
  manifest: SourceManifest;
  removed: Record<string, number>;
  removedKeys: Map<string, Set<string>>;
} {
  const removed = new Map<string, Set<string>>();
  for (const record of excludedRecords.values()) {
    const keys = removed.get(record.kind) ?? new Set<string>();
    keys.add(record.key);
    removed.set(record.kind, keys);
  }

  // Cascade to a fixpoint: removing a record can orphan records that reference it.
  let changed = true;
  while (changed) {
    changed = false;
    for (const artifact of manifest.artifacts) {
      for (const [key, record] of Object.entries(artifact.records)) {
        if (cascadeExcludedRecord(artifact.kind, key, record.spec, removed))
          changed = true;
      }
    }
  }

  return { ...filterManifestRecords(manifest, removed), removedKeys: removed };
}

export function filterManifestRecords(
  manifest: SourceManifest,
  removed: ReadonlyMap<string, ReadonlySet<string>>,
): { manifest: SourceManifest; removed: Record<string, number> } {
  const removedCounts: Record<string, number> = {};
  const artifacts = manifest.artifacts.map((artifact) => {
    const recordKind = importTypeMetadata[artifact.kind].recordKind;
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

  return { manifest: { ...manifest, artifacts }, removed: removedCounts };
}
