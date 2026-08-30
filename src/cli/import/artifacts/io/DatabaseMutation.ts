import {
  type ImportOperation,
  parseMutationKind,
} from "../../../../shared/io/import-types.js";
import { importMutationEnvelopeTypes } from "./generated-mutations/index.js";
import type { EnvelopeReadOptions, EnvelopeReadRef } from "./envelope-ref.js";

export type DatabaseMutationEnvelope = {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec: Record<string, unknown>;
};

type DatabaseMutationEnvelopeType = {
  read(
    pathOrRef: string | EnvelopeReadRef,
    options?: EnvelopeReadOptions,
  ): Promise<DatabaseMutationEnvelope>;
};

export function parseDatabaseMutationKind(kind: string): {
  operation: ImportOperation;
  recordKind: string;
} {
  return parseMutationKind(kind);
}

function kindFromEnvelopeFileName(filePath: string): string | undefined {
  const fileName = filePath.split(/[\\/]/).at(-1);
  const match = fileName?.match(/^[^.]+\.(.+)\.ya?ml$/);
  return match?.[1];
}

function kindFromReadInput(pathOrRef: string | EnvelopeReadRef): string {
  if (typeof pathOrRef === "string") {
    const kind = kindFromEnvelopeFileName(pathOrRef);
    if (kind === undefined) {
      throw new Error(`DatabaseMutation filename is malformed: ${pathOrRef}`);
    }
    return kind;
  }
  const ref = "ref" in pathOrRef ? pathOrRef.ref : pathOrRef;
  if (ref.kind !== undefined) {
    return ref.kind;
  }
  const kind = kindFromEnvelopeFileName(ref.path);
  if (kind === undefined) {
    throw new Error(`DatabaseMutation filename is malformed: ${ref.path}`);
  }
  return kind;
}

export async function readDatabaseMutation(
  pathOrRef: string | EnvelopeReadRef,
  options: EnvelopeReadOptions = {},
): Promise<DatabaseMutationEnvelope> {
  const kind = kindFromReadInput(pathOrRef);
  const envelopeType = (
    importMutationEnvelopeTypes as Record<
      string,
      DatabaseMutationEnvelopeType | undefined
    >
  )[kind];
  if (envelopeType === undefined) {
    throw new Error(`Unsupported DatabaseMutation kind: ${kind}`);
  }
  return envelopeType.read(pathOrRef, options);
}
