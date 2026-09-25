import { isDeepStrictEqual } from "node:util";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import * as specs from "./generated/entity-specs.js";
import {
  PropertyCorrection,
  type PropertyCorrectionEnvelope,
} from "./PropertyCorrection.js";
import { yamlResourceFileName } from "./resource.js";

export function correctionPropertySchema(
  kind: string,
  property: string,
): z.ZodType {
  const schema = (specs as Record<string, unknown>)[`${kind}Spec`];
  if (
    !(schema instanceof z.ZodObject) ||
    !Object.hasOwn(schema.shape, property)
  )
    throw new Error(`Unknown property ${kind}.${property}.`);
  return schema.shape[property];
}
const directory = (root: string, namespace: string) =>
  path.join(
    root,
    "state",
    "intake",
    "namespaces",
    encodeURIComponent(namespace),
    "PropertyCorrection",
  );
const nameFor = (kind: string, name: string, property: string) =>
  JSON.stringify([kind, name, property]);
export async function inspectPropertyCorrection(
  root: string,
  namespace: string,
  kind: string,
  sourceId: string,
  property: string,
): Promise<PropertyCorrectionEnvelope | undefined> {
  const name = nameFor(kind, sourceId, property);
  const file = path.join(
    directory(root, namespace),
    yamlResourceFileName(name, "PropertyCorrection"),
  );
  try {
    await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const result = await PropertyCorrection.read(file, {
    expectedNamespace: namespace,
  });
  if (
    result.metadata.name !== name ||
    result.spec.subject.kind !== kind ||
    result.spec.subject.name !== sourceId ||
    result.spec.targetProperty !== property
  )
    throw new Error(`PropertyCorrection identity mismatch: ${name}`);
  return result;
}
export async function setPropertyCorrection(input: {
  rootDir: string;
  namespace: string;
  kind: string;
  sourceId: string;
  property: string;
  from: unknown;
  value: unknown;
  force: boolean;
  commandId: string;
}): Promise<void> {
  const schema = correctionPropertySchema(input.kind, input.property);
  schema.parse(input.value);
  const existing = await inspectPropertyCorrection(
    input.rootDir,
    input.namespace,
    input.kind,
    input.sourceId,
    input.property,
  );
  if (existing !== undefined && !input.force)
    throw new Error(
      `Cache already has a value. Use --force to overwrite. Current cache:\n${JSON.stringify(existing.spec, null, 2)}`,
    );
  const entries = (existing?.spec.entries ?? []).map((entry, index) =>
    entry.inputFingerprint === undefined
      ? { ...entry, inputFingerprint: `previous-override-${index + 1}` }
      : entry,
  );
  await PropertyCorrection.write(
    directory(input.rootDir, input.namespace),
    PropertyCorrection.new({
      metadata: {
        name: nameFor(input.kind, input.sourceId, input.property),
        namespace: input.namespace,
      },
      spec: {
        subject: { kind: input.kind, name: input.sourceId },
        targetProperty: input.property,
        entries: [
          ...entries,
          {
            from: z.json().parse(input.from),
            value: z.json().parse(input.value),
            commandId: input.commandId,
            recordedAt: new Date().toISOString(),
          },
        ],
      },
    }),
  );
}
export type ApplyPropertyCorrections = (
  kind: string,
  sourceId: string,
  spec: Record<string, unknown>,
  applied?: (property: string) => void,
) => Record<string, unknown>;
export async function loadPropertyCorrections(
  root: string | undefined,
  namespace: string,
  log?: (message: string) => void,
): Promise<ApplyPropertyCorrections> {
  if (root === undefined) return (_kind, _id, spec) => spec;
  const dir = directory(root, namespace);
  const files = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const byRecord = new Map<string, PropertyCorrectionEnvelope[]>();
  for (const file of files.sort()) {
    if (!file.endsWith(".PropertyCorrection.yaml")) continue;
    const envelope = await PropertyCorrection.read(path.join(dir, file), {
      expectedNamespace: namespace,
    });
    const { subject, targetProperty, entries } = envelope.spec;
    const expectedName = nameFor(subject.kind, subject.name, targetProperty);
    if (
      envelope.metadata.name !== expectedName ||
      file !== yamlResourceFileName(expectedName, "PropertyCorrection")
    )
      throw new Error(`PropertyCorrection identity mismatch: ${file}`);
    const schema = correctionPropertySchema(subject.kind, targetProperty);
    for (const entry of entries) {
      schema.parse(entry.value);
    }
    const key = JSON.stringify([subject.kind, subject.name]);
    byRecord.set(key, [...(byRecord.get(key) ?? []), envelope]);
  }
  return (kind, sourceId, spec, applied) => {
    const corrections = byRecord.get(JSON.stringify([kind, sourceId]));
    if (corrections === undefined) return spec;
    const result = { ...spec };
    for (const { spec: correction } of corrections) {
      const entry = correction.entries.find(
        (e) => e.inputFingerprint === undefined,
      )!;
      const value = spec[correction.targetProperty];
      const matches =
        entry.from === null
          ? value === null || value === undefined
          : isDeepStrictEqual(value, entry.from);
      if (matches) {
        result[correction.targetProperty] = entry.value;
        applied?.(correction.targetProperty);
        log?.(
          `cache: applied ${namespace}/${kind}/${sourceId}.${correction.targetProperty}: ${JSON.stringify(value ?? null)} → ${JSON.stringify(entry.value)}`,
        );
      } else {
        log?.(
          `cache: condition did not match ${namespace}/${kind}/${sourceId}.${correction.targetProperty}: expected ${JSON.stringify(entry.from)}, input ${JSON.stringify(value)}`,
        );
      }
    }
    return result;
  };
}
