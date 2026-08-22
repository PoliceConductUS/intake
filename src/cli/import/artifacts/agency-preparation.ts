import { DataContext } from "./data-context.js";
import { type AgencyAddressResolutionOptions } from "./agency-address-resolution.js";
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

export type AgencyPreparationOptions = AgencyAddressResolutionOptions & {
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
 * (see `DatabaseMutationPlanningError` in mutation-planning-error.ts).
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

  // Agencies are resolved (slug / location_path / coordinates) by the
  // AgencyFacade in the envelope-writing pass, not here (ADR 0016/0019). This
  // pass only partitions excluded agencies; the kept rows stay raw and carry the
  // canonical ids the current-state read and the exclusion cascade need.
  return { errors, excluded };
}
