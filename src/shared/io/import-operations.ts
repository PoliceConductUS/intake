// The import operations, orthogonal to the entity metadata and derived from
// nothing generated — kept in their own module so importing them never pulls in
// the generated entity specs (which would create a bootstrapping cycle for the
// generator that imports these).
//
// The import emits only these three: Create for new rows, Update for a diffed
// existing row, Read for an idempotent natural-key row that already exists.
// Delete/List were generated but never produced or consumed.
export const IMPORT_OPERATIONS = ["create", "read", "update"] as const;

export type ImportOperation = (typeof IMPORT_OPERATIONS)[number];

export const IMPORT_OPERATION_SUFFIXES = {
  create: "Create",
  read: "Read",
  update: "Update",
} satisfies Record<ImportOperation, string>;
