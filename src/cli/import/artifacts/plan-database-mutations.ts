import { DataContext } from "./data-context.js";
import { classifyDatabaseOperations } from "./classify-database-operations.js";
import {
  type AgencyPreparationOptions,
  prepareAgencyRows,
  resolveImportAddress,
} from "./agency-preparation.js";
import { validatePreparedNewSlugConflicts } from "./validate-new-slug-conflicts.js";
import type {
  DatabaseClient,
  DatabaseClientFactory,
} from "../../database/index.js";
import { defaultDatabaseClientFactory } from "../../database/index.js";
import {
  readLocationPathAliases,
  readLocationPaths,
} from "../../database/location-paths.js";
import { readDatabaseRecordsByIds } from "../../database/entities.js";
import {
  type ImportDatabaseSchema,
  loadDatabaseSchemaMetadata,
} from "../../database/schema.js";
import type { ImportRows } from "./transform.js";
import type { DatabaseRowOperations } from "./operations.js";
import type { SourceNameToCanonicalIds } from "../../state/source-name-to-canonical-id/index.js";

export type { DatabaseClient };
export type {
  AgencyCoordinateRequest,
  AgencyCoordinateResolution,
} from "./agency-preparation.js";

export type ImportRowCounts = {
  locationPaths: number;
  locationPathGeometries: number;
  locationPathAliases: number;
  agencies: number;
  officers: number;
  agencyOfficers: number;
};

export type PlanDatabaseMutationsResult = {
  counts: ImportRowCounts;
  operations: DatabaseRowOperations;
  schema: ImportDatabaseSchema;
};

export class DatabaseMutationPlanningError extends Error {
  readonly rows: ImportRows;
  readonly errors: readonly string[];
  readonly schema: ImportDatabaseSchema;

  constructor(
    rows: ImportRows,
    errors: readonly string[],
    schema: ImportDatabaseSchema,
  ) {
    super(
      [
        `Import preparation failed with ${errors.length} ${errors.length === 1 ? "error" : "errors"}:`,
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
    this.name = "DatabaseMutationPlanningError";
    this.rows = rows;
    this.errors = errors;
    this.schema = schema;
  }
}

type PlanDatabaseMutationsOptions = AgencyPreparationOptions & {
  env?: Record<string, string | undefined>;
  clientFactory?: DatabaseClientFactory;
  sourceNameToCanonicalIds?: SourceNameToCanonicalIds;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function closeClient(client: DatabaseClient): Promise<void> {
  try {
    await client.end();
  } catch {
    // The original connection or write error is the actionable failure.
  }
}

export async function planDatabaseMutations(
  rows: ImportRows,
  options: PlanDatabaseMutationsOptions = {},
): Promise<PlanDatabaseMutationsResult> {
  rows.preparationMutations = [];
  const databaseUrl = (options.env ?? process.env).DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL is required to plan database mutations.");
  }

  const client = (options.clientFactory ?? defaultDatabaseClientFactory)(
    databaseUrl,
  );

  try {
    await client.connect();
    await client.query("select 1");
  } catch (error) {
    await closeClient(client);
    throw new Error(`Database connection failed: ${errorMessage(error)}`);
  }

  let operations: DatabaseRowOperations | undefined;
  let schema: ImportDatabaseSchema | undefined;

  try {
    await client.query("begin");
    const { importSchema } = await loadDatabaseSchemaMetadata(client);
    schema = importSchema;
    const databaseLocationPaths = await readLocationPaths(client);
    const databaseLocationPathAliases = await readLocationPathAliases(client);
    const databaseAgencies = await readDatabaseRecordsByIds(
      client,
      "public.agency",
      rows.agencies.map((agency) => agency.id),
    );
    const context = new DataContext({
      client,
      rows,
      logger: options.logger,
      databaseLocationPaths,
      databaseLocationPathAliases,
      databaseAgencies,
      sourceNameToCanonicalIds: options.sourceNameToCanonicalIds,
      agencyFieldResolutionOptions: options,
      resolvedProperties: options.resolvedProperties,
      resolveAddress: (input) => resolveImportAddress(input, options),
      resolveAdministrativeArea: options.resolveLocationAdministrativeArea,
    });

    const preparationErrors = [
      ...(await prepareAgencyRows(rows, context, options.logger)),
      ...context.validatePreparedRows(),
      ...(await validatePreparedNewSlugConflicts(client, rows)),
    ];
    if (preparationErrors.length > 0) {
      options.logger?.info?.(
        { errorCount: preparationErrors.length },
        "Database row preparation failed.",
      );
      throw new DatabaseMutationPlanningError(
        rows,
        preparationErrors,
        importSchema,
      );
    }

    operations = await classifyDatabaseOperations(
      client,
      rows,
      databaseLocationPaths,
      context.toImportOperations() as DatabaseRowOperations,
    );

    await client.query("rollback");
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the write failure that triggered the rollback attempt.
    }
    if (error instanceof DatabaseMutationPlanningError) {
      throw error;
    }
    throw new Error(
      `Database mutation planning failed: ${errorMessage(error)}`,
    );
  } finally {
    await closeClient(client);
  }

  if (operations === undefined || schema === undefined) {
    throw new Error(
      "Database mutation planning failed before operations were resolved.",
    );
  }

  return {
    counts: {
      locationPaths: rows.locationPaths.length,
      locationPathGeometries: rows.locationPathGeometries?.length ?? 0,
      locationPathAliases: rows.locationPathAliases.length,
      agencies: rows.agencies.length,
      officers: rows.officers.length,
      agencyOfficers: rows.agencyOfficers.length,
    },
    operations,
    schema,
  };
}
