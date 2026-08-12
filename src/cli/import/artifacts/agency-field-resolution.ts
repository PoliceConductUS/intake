import type {
  AgencyCoordinateRequest,
  AgencyCoordinateResolution,
} from "./agency-coordinate-types.js";
import {
  type ResolveAgencyAddressLocationPath,
  resolveAgencyLocationPathId,
} from "./agency-address-resolution.js";
import {
  agencyCoordinateCacheInput,
  cachedAgencyCoordinateResolution,
  writeAgencyCoordinateResolutionCache,
} from "./agency-coordinate-cache.js";
import type { ResolvedPropertyCacheInput } from "../../state/resolved-property/index.js";
import type {
  AgencyRow,
  LocationPathRow,
  PreparationMutation,
  ResolvedAgencyState,
} from "./transform.js";

export type AgencyFieldResolutionOptions = {
  sourceNamespace?: string;
  resolveAgencyCoordinates?: (
    requests: AgencyCoordinateRequest[],
  ) => Promise<AgencyCoordinateResolution[]>;
  resolvedPropertyCache?: {
    read(input: ResolvedPropertyCacheInput): Promise<unknown | undefined>;
    write(
      input: ResolvedPropertyCacheInput & { value: unknown },
    ): Promise<void>;
  };
  logger?: {
    debug?(object: Record<string, unknown>, message: string): void;
    info?(object: Record<string, unknown>, message: string): void;
    warn?(object: Record<string, unknown>, message: string): void;
  };
};

export type AgencyFieldResolutionAdapters = {
  getLocationPathById: (
    locationPathId: string,
  ) => Promise<LocationPathRow | undefined>;
  resolveAddress: ResolveAgencyAddressLocationPath;
};

type AgencyFieldResolutionContext = {
  agencyRows: readonly AgencyRow[];
  adapters: AgencyFieldResolutionAdapters;
};

export type AgencyResolvedPropertyUpdate = {
  rowId: string;
  mutation: ResolvedAgencyState;
};

export type AgencyFieldResolutionResult = {
  preparationMutations: PreparationMutation[];
  resolvedPropertyUpdates: AgencyResolvedPropertyUpdate[];
};

export class AgencyFieldResolutionError extends Error {
  readonly result: AgencyFieldResolutionResult;

  constructor(error: unknown, result: AgencyFieldResolutionResult) {
    super(error instanceof Error ? error.message : String(error));
    this.name = "AgencyFieldResolutionError";
    this.result = result;
  }
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function valueAsFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "record"
  );
}

