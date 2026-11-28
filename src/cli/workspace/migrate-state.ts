import { constants, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  readFile,
  realpath,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  InitialAgencyRoots,
  PropertyCorrection,
  Artifacts,
} from "../../shared/io/index.js";
import { assertValidSourceId } from "../../shared/source-namespace.js";
import type { AgencyLocationPathLookup } from "../../shared/agency-location-path.js";
import { yamlDigest, yamlResourceFileName } from "../../shared/io/resource.js";
import { CanonicalIdToSourceName } from "../state/source-name-to-canonical-id/CanonicalIdToSourceName.js";
import { SourceNameToCanonicalId } from "../state/source-name-to-canonical-id/SourceNameToCanonicalId.js";
import { INTAKE_API_VERSION } from "../../shared/io/intake-api-version.js";
import { SourceScopedResolvedProperty } from "../../shared/io/SourceScopedResolvedProperty.js";
import { inspectResolvedProperty } from "../state/resolved-property/index.js";
import {
  createSourceNameToCanonicalIdLedger,
  type LedgerEntityKind,
} from "../state/source-name-to-canonical-id/index.js";
import { ResolvedProperty } from "../state/resolved-property/ResolvedProperty.js";
import { directoryDigest } from "../state/transform-completion.js";
import {
  readCommandPointer,
  writeCommandPointer,
} from "../state/command-pointer.js";

