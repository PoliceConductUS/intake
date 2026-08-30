import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Artifacts, loadExcludedRecords } from "../../shared/io/index.js";
import type { ExcludedRecords } from "../../shared/io/index.js";
import { createCommandDirectory } from "../command-directory.js";
import type { CommandResult } from "../../shared/cli/types.js";
import { buildArtifactsEnvelope } from "./source-transform.js";
import type { SourceManifest } from "./source-transform.js";
import { loadSourceModule, loadSourceProduces } from "./load-source-module.js";
import { defaultDatabaseClientFactory } from "../database/index.js";
import { createSourceNameToCanonicalIdLedger } from "../state/source-name-to-canonical-id/index.js";
import { createTransformDataContext } from "./personnel-resolver.js";
import type { ImportArtifactKind } from "../../shared/io/index.js";
import { readXlsx } from "./read-xlsx.js";
import { sourceStateDir } from "./state.js";
import { seedResolvedPropertyCache } from "../state/resolved-property/index.js";
import { excludeManifestRecords } from "./exclude-records.js";
import { createEmitSink } from "./emit-sink.js";
import type { EmitRefItem, EmitSink } from "./emit-sink.js";
import { readCommandPointer } from "../state/command-pointer.js";

type TransformSourceDeps = {
  sourcesRoot: string;
  env: Record<string, string | undefined>;
  produces: readonly ImportArtifactKind[];
  loadSourceModule: typeof loadSourceModule;
  readXlsx: typeof readXlsx;
  state: string;
  digest: (paths: string[]) => Promise<string>;
  makeWorkspace: (env: Record<string, string | undefined>) => Promise<string>;
  createEmitSink: (workspaceDir: string, namespace: string) => EmitSink;
  loadExcludedRecords: (sourceDir: string) => Promise<ExcludedRecords>;
  seedResolvedPropertyCache: (
    seedDir: string,
    rootDir: string,
  ) => Promise<{ seeded: string[]; skipped: string[] }>;
  writeEnvelope: (
    directory: string,
    sourceId: string,
    digest: string,
    manifest: SourceManifest,
    refItems: EmitRefItem[],
  ) => Promise<{ path: string }>;
  logger?: { info: (message: string) => void };
};

/**
 * Derives a deterministic, content-based digest from the input paths. Each
 * path's file bytes are hashed independently, the resulting per-file hashes
 * are sorted, and the sorted hashes are concatenated and hashed again. This
 * makes the digest depend only on the *set* of file contents involved: it is
 * independent of path names and of the order the paths were given, so an
 * updated snapshot at the same path yields a different digest, and identical
 * content at a different path yields the same digest.
 */
async function digestOfPaths(paths: readonly string[]): Promise<string> {
  const fileHashes = await Promise.all(
    paths.map(async (p) => {
      const bytes = await readFile(p);
      return createHash("sha256").update(bytes).digest("hex");
    }),
  );
  fileHashes.sort();
  const combined = createHash("sha256");
  for (const fileHash of fileHashes) combined.update(fileHash);
  return combined.digest("hex").slice(0, 16);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function sourceInputDir(
  workspace: string,
  sourceId: string,
): Promise<string> {
  // A source's inputs are its latest acquire output — there is no fallback. A
  // source that has never been acquired cannot run; acquire it first, either by
  // running its module (`intake acquire <source-id>`) or from local files
  // (`intake acquire <source-id> --from-local <path>`).
  const { latest } = await readCommandPointer(
    path.join(workspace, "state", sourceId),
    "acquire",
  );
  if (latest === undefined) {
    throw new Error(
      `${sourceId} has no acquired input. Run \`intake acquire ${sourceId}\` ` +
        `(or \`intake acquire ${sourceId} --from-local <path>\`) before running it.`,
    );
  }
  return path.join(workspace, latest);
}

export async function sourceInputPaths(inputDir: string): Promise<string[]> {
  const collect = async (dir: string): Promise<string[]> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await collect(full)));
      else if (entry.isFile()) files.push(full);
    }
    return files;
  };
  return (await collect(inputDir)).sort();
}

/**
 * The transform phase (`data transform`): run a source's transform.ts to produce its
 * Artifacts and write the envelope, resolving against the live database as needed —
 * but stop before the import. Returns the written Artifacts path, or a command-error
 * result. The import (diff → chain) is the separate `data generate` phase.
 */
