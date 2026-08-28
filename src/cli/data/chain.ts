import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseMutations } from "../import/artifacts/io/DatabaseMutations.js";
import type { DatabaseMutationsEnvelope } from "../import/artifacts/io/DatabaseMutations.js";
import { executeDatabaseMutations } from "../replay/database-mutations/execute.js";
import type { DatabaseClient } from "../database/index.js";
import {
  readAppliedDataMutationChecksums,
  readAppliedDataMutationVersions,
  readCurrentSchemaVersion,
  recordDataMutationApplied,
} from "../database/data-mutation-ledger.js";

// The data-mutation chain (ADR 0033/0034). Each entry is a DatabaseMutations
// envelope stamped with its version and its predecessor's version, so the files
// form a linked list. Application is tracked in the data_mutation_applied ledger.
// The chain lives in the workspace (`$INTAKE_WORKSPACE/data/mutations`), coupled to
// the cache/ledger that mints its ids — chain and cache are one lineage (ADR 0034).
const CHAIN_DIR = "mutations";
const VERSION_KEY = "data-mutation/version";
const PREVIOUS_KEY = "data-mutation/previous";

// The chain's default home: `$INTAKE_WORKSPACE/data`. Callers (tests) may pass an
// explicit root; the CLI uses this default so the chain sits beside command/ and
// state/ in the workspace.
function defaultChainRoot(): string {
  const workspace = process.env.INTAKE_WORKSPACE;
  if (workspace === undefined || workspace.trim() === "") {
    throw new Error(
      "INTAKE_WORKSPACE is required to locate the data-mutation chain.",
    );
  }
  return path.join(workspace, "data");
}

export function chainDir(root: string = defaultChainRoot()): string {
  return path.join(root, CHAIN_DIR);
}

export type ChainEntry = {
  version: string;
  previous: string;
  minSchemaVersion: string;
  fileName: string;
  filePath: string;
  /** The digest of the source Artifacts this entry was generated from, if any —
   * lets batch generate skip an output already in the chain (idempotent). */
  sourceArtifactsDigest?: string;
};

function annotationsOf(
  envelope: DatabaseMutationsEnvelope,
): Record<string, string> {
  return (envelope.metadata.annotations ?? {}) as Record<string, string>;
}

// The highest schema-migration version the entry was generated against — the
// minimum the database must already have applied to run it (ADR 0033).
function minSchemaVersion(envelope: DatabaseMutationsEnvelope): string {
  const schema = envelope.metadata.databaseSchema as
    | { appliedMigrations?: { version: string }[] }
    | undefined;
  const versions = (schema?.appliedMigrations ?? [])
    .map((migration) => String(migration.version))
    .sort();
  return versions[versions.length - 1] ?? "";
}

export async function listEntries(root?: string): Promise<ChainEntry[]> {
  const dir = chainDir(root);
  const files = (await readdir(dir).catch(() => []))
    .filter((file) => file.endsWith(".DatabaseMutations.yaml"))
    .sort();
  const entries: ChainEntry[] = [];
  for (const fileName of files) {
    const filePath = path.join(dir, fileName);
    const envelope = await DatabaseMutations.read(filePath, { raw: true });
    const annotations = annotationsOf(envelope);
    const sourceArtifactsDigest = (
      envelope.metadata as { sourceArtifactsDigest?: string }
    ).sourceArtifactsDigest;
    entries.push({
      version: annotations[VERSION_KEY] ?? fileName,
      previous: annotations[PREVIOUS_KEY] ?? "",
      minSchemaVersion: minSchemaVersion(envelope),
      fileName,
      filePath,
      sourceArtifactsDigest,
    });
  }
  return entries;
}

