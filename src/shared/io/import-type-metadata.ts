// The importable artifact kinds and their metadata are GENERATED from the entity
// descriptors (kind/entityName naming + the database's FK dependency graph), so
// they can never drift from the entity specs. This module re-exports them
// alongside the operation constants (which are not entity-derived).
import {
  IMPORT_ARTIFACT_KINDS,
  importTypeMetadata,
} from "./generated/entity-specs.js";
import type {
  ImportArtifactKind,
  ImportEntityName,
} from "./generated/entity-specs.js";

export { IMPORT_ARTIFACT_KINDS, importTypeMetadata };
export type { ImportArtifactKind, ImportEntityName };
export {
  IMPORT_OPERATIONS,
  IMPORT_OPERATION_SUFFIXES,
  type ImportOperation,
} from "./import-operations.js";

export type ImportTypeMetadata = {
  kind: ImportArtifactKind;
  recordKind: string;
  entityName: ImportEntityName;
  targetTable?: string;
  dependsOn: readonly ImportArtifactKind[];
};