export async function transformSource(
  sourceId: string,
  paths: string[],
  options: { standalone?: boolean },
  deps: TransformSourceDeps,
): Promise<{ artifactsPath: string } | { error: CommandResult }> {
  // A standalone (manual curation) source reads its records from state, not input
  // paths, so it runs with none; every other source requires at least one path.
  if (paths.length === 0 && options.standalone !== true) {
    return {
      error: {
        exitCode: 1,
        stderr: "intake data transform requires at least one path\n",
      },
    };
  }

  let transform;
  try {
    transform = await deps.loadSourceModule(sourceId, deps.sourcesRoot);
  } catch (error) {
    return { error: { exitCode: 1, stderr: `${errorMessage(error)}\n` } };
  }

  try {
    const sourceDir = path.join(deps.sourcesRoot, sourceId);
    const excludedRecords = await deps.loadExcludedRecords(sourceDir);
    // Seed the durable ResolvedProperty cache from the source's committed
    // resolved-property-seed/ (manual resolutions the resolvers cannot derive)
    // before the import reads it — copy-if-absent, so anything already resolved
    // on disk wins (ADR 0018 point 8).
    const workspaceRoot =
      deps.env.INTAKE_WORKSPACE_TEST ?? deps.env.INTAKE_WORKSPACE;
    if (workspaceRoot !== undefined) {
      await deps.seedResolvedPropertyCache(
        path.join(sourceDir, "resolved-property-seed"),
        workspaceRoot,
      );
    }
    const workspace = await deps.makeWorkspace(deps.env);
    const sink = deps.createEmitSink(workspace, sourceId);
    const databaseUrl = deps.env.DATABASE_URL;
    const dbClient =
      databaseUrl !== undefined && databaseUrl.trim().length > 0
        ? defaultDatabaseClientFactory(databaseUrl)
        : undefined;
    if (dbClient !== undefined) await dbClient.connect();
    let manifest;
    try {
      const data =
        dbClient !== undefined
          ? createTransformDataContext(
              dbClient,
              createSourceNameToCanonicalIdLedger(
                workspaceRoot !== undefined ? { rootDir: workspaceRoot } : {},
              ),
              sourceId,
            )
          : undefined;
      manifest = await transform({
        paths,
        readXlsx: deps.readXlsx,
        state: deps.state,
        emit: sink.emit,
        env: deps.env,
        data,
        logger: deps.logger,
      });
    } finally {
      if (dbClient !== undefined) await dbClient.end();
    }
    // Apply excluded.yaml at Artifacts generation (with FK cascade) so an
    // excluded record never enters the Artifacts — the import then sees a clean
    // envelope and needs no exclusion of its own.
    const { manifest: filteredManifest } = excludeManifestRecords(
      manifest,
      excludedRecords,
    );
    const digest = await deps.digest(paths);
    const refItems = await sink.flush();
    // Emitted kinds (manifest + sink) must be declared: produces drives run
    // ordering (ADR 0021), so undeclared drift would mis-order consumers.
    const declared = new Set<string>(deps.produces);
    const emitted = new Set<string>([
      ...manifest.artifacts.map((artifact) => artifact.kind),
      ...refItems.map((item) => item.ref.kind),
    ]);
    const undeclared = [...emitted].filter((kind) => !declared.has(kind));
    if (undeclared.length > 0) {
      return {
        error: {
          exitCode: 1,
          stderr: `Source ${sourceId} emitted undeclared kind(s): ${undeclared.join(", ")}\n`,
        },
      };
    }
    const { path: artifactsPath } = await deps.writeEnvelope(
      workspace,
      sourceId,
      digest,
      filteredManifest,
      refItems,
    );
    return { artifactsPath };
  } catch (error) {
    return { error: { exitCode: 1, stderr: `${errorMessage(error)}\n` } };
  }
}

/**
 * Build the per-source dependency bundle the transform phase reaches through.
 * Shared so `data transform`'s wiring lives in one place.
 */
export async function buildTransformSourceDeps(
  sourceId: string,
  paths: string[],
  env: Record<string, string | undefined>,
  options: {
    commandArgs: string[];
    logger: { info: (message: string) => void };
  },
): Promise<TransformSourceDeps> {
  const sourcesRoot = path.join(process.cwd(), "sources");
  return {
    sourcesRoot,
    env,
    produces: await loadSourceProduces(sourceId, sourcesRoot),
    loadSourceModule,
    readXlsx,
    state: await sourceStateDir(env, sourceId),
    digest: digestOfPaths,
    makeWorkspace: async (e) =>
      (
        await createCommandDirectory(e, {
          namespace: sourceId,
          args: options.commandArgs,
        })
      ).outputDirectory,
    createEmitSink,
    loadExcludedRecords,
    seedResolvedPropertyCache,
    writeEnvelope: async (directory, id, digest, manifest, refItems) =>
      Artifacts.write(
        directory,
        buildArtifactsEnvelope(id, digest, manifest, refItems),
      ),
    logger: options.logger,
  };
}
