import { DataContext } from "./data-context.js";
import { classifyDatabaseOperations } from "./classify-database-operations.js";
import {
  type AgencyPreparationOptions,
  type ExcludedAgency,
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
  licensingAuthorities: number;
  licenses: number;
  licenseActions: number;
};

export type PlanDatabaseMutationsResult = {
  counts: ImportRowCounts;
  operations: DatabaseRowOperations;
  schema: ImportDatabaseSchema;
  /**
   * The already-existing `public.agency` rows (by canonical id) loaded during
   * preparation, so the envelope-writing pass classifies create vs update
   * identically to this pass.
   */
  databaseAgencies: Array<Record<string, unknown>>;
};

function formatPlanningErrors(errors: readonly string[]): string[] {
  // Unanchored: agency-preparation errors are prefixed with the source
  // agency's key/name (`Agency <sourceKey> (<name>): ...`) so this pattern
  // is matched as a substring rather than the whole error string.
  const missingCachedLocationPath = errors.filter((error) =>
    /Cached location_path_id \S+ for public\.agency \S+ does not exist\./.test(
      error,
    ),
  );
  const otherErrors = errors.filter(
    (error) => !missingCachedLocationPath.includes(error),
  );
  if (missingCachedLocationPath.length === 0) {
    return [...errors];
  }

  const examples = missingCachedLocationPath
    .slice(0, 10)
    .map((error) => `  - ${error}`);
  return [
    ...otherErrors,
    [
      `${missingCachedLocationPath.length} cached agency location_path_id values do not exist in the current database.`,
      "This usually means the location hierarchy import has not been applied to this database, or intake state contains location_path_id cache values from a different database reset.",
      "Import or replay the current census LocationPath data first, or remove the stale location_path_id ResolvedProperty envelopes so they can be recomputed.",
      "Examples:",
      ...examples,
    ].join("\n"),
  ];
}

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
        ...formatPlanningErrors(errors).map((error) => `- ${error}`),
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

/**
 * Cascades an excluded-agency drop to any agency_officers rows that
 * reference it, preserving referential integrity. `prepareAgencyRows` has
 * already removed the excluded agencies themselves from `rows.agencies`
 * (before resolution was attempted); this only handles the dependent
 * agency_officers rows and its own summary log line. Personnel/officer rows
 * are unaffected.
 */
function dropExcludedAgencyDependents(
  rows: ImportRows,
  excluded: readonly ExcludedAgency[],
  logger?: {
    warn?(object: Record<string, unknown>, message: string): void;
  },
): void {
  if (excluded.length === 0) {
    return;
  }

  const excludedAgencyIds = new Set(excluded.map((agency) => agency.rowId));
  rows.agencies = rows.agencies.filter(
    (agency) => !excludedAgencyIds.has(agency.id),
  );

  const agencyOfficersBeforeCascade = rows.agencyOfficers.length;
  rows.agencyOfficers = rows.agencyOfficers.filter(
    (agencyOfficer) => !excludedAgencyIds.has(agencyOfficer.agency_id),
  );
  const droppedAgencyOfficerCount =
    agencyOfficersBeforeCascade - rows.agencyOfficers.length;

  if (droppedAgencyOfficerCount > 0) {
    logger?.warn?.(
      {
        entityType: "agencyOfficer",
        droppedCount: droppedAgencyOfficerCount,
        excludedAgencyIds: [...excludedAgencyIds].sort(),
      },
      `Dropped ${droppedAgencyOfficerCount} ${droppedAgencyOfficerCount === 1 ? "agency-officer row" : "agency-officer rows"} referencing excluded agencies.`,
    );
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
  // Hoisted so the already-existing agency records can be handed to the
  // envelope-writing DataContext, which must agree with this preparation pass
  // on which agencies exist (otherwise an existing agency is treated as a create).
  let databaseAgencies: Array<Record<string, unknown>> = [];

  try {
    await client.query("begin");
    const { importSchema } = await loadDatabaseSchemaMetadata(client);
    schema = importSchema;
    const databaseLocationPaths = await readLocationPaths(client);
    const databaseLocationPathAliases = await readLocationPathAliases(client);
    databaseAgencies = await readDatabaseRecordsByIds(
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

    const agencyPreparationResult = await prepareAgencyRows(
      rows,
      context,
      options.logger,
      options.excludedRecords,
    );
    dropExcludedAgencyDependents(
      rows,
      agencyPreparationResult.excluded,
      options.logger,
    );

    const preparationErrors = [
      ...agencyPreparationResult.errors,
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
      licensingAuthorities: rows.licensingAuthorities?.length ?? 0,
      licenses: rows.licenses?.length ?? 0,
      licenseActions: rows.licenseActions?.length ?? 0,
    },
    operations,
    schema,
    databaseAgencies,
  };
}