async function fileChecksum(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

/**
 * Turn a run's DatabaseMutations envelope (produced by `run --dry-run`) into the
 * next chain entry: skip an empty diff, else stamp its version + predecessor and
 * write it to the workspace chain dir. Returns the written path, or undefined when the
 * diff was empty.
 */
export async function generateEntry(
  mutationsEnvelopePath: string,
  root?: string,
): Promise<{ written?: string; version?: string; mutationCount: number }> {
  // Read fully-expanded (chunks inlined) so the re-write re-chunks into the chain.
  const envelope = await DatabaseMutations.read(mutationsEnvelopePath);
  // A `*Read` mutation asserts an existing row (upsert: read, ADR 0011/0014) — a
  // no-op that persists nothing. An envelope of only reads is an empty delta (a
  // re-import of an already-applied source) and is never appended to the chain.
  const effective = envelope.spec.mutations.filter(
    (mutation) => !String((mutation as { kind?: unknown }).kind).endsWith("Read"),
  );
  const mutationCount = effective.length;
  if (mutationCount === 0) {
    return { mutationCount: 0 };
  }
  const entries = await listEntries(root);
  const version = String(entries.length + 1).padStart(6, "0");
  const previous = entries[entries.length - 1]?.version ?? "";
  const namespace = envelope.metadata.namespace;

  const stamped: DatabaseMutationsEnvelope = {
    ...envelope,
    metadata: {
      ...envelope.metadata,
      name: `${version}-${namespace}`,
      annotations: {
        ...annotationsOf(envelope),
        [VERSION_KEY]: version,
        [PREVIOUS_KEY]: previous,
      },
    },
  };
  const dir = chainDir(root);
  await mkdir(dir, { recursive: true });
  const { path: written } = await DatabaseMutations.write(dir, stamped);
  return { written, version, mutationCount };
}

export type BatchGenerateResult = {
  appended: { source: string; version: string; mutationCount: number }[];
  skipped: { source: string; reason: "empty" | "already-in-chain" }[];
};

// The newest `*.DatabaseMutations.yaml` each source produced, under
// `<command>/<cmd>/<source>/output/`, ordered oldest-first — the order the runs were
// produced, which is dependency order when the sources were run in order.
async function newestRunOutputPerSource(
  commandRoot: string,
): Promise<{ source: string; filePath: string; producedAt: number }[]> {
  const newest = new Map<string, { filePath: string; producedAt: number }>();
  for (const commandDir of await readdir(commandRoot).catch(() => [])) {
    const sourcesDir = path.join(commandRoot, commandDir);
    for (const source of await readdir(sourcesDir).catch(() => [])) {
      const outputDir = path.join(sourcesDir, source, "output");
      for (const file of await readdir(outputDir).catch(() => [])) {
        if (!file.endsWith(".DatabaseMutations.yaml")) continue;
        const filePath = path.join(outputDir, file);
        const producedAt = (await stat(filePath)).mtimeMs;
        const current = newest.get(source);
        if (current === undefined || producedAt > current.producedAt) {
          newest.set(source, { filePath, producedAt });
        }
      }
    }
  }
  return [...newest.entries()]
    .map(([source, value]) => ({ source, ...value }))
    .sort((left, right) => left.producedAt - right.producedAt);
}

/**
 * The batch form of `generate <file>` (ADR 0033): discover the newest run output
 * each source produced (its latest `run --dry-run` envelope in the workspace) and
 * append the ones not yet in the chain, in the order they were produced. Idempotent
 * — an output whose source-Artifacts digest is already an entry is skipped, and an
 * empty diff appends nothing — so it is safe to re-run and never double-appends.
 */
export async function generateFromLatestRunOutputs(
  root?: string,
): Promise<BatchGenerateResult> {
  const workspace = process.env.INTAKE_WORKSPACE;
  if (workspace === undefined || workspace.trim() === "") {
    throw new Error("INTAKE_WORKSPACE is required to discover run outputs.");
  }
  const existing = new Set(
    (await listEntries(root))
      .map((entry) => entry.sourceArtifactsDigest)
      .filter((digest): digest is string => digest !== undefined),
  );

  const appended: BatchGenerateResult["appended"] = [];
  const skipped: BatchGenerateResult["skipped"] = [];
  for (const output of await newestRunOutputPerSource(
    path.join(workspace, "command"),
  )) {
    const digest = (
      (await DatabaseMutations.read(output.filePath, { raw: true }))
        .metadata as { sourceArtifactsDigest?: string }
    ).sourceArtifactsDigest;
    if (digest !== undefined && existing.has(digest)) {
      skipped.push({ source: output.source, reason: "already-in-chain" });
      continue;
    }
    const { written, version, mutationCount } = await generateEntry(
      output.filePath,
      root,
    );
    if (written === undefined || version === undefined) {
      skipped.push({ source: output.source, reason: "empty" });
      continue;
    }
    if (digest !== undefined) existing.add(digest);
    appended.push({ source: output.source, version, mutationCount });
  }
  return { appended, skipped };
}

// A new entry's diff is computed against the current database, so every existing
// chain entry must already be applied (the database at the chain head) — otherwise
// the diff, and thus the mutation, is wrong (ADR 0033).
export async function assertAtHead(
  client: DatabaseClient,
  root?: string,
): Promise<void> {
  const entries = await listEntries(root);
  const applied = await readAppliedDataMutationVersions(client);
  const pending = entries.filter((entry) => !applied.has(entry.version));
  if (pending.length > 0) {
    throw new Error(
      `data: ${pending.length} unapplied entr${
        pending.length === 1 ? "y" : "ies"
      } (${pending[0]!.version}…) — run \`data up\` before generating; the diff must be against the chain head.`,
    );
  }
}

export type ApplyResult = { version: string; mutationCount: number }[];

/**
 * Apply pending chain entries in order (ADR 0033). Each entry requires its
 * predecessor already in the ledger and the database schema at ≥ its min-version;
 * each entry + its ledger row commit in one transaction. `to` stops after that
 * version.
 */
export async function applyPending(
  client: DatabaseClient,
  options: { to?: string; root?: string } = {},
): Promise<ApplyResult> {
  const entries = await listEntries(options.root);
  const applied = await readAppliedDataMutationVersions(client);
  const schema = await readCurrentSchemaVersion(client);
  const result: ApplyResult = [];

  for (const entry of entries) {
    if (applied.has(entry.version)) {
      continue;
    }
    if (entry.previous !== "" && !applied.has(entry.previous)) {
      throw new Error(
        `data: ${entry.fileName} requires ${entry.previous} to be applied first.`,
      );
    }
    if (entry.minSchemaVersion !== "" && schema < entry.minSchemaVersion) {
      throw new Error(
        `data: ${entry.fileName} needs schema >= ${entry.minSchemaVersion}, but the database is at ${schema}.`,
      );
    }
    const checksum = await fileChecksum(entry.filePath);
    await client.query("begin");
    try {
      const counts = await executeDatabaseMutations(client, entry.filePath);
      await recordDataMutationApplied(client, {
        version: entry.version,
        previousVersion: entry.previous === "" ? null : entry.previous,
        checksum,
      });
      await client.query("commit");
      result.push({ version: entry.version, mutationCount: counts.mutations });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
    applied.add(entry.version);
    if (options.to !== undefined && entry.version === options.to) {
      break;
    }
  }
  return result;
}

export type StatusRow = { version: string; fileName: string; applied: boolean };

export async function status(
  client: DatabaseClient,
  root?: string,
): Promise<StatusRow[]> {
  const entries = await listEntries(root);
  const applied = await readAppliedDataMutationVersions(client);
  return entries.map((entry) => ({
    version: entry.version,
    fileName: entry.fileName,
    applied: applied.has(entry.version),
  }));
}

/**
 * Recompute the checksum of every applied entry and compare it to the ledger —
 * an immutable, applied entry must never change. Returns the versions that drifted.
 */
export async function verify(
  client: DatabaseClient,
  root?: string,
): Promise<string[]> {
  const entries = new Map(
    (await listEntries(root)).map((entry) => [entry.version, entry]),
  );
  const ledger = await readAppliedDataMutationChecksums(client);
  const drift: string[] = [];
  for (const [version, checksum] of ledger) {
    const entry = entries.get(version);
    if (
      entry === undefined ||
      (await fileChecksum(entry.filePath)) !== checksum
    ) {
      drift.push(version);
    }
  }
  return drift;
}
