import { DataContext } from "./data-context.js";
import {
  type AgencyAddressResolutionOptions,
  resolveImportAddress,
} from "./agency-address-resolution.js";
import { type AgencyFieldResolutionOptions } from "./agency-field-resolution.js";
import type { ImportRows, ResolvedProperties } from "./transform.js";

export type {
  AgencyCoordinateRequest,
  AgencyCoordinateResolution,
} from "./agency-coordinate-types.js";
export { resolveImportAddress } from "./agency-address-resolution.js";

export type AgencyPreparationOptions = AgencyAddressResolutionOptions &
  AgencyFieldResolutionOptions & {
    resolvedProperties?: ResolvedProperties;
  };

type AgencyPreparationLogger = {
  debug?(object: Record<string, unknown>, message: string): void;
  info?(object: Record<string, unknown>, message: string): void;
  warn?(object: Record<string, unknown>, message: string): void;
};

/**
 * An agency row that could not be resolved (coordinates and/or
 * location_path_id) even after the place -> county -> state containment
 * fallback. The agency is excluded from the import rather than aborting the
 * whole run; agency_officers rows that reference it are cascaded out
 * separately (see `excludeSkippedAgencies`).
 */
export type SkippedAgency = {
  rowId: string;
  sourceName?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  reason: string;
};

export type PrepareAgencyRowsResult = {
  errors: string[];
  skipped: SkippedAgency[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function prepareAgencyRows(
  rows: ImportRows,
  context: DataContext,
  logger?: AgencyPreparationLogger,
): Promise<PrepareAgencyRowsResult> {
  // `errors` is currently always empty: every per-agency resolution failure
  // from `context.add("agency", ...)` below is now treated as skippable
  // (Fix 2 — tolerant skip) rather than fatal. It is kept in the result
  // shape so callers (and `DatabaseMutationPlanningError`) keep working if a
  // future non-skippable failure mode is added here.
  const errors: string[] = [];
  const skipped: SkippedAgency[] = [];
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
      const message = errorMessage(error);
      const skippedAgency: SkippedAgency = {
        rowId: agency.id,
        sourceName: agency.sourceName,
        name: agency.name,
        address: agency.address ?? undefined,
        city: agency.city ?? undefined,
        state: agency.state,
        zipCode: agency.zip_code ?? undefined,
        reason: message,
      };
      skipped.push(skippedAgency);
      logger?.warn?.(
        {
          entityType: "agency",
          rowId: skippedAgency.rowId,
          sourceName: skippedAgency.sourceName,
          name: skippedAgency.name,
          address: skippedAgency.address,
          city: skippedAgency.city,
          state: skippedAgency.state,
          zipCode: skippedAgency.zipCode,
          reason: message,
        },
        `Skipping unresolvable agency row ${skippedAgency.sourceName ?? skippedAgency.rowId} (${skippedAgency.name ?? "unknown name"}): ${message}`,
      );
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

  if (skipped.length > 0) {
    logger?.warn?.(
      {
        entityType: "agency",
        skippedCount: skipped.length,
        total,
        skipped: skipped.map((agency) => ({
          rowId: agency.rowId,
          sourceName: agency.sourceName,
          name: agency.name,
          address: agency.address,
          city: agency.city,
          state: agency.state,
          zipCode: agency.zipCode,
          reason: agency.reason,
        })),
      },
      `Skipped ${skipped.length} of ${total} ${total === 1 ? "agency row" : "agency rows"} that could not be resolved; see per-agency warnings above for reasons.`,
    );
  }

  return { errors, skipped };
}
