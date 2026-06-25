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
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function prepareAgencyRows(
  rows: ImportRows,
  context: DataContext,
  logger?: AgencyPreparationLogger,
): Promise<string[]> {
  const errors: string[] = [];
  const seenErrors = new Set<string>();
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
      if (!seenErrors.has(message)) {
        seenErrors.add(message);
        errors.push(message);
      }
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

  return errors;
}