function canonicalSuffix(id: unknown): string {
  const normalized = String(id)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  return normalized.slice(-6) || "record";
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function agencyCoordinateRequest(
  row: Record<string, unknown>,
): AgencyCoordinateRequest | undefined {
  const rowId = valueAsString(row.id);
  const name = valueAsString(row.name);
  const address = valueAsString(row.address);
  const city = valueAsString(row.city);
  const state = valueAsString(row.state);
  const zipCode = valueAsString(row.zip_code);
  if (
    rowId === undefined ||
    name === undefined ||
    address === undefined ||
    city === undefined ||
    state === undefined ||
    zipCode === undefined
  ) {
    return undefined;
  }

  return {
    rowId,
    sourceName: valueAsString(row.sourceName),
    name,
    address,
    city,
    state,
    zipCode,
  };
}

function coordinateLocationDescription(row: Record<string, unknown>): string {
  const address = valueAsString(row.address);
  const city = valueAsString(row.city);
  const state = valueAsString(row.state);
  const zipCode = valueAsString(row.zip_code);
  const stateAndZip =
    state === undefined
      ? zipCode
      : zipCode === undefined
        ? state
        : `${state} ${zipCode}`;
  return [address, city, stateAndZip]
    .filter((part): part is string => part !== undefined)
    .join(", ");
}

async function cachedLocationPathId(
  row: Record<string, unknown>,
  options: AgencyFieldResolutionOptions,
): Promise<string | undefined> {
  if (options.resolvedPropertyCache === undefined) {
    return undefined;
  }

  const request = agencyCoordinateRequest(row);
  if (request === undefined) {
    return undefined;
  }

  const input = agencyCoordinateCacheInput(
    request,
    "location_path_id",
    options,
  );
  if (input === undefined) {
    return undefined;
  }

  const value = await options.resolvedPropertyCache.read(input);
  return valueAsString(value);
}

async function writeLocationPathIdCache(
  row: Record<string, unknown>,
  locationPathId: string,
  options: AgencyFieldResolutionOptions,
): Promise<void> {
  if (options.resolvedPropertyCache === undefined) {
    return;
  }

  const request = agencyCoordinateRequest(row);
  if (request === undefined) {
    return;
  }

  const input = agencyCoordinateCacheInput(
    request,
    "location_path_id",
    options,
  );
  if (input === undefined) {
    return;
  }

  await options.resolvedPropertyCache.write({
    ...input,
    value: locationPathId,
  });
}

function sharedAgencyMutationForRow(
  row: Record<string, unknown>,
  updates: AgencyResolvedPropertyUpdate[],
): ResolvedAgencyState | undefined {
  const rowId = valueAsString(row.id);
  if (rowId === undefined) {
    return undefined;
  }

  const existing = updates.find((update) => update.rowId === rowId);
  if (existing !== undefined) {
    return existing.mutation;
  }
  const mutation: ResolvedAgencyState = {};
  updates.push({ rowId, mutation });
  return mutation;
}

export async function resolveCachedAgencyLocationPath(
  row: Record<string, unknown>,
  adapters: AgencyFieldResolutionAdapters,
): Promise<AgencyResolvedPropertyUpdate[]> {
  const resolvedPropertyUpdates: AgencyResolvedPropertyUpdate[] = [];
  const locationPathId = valueAsString(row.location_path_id);
  if (locationPathId === undefined) {
    return resolvedPropertyUpdates;
  }
  const originalLocationPathId = locationPathId;
  const cachedLocationPath = await adapters.getLocationPathById(locationPathId);

  if (cachedLocationPath !== undefined) {
    return resolvedPropertyUpdates;
  }

  throw new Error(
    `Cached location_path_id ${originalLocationPathId} for public.agency ${String(row.id)} does not exist.`,
  );
}

type AgencyFieldResolver = {
  fields: readonly string[];
  reason: string;
  resolve: (
    row: Record<string, unknown>,
    context: AgencyFieldResolutionContext,
  ) => Promise<string[]>;
};

function resolverSortOrder(fields: readonly string[]): number {
  if (fields.includes("slug")) {
    return 0;
  }
  if (fields.includes("location_path_id")) {
    return 2;
  }
  if (fields.includes("latitude") || fields.includes("longitude")) {
    return 1;
  }
  return 3;
}

const coordinateBatchByAgencyRows = new WeakMap<
  readonly AgencyRow[],
  Promise<Map<string, AgencyCoordinateResolution>>
>();

function agencyFieldResolvers(
  options: AgencyFieldResolutionOptions,
  resolvedPropertyUpdates: AgencyResolvedPropertyUpdate[],
): Partial<Record<string, AgencyFieldResolver>> {
  const resolveAgencyCoordinateBatch = async (
    context: AgencyFieldResolutionContext,
  ): Promise<Map<string, AgencyCoordinateResolution>> => {
    let agencyCoordinateResolutionPromise = coordinateBatchByAgencyRows.get(
      context.agencyRows,
    );
    if (agencyCoordinateResolutionPromise === undefined) {
      agencyCoordinateResolutionPromise = (async () => {
        if (options.resolveAgencyCoordinates === undefined) {
          return new Map<string, AgencyCoordinateResolution>();
        }

        const requests = context.agencyRows
          .filter(
            (agency) =>
              agency.latitude === undefined ||
              agency.latitude === null ||
              agency.longitude === undefined ||
              agency.longitude === null,
          )
          .map((agency) => agencyCoordinateRequest(agency))
          .filter(
            (request): request is AgencyCoordinateRequest =>
              request !== undefined,
          );

        const cachedEntries = await Promise.all(
          requests.map((request) =>
            cachedAgencyCoordinateResolution(request, options),
          ),
        );
        const cachedByRowId = new Map(
          cachedEntries
            .filter(
              (
                entry,
              ): entry is {
                status: "resolved";
                resolution: AgencyCoordinateResolution;
              } => entry?.status === "resolved",
            )
            .map((entry) => [entry.resolution.rowId, entry.resolution]),
        );
        const uncachedRequests = requests.filter(
          (request) => !cachedByRowId.has(request.rowId),
        );

        if (requests.length === 0) {
          return new Map<string, AgencyCoordinateResolution>();
        }
        if (uncachedRequests.length === 0) {
          return cachedByRowId;
        }

        options.logger?.debug?.(
          {
            entityType: "agency",
            fields: ["latitude", "longitude"],
            requestCount: uncachedRequests.length,
          },
          "Resolving agency fields: latitude, longitude.",
        );

        const resolutions = (
          await options.resolveAgencyCoordinates(uncachedRequests)
        ).filter(
          (resolution) =>
            Number.isFinite(resolution.latitude) &&
            Number.isFinite(resolution.longitude),
        );
        const requestByRowId = new Map(
          uncachedRequests.map((request) => [request.rowId, request]),
        );
        for (const resolution of resolutions) {
          const request = requestByRowId.get(resolution.rowId);
          if (request !== undefined) {
            await writeAgencyCoordinateResolutionCache(
              request,
              resolution,
              options,
            );
          }
        }
        return new Map([
          ...cachedByRowId,
          ...resolutions.map(
            (resolution) => [resolution.rowId, resolution] as const,
          ),
        ]);
      })();
      coordinateBatchByAgencyRows.set(
        context.agencyRows,
        agencyCoordinateResolutionPromise,
      );
    }

    return agencyCoordinateResolutionPromise;
  };

  const addressCoordinateResolver: AgencyFieldResolver = {
    fields: ["latitude", "longitude"],
    reason: "Resolved missing agency address coordinates.",
    resolve: async (row, context) => {
      const rowId = valueAsString(row.id);
      if (rowId === undefined) {
        return [];
      }
      const request = agencyCoordinateRequest(row);
      if (request === undefined) {
        throw new Error(
          `Cannot resolve coordinates for public.agency ${String(row.id)} without id, name, address, city, state, and zip_code.`,
        );
      }

      const resolution = (await resolveAgencyCoordinateBatch(context)).get(
        rowId,
      );
      if (resolution === undefined) {
        throw new Error(
          `Cannot resolve coordinates for public.agency ${rowId} from ${coordinateLocationDescription(row)}.`,
        );
      }

      const resolvedFields: string[] = [];
      if (valueAsFiniteNumber(row.latitude) === undefined) {
        row.latitude = resolution.latitude;
        resolvedFields.push("latitude");
      }
      if (valueAsFiniteNumber(row.longitude) === undefined) {
        row.longitude = resolution.longitude;
        resolvedFields.push("longitude");
      }

      const agencyResolvedProperty = sharedAgencyMutationForRow(
        row,
        resolvedPropertyUpdates,
      );
      if (agencyResolvedProperty !== undefined) {
        if (resolvedFields.includes("latitude")) {
          agencyResolvedProperty.latitude = resolution.latitude;
        }
        if (resolvedFields.includes("longitude")) {
          agencyResolvedProperty.longitude = resolution.longitude;
        }
      }

      return resolvedFields;
    },
  };

  return {
    slug: {
      fields: ["slug"],
      reason: "Resolved missing agency slug from agency name and canonical ID.",
      resolve: async (row) => {
        const name = valueAsString(row.name);
        if (name === undefined) {
          throw new Error(
            `Cannot resolve slug for public.agency ${String(row.id)} without name.`,
          );
        }

        row.slug = `${slugify(name)}-${canonicalSuffix(row.id)}`;
        const agencyResolvedProperty = sharedAgencyMutationForRow(
          row,
          resolvedPropertyUpdates,
        );
        if (agencyResolvedProperty !== undefined) {
          agencyResolvedProperty.slug = row.slug as string;
        }
        return ["slug"];
      },
    },
    location_path_id: {
      fields: ["location_path_id", "latitude", "longitude"],
      reason:
        "Resolved missing agency location path from existing baseline location path or alias.",
      resolve: async (row, context) => {
        const cached = await cachedLocationPathId(row, options);
        if (cached !== undefined) {
          const cachedLocationPath =
            await context.adapters.getLocationPathById(cached);
          if (cachedLocationPath === undefined) {
            throw new Error(
              `Cached location_path_id ${cached} for public.agency ${String(row.id)} does not exist.`,
            );
          }
          row.location_path_id = cached;
        } else {
          row.location_path_id = await resolveAgencyLocationPathId(
            row,
            context.adapters.resolveAddress,
          );
          await writeLocationPathIdCache(
            row,
            row.location_path_id as string,
            options,
          );
        }
        const agencyResolvedProperty = sharedAgencyMutationForRow(
          row,
          resolvedPropertyUpdates,
        );
        if (agencyResolvedProperty !== undefined) {
          agencyResolvedProperty.locationPathId =
            row.location_path_id as string;
          if (Number.isFinite(row.latitude)) {
            agencyResolvedProperty.latitude = row.latitude as number;
          }
          if (Number.isFinite(row.longitude)) {
            agencyResolvedProperty.longitude = row.longitude as number;
          }
        }
        return ["location_path_id", "latitude", "longitude"].filter(
          (fieldName) =>
            row[fieldName] !== undefined && row[fieldName] !== null,
        );
      },
    },
    latitude: addressCoordinateResolver,
    longitude: addressCoordinateResolver,
  };
}

export function missingResolvableAgencyFields(
  row: Record<string, unknown>,
): string[] {
  return ["slug", "location_path_id", "latitude", "longitude"].filter(
    (fieldName) => row[fieldName] === undefined || row[fieldName] === null,
  );
}

export async function resolveAgencyMissingFields(
  row: Record<string, unknown>,
  missingColumns: readonly string[],
  context: AgencyFieldResolutionContext,
  options: AgencyFieldResolutionOptions,
): Promise<AgencyFieldResolutionResult> {
  const resolvedPropertyUpdates: AgencyResolvedPropertyUpdate[] = [];
  const resolvers = agencyFieldResolvers(options, resolvedPropertyUpdates);
  const preparationMutations: PreparationMutation[] = [];
  const selectedResolvers = uniqueValues(
    missingColumns.filter((columnName) => resolvers[columnName] !== undefined),
  )
    .map((columnName) => resolvers[columnName])
    .filter(
      (resolver, index, allResolvers): resolver is AgencyFieldResolver =>
        resolver !== undefined && allResolvers.indexOf(resolver) === index,
    )
    .sort(
      (left, right) =>
        resolverSortOrder(left.fields) - resolverSortOrder(right.fields),
    );

  if (selectedResolvers.length === 0) {
    return { preparationMutations, resolvedPropertyUpdates };
  }

  options.logger?.debug?.(
    {
      entityType: "agency",
      rowId: row.id,
      missingFields: missingColumns,
    },
    `Resolving agency fields: ${missingColumns.join(", ")}.`,
  );

  for (const resolver of selectedResolvers) {
    const beforeMissing = new Set(
      resolver.fields.filter(
        (fieldName) => row[fieldName] === undefined || row[fieldName] === null,
      ),
    );
    let resolvedFields;
    try {
      resolvedFields = (await resolver.resolve(row, context)).filter(
        (fieldName) => beforeMissing.has(fieldName),
      );
    } catch (error) {
      throw new AgencyFieldResolutionError(error, {
        preparationMutations,
        resolvedPropertyUpdates,
      });
    }
    if (resolvedFields.length > 0) {
      for (const fieldName of resolvedFields) {
        preparationMutations.push({
          action: "set",
          entityType: "agency",
          rowId: String(row.id),
          ...(valueAsString(row.sourceName) === undefined
            ? {}
            : { sourceName: valueAsString(row.sourceName) }),
          path: fieldName,
          value: row[fieldName],
          reason: resolver.reason,
        });
      }
      options.logger?.debug?.(
        {
          tableName: "public.agency",
          entityType: "agency",
          rowId: row.id,
          sourceName: valueAsString(row.sourceName),
          resolvedFields,
        },
        `Resolved agency fields: ${resolvedFields.join(", ")}.`,
      );
    }
  }

  return { preparationMutations, resolvedPropertyUpdates };
}
