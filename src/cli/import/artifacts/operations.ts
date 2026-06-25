export type ImportOperation = "create" | "read" | "update" | "delete" | "list";

export type ImportOperations = {
  locationPaths: Record<string, ImportOperation>;
  locationPathGeometries: Record<string, ImportOperation>;
  locationPathAliases: Record<string, ImportOperation>;
  agencies: Record<string, ImportOperation>;
  officers: Record<string, ImportOperation>;
  agencyOfficers: Record<string, ImportOperation>;
};

export type DatabaseRowOperations = {
  locationPaths: Record<string, "create" | "read">;
  locationPathGeometries: Record<string, "create" | "read">;
  locationPathAliases: Record<string, "create" | "read">;
  agencies: Record<string, "create" | "read" | "update">;
  officers: Record<string, "create" | "read" | "update">;
  agencyOfficers: Record<string, "create" | "read" | "update">;
};
