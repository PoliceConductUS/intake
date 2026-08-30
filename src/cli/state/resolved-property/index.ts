import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { INTAKE_API_VERSION } from "../../../shared/io/import-types.js";
import { yamlResourceFileName } from "../../../shared/io/resource.js";
import { ResolvedProperty } from "./ResolvedProperty.js";

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

type EntrySources = Record<string, { kind: string; name: string }>;

export type ResolvedPropertyCacheInput = {
  subject: ResolvedPropertySubject;
  targetProperty: string;
  /**
   * Fingerprint of the resolver's normalized input (ADR 0019). The cache stores
   * one entry per fingerprint; a read hits only the entry with the matching
   * fingerprint. Absent ⇒ the property is keyed by `(subject, property)` alone
   * (a single legacy value that matches any read).
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

/**
 * Copies committed `ResolvedProperty` cache files from `seedDir` into the
 * workspace `ResolvedProperty` cache under `rootDir`, skipping any whose
 * destination already exists — whatever is on disk wins. The files are copied
 * opaquely, so this seeds ANY resolved property (coordinates, slugs,
 * location_path_id, …) without knowing what it holds: a resolver that later
 * reads the same subject/property simply gets a cache hit instead of resolving
 * it live. A source commits these under `sources/<id>/resolved-property-seed/`
 * to supply manual resolutions the resolvers cannot derive (ADR 0018 point 8);
 * a missing `seedDir` is a no-op. Returns which files were seeded vs. skipped.
 */
export async function seedResolvedPropertyCache(
  seedDir: string,
  rootDir: string,
): Promise<{ seeded: string[]; skipped: string[] }> {
  let entries: string[];
  try {
    entries = await readdir(seedDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { seeded: [], skipped: [] };
    }
    throw error;
  }

  const cacheDirectory = resolvedPropertyDirectory(rootDir);
  const seeded: string[] = [];
  const skipped: string[] = [];
  for (const entry of [...entries].sort()) {
    if (!entry.endsWith(".ResolvedProperty.yaml")) {
      continue;
    }
    const destination = path.join(cacheDirectory, entry);
    if (await readableResolvedPropertyFile(destination)) {
      skipped.push(entry);
      continue;
    }
    await mkdir(cacheDirectory, { recursive: true });
    await copyFile(path.join(seedDir, entry), destination);
    seeded.push(entry);
  }
  return { seeded, skipped };
}

export async function readResolvedProperty(
  input: ResolvedPropertyCacheInput & { rootDir?: string },
): Promise<unknown | undefined> {
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

  const entries = envelopeEntries(envelope.spec);
  // No fingerprint (a property keyed by subject+property alone): the first
  // stored value wins, matching the pre-`entries` single-value behavior.
  if (input.inputFingerprint === undefined) {
    return entries[0]?.value;
  }
  const match = entries.find(
    (entry) => entry.inputFingerprint === input.inputFingerprint,
  );
  if (match !== undefined) {
    return match.value;
  }
  // A legacy seed carries a value but no fingerprint; the seed corresponds to
  // the source data being imported, so its value is this input's value. Adopt it
  // under the current fingerprint (so a later input change re-resolves) and serve.
  const legacy = entries.find((entry) => entry.inputFingerprint === undefined);
  if (legacy !== undefined) {
    await persistEntries(input.rootDir, input, [
      ...fingerprintedEntries(entries),
      { inputFingerprint: input.inputFingerprint, value: legacy.value },
    ]);
    return legacy.value;
  }
  return undefined;
}

type ResolvedPropertyEntry = {
  inputFingerprint?: string;
  value: unknown;
  sources?: EntrySources;
};
type FingerprintedEntry = ResolvedPropertyEntry & { inputFingerprint: string };

function fingerprintedEntries(
  entries: ReadonlyArray<ResolvedPropertyEntry>,
): FingerprintedEntry[] {
  return entries.flatMap((entry) =>
    entry.inputFingerprint === undefined
      ? []
      : [
          {
            inputFingerprint: entry.inputFingerprint,
            value: entry.value,
            ...(entry.sources === undefined ? {} : { sources: entry.sources }),
          },
        ],
  );
}

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

function envelopeEntries(spec: {
  entries?: ReadonlyArray<{
    inputFingerprint: string;
    value: unknown;
    sources?: EntrySources;
  }>;
  value?: unknown;
}): ResolvedPropertyEntry[] {
  if (spec.entries !== undefined) {
    return spec.entries.map((entry) => ({
      inputFingerprint: entry.inputFingerprint,
      value: entry.value,
      ...(entry.sources === undefined ? {} : { sources: entry.sources }),
    }));
  }
  return spec.value === undefined ? [] : [{ value: spec.value }];
}

async function persistEntries(
  rootDir: string,
  input: ResolvedPropertyCacheInput,
  entries: ReadonlyArray<FingerprintedEntry>,
): Promise<void> {
  await ResolvedProperty.write(
    resolvedPropertyDirectory(rootDir),
    ResolvedProperty.new({
      metadata: {
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
  const existing =
    existingEnvelope === undefined
      ? []
      : envelopeEntries(existingEnvelope.spec);

  // A property with no fingerprint keeps the single legacy value (subject+property
  // is the whole key); it is written once and never changes for a given subject.
  if (input.inputFingerprint === undefined) {
    if (existing[0] !== undefined) {
      if (stableJson(existing[0].value) !== stableJson(input.value)) {
        throw new Error(
          `ResolvedProperty ${resolvedPropertyCacheName(input)} already has a different value.`,
        );
      }
      return;
    }
    await ResolvedProperty.write(
      resolvedPropertyDirectory(input.rootDir),
      ResolvedProperty.new({
        metadata: {
          name: resolvedPropertyCacheName(input),
          namespace: "intake",
        },
        spec: {
          subject: input.subject,
          targetProperty: input.targetProperty,
          value: input.value,
        },
      }),
    );
    return;
  }

  const fingerprint = input.inputFingerprint;
  // Keep every prior fingerprinted entry (N inputs → N values); a legacy
  // no-fingerprint value is dropped, superseded by this keyed entry.
  const others = fingerprintedEntries(existing).filter(
    (entry) => entry.inputFingerprint !== fingerprint,
  );
  const priorSameInput = existing.find(
    (entry) => entry.inputFingerprint === fingerprint,
  );
  if (
    priorSameInput !== undefined &&
    // The resolver is deterministic on its input: the same fingerprint must
    // produce the same value, so a mismatch is a bug, not a second entry.
    stableJson(priorSameInput.value) !== stableJson(input.value)
  ) {
    throw new Error(
      `ResolvedProperty ${resolvedPropertyCacheName(input)} already has a different value for the same input.`,
    );
  }
  const sources = mergedSources(priorSameInput?.sources, input.source);
  await persistEntries(input.rootDir, input, [
    ...others,
    {
      inputFingerprint: fingerprint,
      value: input.value,
      ...(sources === undefined ? {} : { sources }),
    },
  ]);
}