type MapFile = Record<string, string>;
export interface MigrationOptions {
  from: string;
  to: string;
  namespaces: MapFile;
  commandPaths: MapFile;
  annotationIds: MapFile;
  getLocationPathById?: AgencyLocationPathLookup;
  progress?: (processed: number) => void;
}
export const stringMap = z.record(z.string().min(1), z.string().min(1));
const pointer = z.strictObject({
  path: z.string().regex(/^[a-f\d]{64}\.json$/),
  sha256: z.string().regex(/^[a-f\d]{64}$/),
});
const manualOutput = z.strictObject({
  previous: pointer.nullable(),
  entries: z.array(
    z.strictObject({
      kind: z.string(),
      record: z.record(z.string(), z.json()),
    }),
  ),
});
type FileJob = {
  source: string;
  dest: string;
  scope: "ledger" | "phase" | "private" | "raw";
  namespace: string;
};
function inside(child: string, parent: string) {
  const rel = path.relative(parent, child);
  return (
    !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + path.sep)
  );
}
async function exists(file: string) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function digest(file: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
function renamedKeys<T>(
  values: Record<string, T>,
  mapping: MapFile,
): Record<string, T> {
  const pairs = Object.entries(values).map(
    ([key, value]) => [mapping[key] ?? key, value] as const,
  );
  const result = Object.fromEntries(pairs);
  if (Object.keys(result).length !== pairs.length)
    throw Error("Namespace key collision.");
  return result;
}
export async function migrateState(options: MigrationOptions) {
  const from = await realpath(options.from),
    to = await realpath(options.to);
  if (inside(to, from) || inside(from, to))
    throw Error("Migration workspaces must be separate directories.");
  const names = stringMap.parse(options.namespaces),
    commands = stringMap.parse(options.commandPaths),
    annotations = stringMap.parse(options.annotationIds);
  for (const [old, next] of Object.entries(names)) {
    assertValidSourceId(old);
    assertValidSourceId(next);
    if (
      old.includes("/") ||
      old === "intake" ||
      next === "intake" ||
      next.startsWith("intake/")
    )
      throw Error("Invalid namespace mapping: " + old + " → " + next);
  }
  for (const map of [names, commands, annotations])
    if (new Set(Object.values(map)).size !== Object.values(map).length)
      throw Error("Migration map has duplicate targets.");
  for (const rel of [...Object.keys(commands), ...Object.values(commands)])
    if (
      !rel.startsWith("command/") ||
      path.posix.normalize(rel) !== rel ||
      rel.includes("\\")
    )
      throw Error("Invalid command path: " + rel);
  const report = {
    processed: 0,
    written: 0,
    identical: 0,
    omittedPointers: [] as string[],
    unmappedAnnotations: new Set<string>(),
  };
  const mapped = (ns: string) =>
    ns === "intake"
      ? ns
      : (names[ns] ??
        (() => {
          throw Error("Unmapped namespace: " + ns);
        })());
  function commandTarget(rel: string) {
    let base = rel;
    while (
      base !== "." &&
      base !== path.dirname(base) &&
      !Object.hasOwn(commands, base)
    )
      base = path.dirname(base);
    return Object.hasOwn(commands, base)
      ? path.join(commands[base], path.relative(base, rel))
      : undefined;
  }
  const rootPath = (value: string) => {
    if (!value.startsWith(from + "/")) return value;
    const rel = path.relative(from, value),
      components = rel.split("/");
    const command = commandTarget(rel);
    if (command) return path.join(to, command);
    // Evidence from an unretained command still lives in the recovery workspace.
    if (rel.startsWith("command/")) return value;
    for (const prefix of [
      "state/intake/namespaces/",
      "intake/state/namespaces/",
      "state/",
      "",
    ]) {
      if (!rel.startsWith(prefix)) continue;
      const [ns, ...suffix] = rel.slice(prefix.length).split("/");
      if (names[ns]) return path.join(to, prefix, names[ns], ...suffix);
    }
    return path.join(to, ...components);
  };
  const metadata = <
    T extends { namespace: string; annotations?: Record<string, string> },
  >(
    meta: T,
    namespace: string,
  ): T => {
    if (meta.namespace !== namespace)
      throw Error(
        "Envelope namespace differs from owning folder: " +
          meta.namespace +
          " / " +
          namespace,
      );
    return {
      ...meta,
      namespace: mapped(namespace),
      ...(meta.annotations
        ? {
            annotations: Object.fromEntries(
              Object.entries(meta.annotations).map(([k, v]) => [
                k,
                rootPath(v),
              ]),
            ),
          }
        : {}),
    };
  };
  const directories = new Map<string, Promise<void>>([[to, Promise.resolve()]]);
  function directory(dir: string): Promise<void> {
    if (!inside(dir, to)) throw Error("Output escaped destination: " + dir);
    const prior = directories.get(dir);
    if (prior) return prior;
    const work = (async () => {
      await directory(path.dirname(dir));
      try {
        await mkdir(dir);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      if (!(await lstat(dir)).isDirectory())
        throw Error("Unsafe destination directory: " + dir);
    })();
    directories.set(dir, work);
    return work;
  }
  async function publish(file: string, dest: string) {
    await directory(path.dirname(dest));
    try {
      // The destination can be claimed by only one worker, even on a case-insensitive volume.
      await link(file, dest);
      report.written++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await verifyIdentical(file, dest);
      report.identical++;
    }
    await unlink(file);
  }
  async function verifyIdentical(source: string, dest: string) {
    const st = await lstat(dest);
    if (
      !st.isFile() ||
      st.size !== (await stat(source)).size ||
      (await digest(source)) !== (await digest(dest))
    ) {
      throw Error("Conflicting destination file: " + dest);
    }
  }
  async function copy(source: string, dest: string, stage: string) {
    if (await exists(dest)) {
      await verifyIdentical(source, dest);
      report.identical++;
      return;
    }
    const file = path.join(stage, "bytes");
    await copyFile(source, file, constants.COPYFILE_FICLONE);
    await publish(file, dest);
  }
  async function json(value: unknown, dest: string, stage: string) {
    const file = path.join(stage, "json");
    await writeFile(file, JSON.stringify(value, null, 2) + "\n");
    await publish(file, dest);
  }
  async function reference(value: string, owner: string) {
    const absolute = path.isAbsolute(value);
    const rel = absolute ? path.relative(from, value) : value;
    const target = commandTarget(rel);
    if (!target) {
      report.omittedPointers.push(owner + " → " + value);
      return undefined;
    }
    if (!inside(path.resolve(to, target), to))
      throw Error("Unsafe command reference: " + target);
    await access(path.resolve(to, target));
    return absolute ? path.resolve(to, target) : target;
  }
  const annotation = (ns: string, kind: string, name: string) => {
    if (ns !== "intake" || kind !== "DataAnnotation") return name;
    if (!annotations[name]) report.unmappedAnnotations.add(name);
    return annotations[name] ?? name;
  };
  const originalLedger = createSourceNameToCanonicalIdLedger({ rootDir: from });
  const archiveDir = path.join(
    to,
    "backups/namespace-migration/source-scoped-resolved-properties",
  );
  const archived: {
    originalNamespace: string;
    namespace: string;
    canonicalId: string;
    activeFile: string;
    originalFile: string;
    sha256: string;
    valueMatches: boolean;
    fingerprintMatches: boolean;
  }[] = [];
  const legacyPrefix = encodeURIComponent(INTAKE_API_VERSION + ":");
  function isHistoricalProperty(file: string) {
    const base = path.basename(file);
    if (!base.startsWith(legacyPrefix)) return false;
    const source = base.slice(legacyPrefix.length).split("%3A", 1)[0];
    return Object.hasOwn(names, source);
  }
  async function archiveProperty(job: FileJob, stage: string) {
    const { envelope, contents } = await SourceScopedResolvedProperty.read(
      job.source,
    );
    const { subject, targetProperty, value, inputFingerprint } = envelope.spec;
    const namespace = mapped(subject.namespace),
      filename = yamlResourceFileName(envelope.metadata.name, envelope.kind);
    if (job.namespace !== "intake" || path.basename(job.source) !== filename)
      throw Error("Invalid source-scoped property path: " + job.source);
    const canonicalId = await originalLedger.read(
      subject.namespace,
      subject.kind as LedgerEntityKind,
      subject.name,
    );
    if (!canonicalId)
      throw Error(
        "Missing canonical identity for historical property: " + filename,
      );
    const current = await inspectResolvedProperty({
      rootDir: from,
      subject: {
        apiVersion: subject.apiVersion,
        kind: subject.kind,
        name: canonicalId,
      },
      targetProperty,
      getLocationPathById: locationLookup,
    });
    if (!current)
      throw Error(
        "Missing active canonical property for historical property: " +
          filename,
      );
    const archivePath = path.join(archiveDir, filename),
      sha256 = yamlDigest(contents);
    await copy(job.source, archivePath, stage);
    if ((await digest(archivePath)) !== sha256)
      throw Error("Historical property archive digest mismatch: " + filename);
    archived.push({
      originalNamespace: subject.namespace,
      namespace,
      canonicalId,
      activeFile: path.relative(
        to,
        path.join(
          path.dirname(job.dest),
          yamlResourceFileName(current.metadata.name, current.kind),
        ),
      ),
      originalFile: filename,
      sha256,
      valueMatches: current.spec.entries.some((entry) =>
        isDeepStrictEqual(entry.value, value),
      ),
      fingerprintMatches: current.spec.entries.some(
        (entry) => entry.inputFingerprint === inputFingerprint,
      ),
    });
  }
  async function ledger(job: FileJob, stage: string) {
    const { namespace: ns, source, dest } = job;
    const options = {
      expectedNamespace: ns,
      getLocationPathById: locationLookup,
    };
    let written: { path: string };
    let target = dest;
    if (source.endsWith(".SourceNameToCanonicalId.yaml")) {
      const record = await SourceNameToCanonicalId.read(source, options);
      const name = annotation(ns, record.spec.kind, record.metadata.name);
      written = await SourceNameToCanonicalId.write(
        stage,
        SourceNameToCanonicalId.new({
          ...record,
          metadata: { ...metadata(record.metadata, ns), name },
        }),
      );
      if (name !== record.metadata.name)
        target = path.join(
          path.dirname(dest),
          yamlResourceFileName(name, record.kind),
        );
    } else if (source.endsWith(".CanonicalIdToSourceName.yaml")) {
      const record = await CanonicalIdToSourceName.read(source, options);
      const sourceName = annotation(
        ns,
        record.spec.kind,
        record.spec.sourceName,
      );
      written = await CanonicalIdToSourceName.write(
        stage,
        CanonicalIdToSourceName.new({
          ...record,
          metadata: metadata(record.metadata, ns),
          spec: { ...record.spec, sourceName },
        }),
      );
    } else if (source.endsWith(".ResolvedProperty.yaml")) {
      if (isHistoricalProperty(source)) return archiveProperty(job, stage);
      const record = await ResolvedProperty.read(source, options);
      const entries = record.spec.entries.map((entry) => ({
        ...entry,
        ...(entry.sources
          ? { sources: renamedKeys(entry.sources, names) }
          : {}),
      }));
      written = await ResolvedProperty.write(
        stage,
        ResolvedProperty.new({
          ...record,
          metadata: metadata(record.metadata, ns),
          spec: { ...record.spec, entries },
        }),
        options,
      );
    } else if (source.endsWith(".PropertyCorrection.yaml")) {
      const record = await PropertyCorrection.read(source, options);
      written = await PropertyCorrection.write(
        stage,
        PropertyCorrection.new({
          ...record,
          metadata: metadata(record.metadata, ns),
        }),
        options,
      );
    } else if (source.endsWith(".InitialAgencyRoots.yaml")) {
      const record = await InitialAgencyRoots.read(source, options);
      written = await InitialAgencyRoots.write(
        stage,
        InitialAgencyRoots.new({
          ...record,
          metadata: metadata(record.metadata, ns),
        }),
      );
    } else if (path.basename(source) === ".DS_Store")
      return copy(source, dest, stage);
    else throw Error("Unsupported state envelope: " + source);
    await publish(written.path, target);
  }
  const locationLookup = options.getLocationPathById;
  async function manual(job: FileJob, stage: string) {
    const oldHead = pointer.parse(
      JSON.parse(await readFile(job.source, "utf8")),
    );
    const previous = oldHead,
      seen = new Set<string>();
    let ref: typeof oldHead | null = oldHead;
    let head: z.infer<typeof manualOutput> | undefined;
    while (ref) {
      if (ref.path !== ref.sha256 + ".json" || seen.has(ref.path))
        throw Error("Invalid manual snapshot pointer: " + ref.path);
      seen.add(ref.path);
      const body = await readFile(
        path.join(path.dirname(job.source), ref.path),
        "utf8",
      );
      if (yamlDigest(body) !== ref.sha256)
        throw Error("Manual snapshot digest mismatch: " + ref.path);
      const snapshot = manualOutput.parse(JSON.parse(body));
      head ??= snapshot;
      ref = snapshot.previous;
    }
    const entries = head!.entries.map((entry) => {
      const exclusions = entry.record.source_exclusions;
      if (
        !exclusions ||
        typeof exclusions !== "object" ||
        Array.isArray(exclusions)
      )
        return entry;
      return {
        ...entry,
        record: {
          ...entry.record,
          source_exclusions: renamedKeys(exclusions, names),
        },
      };
    });
    if (isDeepStrictEqual(entries, head!.entries))
      return copy(job.source, job.dest, stage);
    const body = { previous, entries },
      hash = yamlDigest(JSON.stringify(body, null, 2) + "\n"),
      filename = hash + ".json";
    await json(body, path.join(path.dirname(job.dest), filename), stage);
    await json({ path: filename, sha256: hash }, job.dest, stage);
  }
  function storageValue(value: unknown, key = "", source = ""): unknown {
    if (["response", "responses", "html", "paragraphs"].includes(key))
      return value;
    if (typeof value === "string") {
      if (key === "namespace" || key === "source_namespace")
        return names[value] ?? value;
      if (
        ["requestedPages", "evidenceKey", "pageKey", "key"].includes(key) &&
        value.startsWith(source + "/")
      )
        return mapped(source) + value.slice(source.length);
      if (key === "articleKey") {
        const values: unknown = JSON.parse(value);
        if (!Array.isArray(values) || typeof values[0] !== "string")
          throw Error("Malformed private article key.");
        if (values.length === 1) return value;
        return JSON.stringify([
          names[values[0]] ?? values[0],
          ...values.slice(1),
        ]);
      }
      return value;
    }
    if (Array.isArray(value))
      return value.map((entry) => storageValue(entry, key, source));
    if (!value || typeof value !== "object") return value;
    const result: Record<string, unknown> = {};
    for (const [field, entry] of Object.entries(value)) {
      let target = field;
      if (key === "visible") {
        const [route, article] = z
          .tuple([z.string(), z.string()])
          .parse(JSON.parse(field));
        target = JSON.stringify([
          route,
          storageValue(article, "articleKey", source),
        ]);
      }
      if (key === "comparisons") {
        const [term, route, article] = z
          .tuple([z.string(), z.string(), z.string()])
          .parse(JSON.parse(field));
        target = JSON.stringify([
          term,
          route,
          storageValue(article, "articleKey", source),
        ]);
      }
      result[target] = storageValue(entry, field, source);
    }
    return result;
  }
  async function migrate(job: FileJob, stage: string) {
    const { source, dest, scope } = job,
      base = path.basename(source);
    if (
      scope === "ledger" &&
      path.relative(from, source).split(path.sep).includes(".idea")
    ) {
      await copy(
        source,
        path.join(
          to,
          "backups/namespace-migration/editor-files",
          path.relative(from, source),
        ),
        stage,
      );
    } else if (scope === "ledger" || base.endsWith(".InitialAgencyRoots.yaml"))
      await ledger(job, stage);
    else if (
      scope === "phase" &&
      ["acquire.yaml", "import.yaml"].includes(base)
    ) {
      const kind = base.slice(0, -5),
        original = await readCommandPointer(path.dirname(source), kind);
      const latest =
          original.latest && (await reference(original.latest, source)),
        resume = original.resume && (await reference(original.resume, source));
      if (latest || resume) {
        await writeCommandPointer(stage, kind, { latest, resume });
        await publish(path.join(stage, base), dest);
      }
    } else if (scope === "phase" && base === "transform-completion.json") {
      const item = JSON.parse(await readFile(source, "utf8"));
      if (item.status === "started") await copy(source, dest, stage);
      else if (item.status === "complete") {
        const output = await reference(item.artifactsPath, source);
        const input =
          item.input && (await reference(item.input.directory, source));
        if (output && (!item.input || input)) {
          if (
            (await Artifacts.integrityDigest(output)) !== item.outputDigest ||
            (input && (await directoryDigest(input)) !== item.input.digest)
          )
            throw Error("Changed completed transform: " + source);
          await json(
            {
              ...item,
              artifactsPath: output,
              input: input ? { ...item.input, directory: input } : null,
            },
            dest,
            stage,
          );
        }
      } else throw Error("Invalid transform completion: " + source);
    } else if (
      scope === "phase" &&
      base === "latest.json" &&
      path.basename(path.dirname(source)) === "manual"
    )
      await manual(job, stage);
    else if (
      scope === "private" &&
      base.endsWith(".json") &&
      source.includes("/daily-pilot/")
    ) {
      const prior = JSON.parse(await readFile(source, "utf8"));
      const next = storageValue(prior, "", job.namespace);
      if (isDeepStrictEqual(prior, next)) await copy(source, dest, stage);
      else await json(next, dest, stage);
    } else await copy(source, dest, stage);
    report.processed++;
    if (report.processed % 50000 === 0) options.progress?.(report.processed);
  }
  async function* walk(
    source: string,
    dest: string,
    scope: FileJob["scope"],
    namespace: string,
  ): AsyncGenerator<FileJob> {
    await directory(dest);
    for await (const entry of await opendir(source, { bufferSize: 256 })) {
      const src = path.join(source, entry.name);
      const name =
        scope === "private" &&
        entry.isDirectory() &&
        entry.name === namespace &&
        src.includes("/daily-pilot/")
          ? mapped(namespace)
          : entry.name;
      const dst = path.join(dest, name);
      if (entry.isDirectory()) yield* walk(src, dst, scope, namespace);
      else if (entry.isFile())
        yield { source: src, dest: dst, scope, namespace };
      else throw Error("Unsupported state directory entry: " + src);
    }
  }
  async function* jobs(): AsyncGenerator<FileJob> {
    for (const [prefix, scope] of [
      ["state", "phase"],
      ["intake/state/namespaces", "private"],
      ["state/intake/namespaces", "ledger"],
    ] as const) {
      const root = path.join(from, prefix);
      if (!(await exists(root))) continue;
      for await (const ns of await opendir(root)) {
        if (ns.name.startsWith(".")) continue;
        if (!ns.isDirectory())
          throw Error("Unexpected state entry: " + path.join(root, ns.name));
        if (scope === "phase" && ns.name === "intake") continue;
        yield* walk(
          path.join(root, ns.name),
          path.join(to, prefix, mapped(ns.name)),
          scope,
          ns.name,
        );
      }
    }
    for (const [ns, next] of Object.entries(names)) {
      const source = path.join(from, ns);
      if (await exists(source))
        yield* walk(source, path.join(to, next), "raw", ns);
    }
  }
  const temporary = await mkdtemp(path.join(to, ".migrate-state-"));
  try {
    const iterator = jobs(),
      workers = Array.from({ length: 16 }, async (_, i) => {
        const stage = path.join(temporary, String(i));
        await mkdir(stage);
        while (true) {
          const { done, value } = await iterator.next();
          if (done) return;
          try {
            await migrate(value, stage);
          } catch (error) {
            await iterator.return(undefined);
            throw new Error(value.source + ": " + String(error), {
              cause: error,
            });
          }
        }
      });
    const results = await Promise.allSettled(workers);
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
    if (archived.length)
      await json(
        archived.sort((a, b) => a.originalFile.localeCompare(b.originalFile)),
        path.join(archiveDir, "manifest.json"),
        temporary,
      );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return {
    ...report,
    archivedProperties: archived.length,
    unmappedAnnotations: [...report.unmappedAnnotations].sort(),
    omittedPointers: report.omittedPointers.sort(),
  };
}
