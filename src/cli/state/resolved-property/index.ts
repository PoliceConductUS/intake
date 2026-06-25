import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { INTAKE_API_VERSION } from "../../../shared/io/import-types.js";
import { yamlResourceFileName } from "../../../shared/io/resource.js";
import { ResolvedProperty } from "./ResolvedProperty.js";

export type ResolvedPropertySubject = {
  apiVersion: typeof INTAKE_API_VERSION;
  kind: string;
  name: string;
};

export type ResolvedPropertySource = {
  namespace: string;
  kind: string;
  name: string;
  inputFingerprint: string;
};

type ResolvedPropertySourceEvidence = Omit<ResolvedPropertySource, "namespace">;

export type ResolvedPropertyCacheInput = {
  subject: ResolvedPropertySubject;
  targetProperty: string;
  source?: ResolvedPropertySource;
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
    "intake",
    "state",
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

function resolvedPropertySources(
  source: ResolvedPropertySource | undefined,
): Record<string, ResolvedPropertySourceEvidence> | undefined {
  if (source === undefined) {
    return undefined;
  }

  return {
    [source.namespace]: {
      kind: source.kind,
      name: source.name,
      inputFingerprint: source.inputFingerprint,
    },
  };
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
  return envelope.spec.value;
}

export async function writeResolvedProperty(
  input: ResolvedPropertyCacheInput & { rootDir?: string; value: unknown },
): Promise<void> {
  if (input.rootDir === undefined) {
    return;
  }

  const filePath = resolvedPropertyPath(input.rootDir, input);
  const existingEnvelope = (await readableResolvedPropertyFile(filePath))
    ? await ResolvedProperty.read(filePath, {
        expectedNamespace: "intake",
      })
    : undefined;
  if (
    existingEnvelope !== undefined &&
    stableJson(existingEnvelope.spec.value) !== stableJson(input.value)
  ) {
    throw new Error(
      `ResolvedProperty ${resolvedPropertyCacheName(input)} already has a different value.`,
    );
  }
  const sources = {
    ...(existingEnvelope?.spec.sources ?? {}),
    ...(resolvedPropertySources(input.source) ?? {}),
  };

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
        ...(Object.keys(sources).length === 0 ? {} : { sources }),
        value: input.value,
      },
    }),
  );
}
