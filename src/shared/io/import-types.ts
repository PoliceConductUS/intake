import type { z } from "zod";
import {
  IMPORT_ARTIFACT_KINDS,
  IMPORT_OPERATION_SUFFIXES,
  IMPORT_OPERATIONS,
  type ImportArtifactKind,
  type ImportEntityName,
  type ImportOperation,
  importTypeMetadata,
  type ImportTypeMetadata,
} from "./import-type-metadata.js";
import { ARTIFACT_MODULES } from "./generated/artifact-modules.js";

export { IMPORT_ARTIFACT_KINDS };
export type { ImportArtifactKind, ImportEntityName };

export { INTAKE_API_VERSION } from "./intake-api-version.js";

export { IMPORT_OPERATIONS, IMPORT_OPERATION_SUFFIXES };
export type { ImportOperation };

export type ImportTypeDefinition = ImportTypeMetadata & {
  recordSchema: z.ZodType<Record<string, unknown>>;
};

const recordSchemas = Object.fromEntries(
  IMPORT_ARTIFACT_KINDS.map((kind) => [
    kind,
    ARTIFACT_MODULES[kind].recordSpec,
  ]),
) as unknown as Record<ImportArtifactKind, z.ZodType<Record<string, unknown>>>;

// Derived from the generated kinds so a new entity is picked up automatically —
// each kind's metadata plus its record schema, no per-kind enumeration.
export const importTypeRegistry = Object.fromEntries(
  IMPORT_ARTIFACT_KINDS.map((kind) => [
    kind,
    { ...importTypeMetadata[kind], recordSchema: recordSchemas[kind] },
  ]),
) as unknown as Record<ImportArtifactKind, ImportTypeDefinition>;

function visitImportKind(
  kind: ImportArtifactKind,
  visiting: Set<ImportArtifactKind>,
  visited: Set<ImportArtifactKind>,
  order: ImportArtifactKind[],
): void {
  if (visited.has(kind)) {
    return;
  }
  if (visiting.has(kind)) {
    throw new Error(`Import type dependency cycle includes ${kind}.`);
  }
  visiting.add(kind);
  for (const dependency of importTypeRegistry[kind].dependsOn) {
    visitImportKind(dependency, visiting, visited, order);
  }
  visiting.delete(kind);
  visited.add(kind);
  order.push(kind);
}

export function importArtifactKindOrder(): ImportArtifactKind[] {
  const order: ImportArtifactKind[] = [];
  const visited = new Set<ImportArtifactKind>();
  for (const kind of IMPORT_ARTIFACT_KINDS) {
    visitImportKind(kind, new Set(), visited, order);
  }
  return order;
}

const orderIndex = new Map(
  importArtifactKindOrder().map((kind, index) => [kind, index]),
);

export function compareImportArtifactKinds(
  left: ImportArtifactKind,
  right: ImportArtifactKind,
): number {
  return orderIndex.get(left)! - orderIndex.get(right)!;
}

export function sourceNameForImportRecord(
  recordName: string,
  _record: unknown,
): string {
  return recordName;
}

export function mutationKindForRecordKind(
  operation: ImportOperation,
  recordKind: string,
): string {
  return `${recordKind}${IMPORT_OPERATION_SUFFIXES[operation]}`;
}

export function parseMutationKind(mutationKind: string): {
  operation: ImportOperation;
  recordKind: string;
} {
  for (const [operation, suffix] of Object.entries(
    IMPORT_OPERATION_SUFFIXES,
  ) as [ImportOperation, string][]) {
    if (mutationKind.endsWith(suffix) && mutationKind.length > suffix.length) {
      return {
        operation,
        recordKind: mutationKind.slice(0, -suffix.length),
      };
    }
  }
  throw new Error(`Unsupported DatabaseMutation kind: ${mutationKind}`);
}

export const IMPORT_MUTATION_KINDS = Object.values(importTypeRegistry).flatMap(
  (definition) =>
    IMPORT_OPERATIONS.map((operation) =>
      mutationKindForRecordKind(operation, definition.recordKind),
    ),
) as [string, ...string[]];
