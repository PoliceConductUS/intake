export type ImportOperation = "create" | "read" | "update" | "delete" | "list";

export type ImportOperations = {
  locationPaths: Record<string, ImportOperation>;
  locationPathGeometries: Record<string, ImportOperation>;
  locationPathAliases: Record<string, ImportOperation>;
  agencies: Record<string, ImportOperation>;
  officers: Record<string, ImportOperation>;
  agencyOfficers: Record<string, ImportOperation>;
};

export type SuppressedSkipEntity = "agency" | "personnel" | "agencyPersonnel";

/**
 * One record the import declined to update because a subject it touches is
 * under an active suppression.
 *
 * Without this, the demotion in classifyDatabaseOperations is indistinguishable
 * from "this record had nothing to write": both land on `read`. An honoured
 * takedown has to be legible in the change diff, not inferable from an absence.
 */
export type SuppressedSkip = {
  entity: SuppressedSkipEntity;
  /** Canonical ID of the record whose write was skipped. */
  recordId: string;
  /**
   * Suppressed subject IDs that caused the skip. Usually `[recordId]`, but an
   * agency-personnel link is skipped when the link, the person, or the agency
   * is suppressed, so the identity of the skip is not always the record's own.
   */
  suppressedSubjectIds: readonly string[];
  /** Columns this import owned and would have written. This is the "what changed" that did not. */
  withheldColumns: readonly string[];
};

export type DatabaseRowOperations = {
  locationPaths: Record<string, "create" | "read">;
  locationPathGeometries: Record<string, "create" | "read">;
  locationPathAliases: Record<string, "create" | "read">;
  agencies: Record<string, "create" | "read" | "update">;
  officers: Record<string, "create" | "read" | "update">;
  agencyOfficers: Record<string, "create" | "read" | "update">;
  /**
   * Required, not optional: a consumer that forgets to read this reports a
   * clean import that silently dropped a record. Classification always
   * populates it, empty when nothing was suppressed.
   */
  suppressedSkips: SuppressedSkip[];
};
