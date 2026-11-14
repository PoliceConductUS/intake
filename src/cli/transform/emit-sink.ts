import path from "node:path";
import {
  LocationPathGeometries,
  LocationPathGeometry,
  yamlResourceFileName,
} from "../../shared/io/index.js";
import type {
  ImportArtifactKind,
  LocationPathGeometryInput,
} from "../../shared/io/index.js";

const GEOMETRIES_KIND: ImportArtifactKind = "LocationPathGeometries";
const GEOMETRY_KIND = "LocationPathGeometry";
const GEOMETRIES_NAME = "geometries";

export type EmitRefItem = {
  ref: { path: string; kind: ImportArtifactKind; sha256: string };
};

export type EmitSink = {
  emit(kind: string, key: string, spec: unknown): Promise<void>;
  records(): AsyncIterable<{
    kind: ImportArtifactKind;
    key: string;
    spec: unknown;
  }>;
  flush(
    keep?: (kind: ImportArtifactKind, key: string) => boolean,
  ): Promise<EmitRefItem[]>;
};

/**
 * Creates a streaming sink for large record kinds (currently geometries).
 *
 * `emit` writes each record to its own file under a `.records` directory as
 * soon as it is called, so peak memory is bounded to one record — only a
 * small `{ ref }` pointer is retained in memory per record. `flush` writes a
 * single envelope-of-refs file and returns the `Artifacts`-ready ref item(s)
 * for the caller to splice into `spec.artifacts`.
 */
export function createEmitSink(
  workspaceDir: string,
  namespace: string,
): EmitSink {
  const geometryRefs: Record<
    string,
    { ref: { path: string; kind: typeof GEOMETRY_KIND; sha256: string } }
  > = {};

  const geometriesFileName = yamlResourceFileName(
    GEOMETRIES_NAME,
    GEOMETRIES_KIND,
  );
  // Mirrors the `.records` directory naming convention used by the generated
  // LocationPathGeometries writer; that helper isn't exported, so the
  // convention is intentionally duplicated here rather than imported.
  const recordsDirName = `${path.basename(
    geometriesFileName,
    path.extname(geometriesFileName),
  )}.records`;
  const recordsDir = path.join(workspaceDir, recordsDirName);

  let flushed = false;
  let flushResult: EmitRefItem[] | undefined;

  async function emit(kind: string, key: string, spec: unknown): Promise<void> {
    if (flushed) {
      throw new Error("emit-sink: cannot emit() after flush()");
    }
    if (kind !== GEOMETRIES_KIND) {
      throw new Error(
        `emit-sink: unsupported kind "${kind}" (only "${GEOMETRIES_KIND}" is streamed)`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(geometryRefs, key)) {
      throw new Error(`Duplicate emit key "${key}" for kind "${kind}"`);
    }
    const written = await LocationPathGeometry.write(
      recordsDir,
      LocationPathGeometry.new({
        metadata: { name: key, namespace },
        spec: spec as LocationPathGeometryInput["spec"],
      }),
    );
    geometryRefs[key] = {
      ref: {
        path: path.relative(workspaceDir, written.path),
        kind: GEOMETRY_KIND,
        sha256: written.sha256,
      },
    };
  }

  async function* records() {
    for (const [key, item] of Object.entries(geometryRefs)) {
      const record = await LocationPathGeometry.read(item.ref, {
        relativeTo: path.join(workspaceDir, geometriesFileName),
        expectedNamespace: namespace,
      });
      yield { kind: GEOMETRIES_KIND, key, spec: record.spec };
    }
  }

  async function flush(
    keep?: (kind: ImportArtifactKind, key: string) => boolean,
  ): Promise<EmitRefItem[]> {
    if (flushed) {
      // Already flushed: return the cached refs instead of re-writing the
      // envelope (and re-reading/duplicating it) on a second call.
      return flushResult ?? [];
    }
    flushed = true;
    const retained = Object.fromEntries(
      Object.entries(geometryRefs).filter(
        ([key]) => keep?.(GEOMETRIES_KIND, key) ?? true,
      ),
    );
    if (Object.keys(retained).length === 0) {
      flushResult = [];
      return flushResult;
    }
    const written = await LocationPathGeometries.write(workspaceDir, {
      metadata: { name: GEOMETRIES_NAME, namespace },
      spec: { records: retained },
    });
    flushResult = [
      {
        ref: {
          path: path.basename(written.path),
          kind: GEOMETRIES_KIND,
          sha256: written.sha256,
        },
      },
    ];
    return flushResult;
  }

  return { emit, records, flush };
}
