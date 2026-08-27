import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import {
  IMPORT_ARTIFACT_KINDS,
  importTypeMetadata,
} from "../../src/shared/io/import-type-metadata.js";

// The record kinds the interview offers today. The interview and emission are
// entirely model-driven (ADR 0031); a source's produces must be static for run
// ordering, so the handled set is declared here — add a kind to extend coverage,
// no new interview code. Canonical-identity updates are out of scope for now.
export const HANDLED_RECORD_KINDS = ["LocationPathAlias"] as const;

/** The import artifact kind (plural) that carries a given record kind. */
export function artifactKindFor(recordKind: string): ImportArtifactKind {
  const kind = IMPORT_ARTIFACT_KINDS.find(
    (candidate) => importTypeMetadata[candidate].recordKind === recordKind,
  );
  if (kind === undefined) {
    throw new Error(
      `org.policeconduct.manual: no artifact kind produces record kind ${recordKind}.`,
    );
  }
  return kind;
}

export const PRODUCES: readonly ImportArtifactKind[] =
  HANDLED_RECORD_KINDS.map(artifactKindFor);
