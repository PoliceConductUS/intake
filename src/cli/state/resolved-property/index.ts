import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { INTAKE_API_VERSION } from "../../../shared/io/import-types.js";
import { yamlResourceFileName } from "../../../shared/io/resource.js";
import {
  ResolvedProperty,
  type ResolvedPropertyEnvelope,
} from "./ResolvedProperty.js";

export type ResolvedPropertySubject = {
  apiVersion: typeof INTAKE_API_VERSION;
  kind: string;
  name: string;
};

/** The source record that resolved a value (per-entry provenance). */
export type ResolvedPropertySource = {
  namespace: string;
  kind: string;
  name: string;
};

type EntrySources = Record<
  string,
  { kind: string; name: string; inputFingerprint?: string }
>;

export type ResolvedPropertyCacheInput = {
  subject: ResolvedPropertySubject;
  targetProperty: string;
  /**
   * Fingerprint of the resolver's normalized input (ADR 0019). The cache stores
   * one entry per fingerprint; a read hits only the entry with the matching
   * fingerprint. Absent ⇒ the property is keyed by `(subject, property)` alone
   * (the unfingerprinted entry overrides any fingerprint).
   */
  inputFingerprint?: string;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function typedInputFingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function resolvedPropertyCacheName(
  input: ResolvedPropertyCacheInput,
): string {
  return [
    input.subject.apiVersion,
    input.subject.kind,
    input.subject.name,
    input.targetProperty,
  ].join(":");
}

function resolvedPropertyDirectory(rootDir: string): string {
  return path.join(
    rootDir,
    "state",
    "intake",
    "namespaces",
    "intake",
    "ResolvedProperty",
  );
}

function resolvedPropertyPath(
  rootDir: string,
  input: ResolvedPropertyCacheInput,
): string {
  return path.join(
    resolvedPropertyDirectory(rootDir),
    yamlResourceFileName(resolvedPropertyCacheName(input), "ResolvedProperty"),
  );
}

async function readableResolvedPropertyFile(
  filePath: string,
): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error(`ResolvedProperty path is not a file: ${filePath}`);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function inspectResolvedProperty(
  input: ResolvedPropertyCacheInput & { rootDir?: string },
): Promise<ResolvedPropertyEnvelope | undefined> {
  if (input.rootDir === undefined) {
    return undefined;
  }

  const filePath = resolvedPropertyPath(input.rootDir, input);
  if (!(await readableResolvedPropertyFile(filePath))) {
    return undefined;
  }
  const envelope = await ResolvedProperty.read(filePath, {
    expectedNamespace: "intake",
  });
  if (envelope.metadata.name !== resolvedPropertyCacheName(input)) {
    throw new Error(
      `ResolvedProperty metadata.name ${envelope.metadata.name} does not match cache name ${resolvedPropertyCacheName(input)}.`,
    );
  }
  if (
    envelope.spec.subject.apiVersion !== input.subject.apiVersion ||
    envelope.spec.subject.kind !== input.subject.kind ||
    envelope.spec.subject.name !== input.subject.name ||
    envelope.spec.targetProperty !== input.targetProperty
  ) {
    throw new Error(
      `ResolvedProperty spec identity does not match cache name ${resolvedPropertyCacheName(input)}.`,
    );
  }

  return envelope;
}

export async function readResolvedProperty(
  input: ResolvedPropertyCacheInput & { rootDir?: string },
): Promise<unknown | undefined> {
  const envelope = await inspectResolvedProperty(input);
  if (envelope === undefined) return undefined;
  const entries = envelope.spec.entries;
  const override = entries.find(
    (entry) => entry.inputFingerprint === undefined,
  );
  if (override !== undefined) return override.value;
  return entries.find(
    (entry) => entry.inputFingerprint === input.inputFingerprint,
  )?.value;
}

/**
 * Snapshot established slug ownership once per command, loading only each used
 * kind's slug envelopes. The cache remains the durable record; this index is
 * only an in-memory lookup for allocation when the database has been reset.
 */
export function createResolvedSlugOwnerLookup(
  rootDir?: string,
): (kind: string, slug: string) => Promise<string | undefined> {
  let files: Promise<string[]> | undefined;
  const indexes = new Map<string, Promise<Map<string, string>>>();

  async function indexKind(kind: string): Promise<Map<string, string>> {
    if (rootDir === undefined) return new Map();
    files ??= readdir(resolvedPropertyDirectory(rootDir)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const prefix = `${INTAKE_API_VERSION}:${kind}:`;
    const suffix = ":slug";
    const owners = new Map<string, string>();
    for (const fileName of await files) {
      if (!fileName.endsWith(".ResolvedProperty.yaml")) continue;
      const cacheName = decodeURIComponent(
        fileName.slice(0, -".ResolvedProperty.yaml".length),
      );
      if (!cacheName.startsWith(prefix) || !cacheName.endsWith(suffix))
        continue;
      const name = cacheName.slice(prefix.length, -suffix.length);
      const value = await readResolvedProperty({
        rootDir,
        subject: { apiVersion: INTAKE_API_VERSION, kind, name },
        targetProperty: "slug",
      });
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Invalid canonical slug cache for ${kind} ${name}.`);
      }
      const owner = owners.get(value);
      if (owner !== undefined && owner !== name) {
        throw new Error(
          `Canonical slug conflict for ${kind}: ${value} belongs to both ${owner} and ${name}.`,
        );
      }
      owners.set(value, name);
    }
    return owners;
  }

  return async (kind, slug) => {
    let index = indexes.get(kind);
    if (index === undefined) {
      index = indexKind(kind);
      indexes.set(kind, index);
    }
    return (await index).get(slug);
  };
}

type ResolvedPropertyEntry =
  ResolvedPropertyEnvelope["spec"]["entries"][number];

function mergedSources(
  existing: EntrySources | undefined,
  source: ResolvedPropertySource | undefined,
): EntrySources | undefined {
  if (source === undefined) {
    return existing;
  }
  return {
    ...(existing ?? {}),
    [source.namespace]: { kind: source.kind, name: source.name },
  };
}

async function persistEntries(
  rootDir: string,
  input: ResolvedPropertyCacheInput,
  entries: ReadonlyArray<ResolvedPropertyEntry>,
): Promise<void> {
  const existing = await inspectResolvedProperty({ ...input, rootDir });
  await ResolvedProperty.write(
    resolvedPropertyDirectory(rootDir),
    ResolvedProperty.new({
      metadata: existing?.metadata ?? {
        name: resolvedPropertyCacheName(input),
        namespace: "intake",
      },
      spec: {
        subject: input.subject,
        targetProperty: input.targetProperty,
        entries: [...entries],
      },
    }),
  );
}

/** Explicit operator correction. Preserve automatic values and prior overrides. */
export async function setManualResolvedProperty(
  input: ResolvedPropertyCacheInput & {
    rootDir: string;
    value: unknown;
    source: ResolvedPropertySource;
    force: boolean;
    commandId: string;
  },
): Promise<void> {
  const existing = await inspectResolvedProperty(input);
  if (existing !== undefined && !input.force) {
    throw new Error(
      `Cache already has a value. Use --force to overwrite. Current cache: ${JSON.stringify(existing.spec)}`,
    );
  }
  const entries = [...(existing?.spec.entries ?? [])];
  const currentIndex = entries.findIndex(
    (entry) => entry.inputFingerprint === undefined,
  );
  if (currentIndex !== -1) {
    let sequence = 1;
    while (
      entries.some(
        (entry) => entry.inputFingerprint === `previous-override-${sequence}`,
      )
    )
      sequence++;
    entries[currentIndex] = {
      ...entries[currentIndex],
      inputFingerprint: `previous-override-${sequence}`,
    };
  }
  entries.push({
    value: input.value,
    sources: mergedSources(undefined, input.source),
    recordedAt: new Date().toISOString(),
    commandId: input.commandId,
  });
  await persistEntries(input.rootDir, input, entries);
}

export async function writeResolvedProperty(
  input: ResolvedPropertyCacheInput & {
    rootDir?: string;
    value: unknown;
    source?: ResolvedPropertySource;
  },
): Promise<void> {
  if (input.rootDir === undefined) {
    return;
  }

  const filePath = resolvedPropertyPath(input.rootDir, input);
  const existingEnvelope = (await readableResolvedPropertyFile(filePath))
    ? await ResolvedProperty.read(filePath, { expectedNamespace: "intake" })
    : undefined;
  const existing = existingEnvelope?.spec.entries ?? [];
  const fingerprint = input.inputFingerprint;
  const others = existing.filter(
    (entry) => entry.inputFingerprint !== fingerprint,
  );
  const priorSameInput = existing.find(
    (entry) => entry.inputFingerprint === fingerprint,
  );
  if (
    priorSameInput !== undefined &&
    stableJson(priorSameInput.value) !== stableJson(input.value)
  ) {
    throw new Error(
      `ResolvedProperty ${resolvedPropertyCacheName(input)} already has a different value for the same input.`,
    );
  }
  if (fingerprint === undefined && priorSameInput !== undefined) return;
  const sources = mergedSources(priorSameInput?.sources, input.source);
  await persistEntries(input.rootDir, input, [
    ...others,
    {
      ...priorSameInput,
      ...(fingerprint === undefined ? {} : { inputFingerprint: fingerprint }),
      value: input.value,
      ...(sources === undefined ? {} : { sources }),
    },
  ]);
}
