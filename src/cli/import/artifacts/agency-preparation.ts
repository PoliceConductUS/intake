import { DataContext } from "./data-context.js";
import {
  type AgencyAddressResolutionOptions,
  resolveImportAddress,
} from "./agency-address-resolution.js";
import { type AgencyFieldResolutionOptions } from "./agency-field-resolution.js";
import type { AgencyRow, ImportRows, ResolvedProperties } from "./transform.js";
import {
  excludedRecordKey,
  type ExcludedRecords,
} from "../../../shared/io/index.js";

export type {
  AgencyCoordinateRequest,
  AgencyCoordinateResolution,
} from "./agency-coordinate-types.js";
export { resolveImportAddress } from "./agency-address-resolution.js";

export type AgencyPreparationOptions = AgencyAddressResolutionOptions &
  AgencyFieldResolutionOptions & {
    resolvedProperties?: ResolvedProperties;
    excludedRecords?: ExcludedRecords;
  };

type AgencyPreparationLogger = {
  debug?(object: Record<string, unknown>, message: string): void;
  info?(object: Record<string, unknown>, message: string): void;
  warn?(object: Record<string, unknown>, message: string): void;
};

/**
 * An agency row dropped from the import because its `(Agency, sourceKey)` is
 * listed in the source's `excluded.yaml`, carrying the documented reason.
 * Excluded agencies are removed from `rows.agencies` before any resolution
 * (geocoding, location-path lookup) is attempted, so they are never
 * resolved. Every OTHER agency row that fails to resolve is fatal: it is
 * collected into `PrepareAgencyRowsResult.errors`, which aborts the import
 * (see `DatabaseMutationPlanningError` in plan-database-mutations.ts).
 */
export type ExcludedAgency = {
  rowId: string;
  sourceName?: string;
  name?: string;
  reason: string;
};

export type PrepareAgencyRowsResult = {
  errors: string[];
  excluded: ExcludedAgency[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `sourceKey (name)` (or just `sourceKey` when there is no name) — used so
 * every fatal agency-preparation error names the source record, not just an
 * opaque canonical id. */
function agencyErrorLabel(agency: {
  id: string;
  sourceName?: string;
  name?: string;
}): string {
  const sourceKey = agency.sourceName ?? agency.id;
  return agency.name !== undefined && agency.name.trim().length > 0
    ? `${sourceKey} (${agency.name})`
    : sourceKey;
}

function partitionExcludedAgencies(
  agencies: readonly AgencyRow[],
  excludedRecords: ExcludedRecords | undefined,
): { kept: AgencyRow[]; excluded: ExcludedAgency[] } {
  if (excludedRecords === undefined || excludedRecords.size === 0) {
    return { kept: [...agencies], excluded: [] };
  }

  const kept: AgencyRow[] = [];
  const excluded: ExcludedAgency[] = [];
  for (const agency of agencies) {
    const excludedRecord =
      agency.sourceName === undefined
        ? undefined
        : excludedRecords.get(excludedRecordKey("Agency", agency.sourceName));
    if (excludedRecord === undefined) {
      kept.push(agency);
      continue;
    }
    excluded.push({
      rowId: agency.id,
      sourceName: agency.sourceName,
      name: agency.name,
      reason: excludedRecord.reason,
    });
  }
  return { kept, excluded };
}

export async function prepareAgencyRows(
  rows: ImportRows,
  context: DataContext,
  logger?: AgencyPreparationLogger,
  excludedRecords?: ExcludedRecords,
): Promise<PrepareAgencyRowsResult> {
  const errors: string[] = [];

  // Drop excluded agencies before any resolution is attempted (geocoding,
  // location-path lookup) so excluded rows are never resolved, not merely
  // discarded afterward.
  const { kept, excluded } = partitionExcludedAgencies(
    rows.agencies,
    excludedRecords,
  );
  rows.agencies = kept;

  if (excluded.length > 0) {
    logger?.info?.(
      { entityType: "agency", excludedCount: excluded.length },
      `Excluded ${excluded.length} ${excluded.length === 1 ? "agency row" : "agency rows"} listed in the source's excluded.yaml.`,
    );
    for (const excludedAgency of excluded) {
      logger?.debug?.(
        {
          entityType: "agency",
          rowId: excludedAgency.rowId,
          sourceName: excludedAgency.sourceName,
          name: excludedAgency.name,
          reason: excludedAgency.reason,
        },
        `Excluded agency ${excludedAgency.sourceName ?? excludedAgency.rowId} — ${excludedAgency.reason}`,
      );
    }
  }

  const total = rows.agencies.length;

  if (total > 0) {
    logger?.info?.(
      { entityType: "agency", total },
      `Preparing ${total} ${total === 1 ? "agency row" : "agency rows"}.`,
    );
  }

  for (const [index, agency] of rows.agencies.entries()) {
    const processed = index + 1;
    logger?.debug?.(
      {
        entityType: "agency",
        processed,
        total,
        rowId: agency.id,
        sourceName: agency.sourceName,
        name: agency.name,
      },
      `Preparing agency row ${processed} of ${total}.`,
    );

    try {
      await context.add("agency", agency);
    } catch (error) {
      errors.push(`Agency ${agencyErrorLabel(agency)}: ${errorMessage(error)}`);
    }

    if (total > 0 && (processed === total || processed % 100 === 0)) {
      logger?.info?.(
        {
          entityType: "agency",
          processed,
          total,
          errors: errors.length,
        },
        `Prepared ${processed} of ${total} agency rows.`,
      );
    }
  }

  return { errors, excluded };
}
