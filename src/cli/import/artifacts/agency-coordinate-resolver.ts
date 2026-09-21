import { parse as parseCsv } from "csv-parse/sync";
import type {
  AgencyCoordinateRequest,
  AgencyCoordinateResolution,
} from "./agency-coordinate-types.js";

const CENSUS_BATCH_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const CENSUS_GEOGRAPHIES_ADDRESS_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/address";
const BATCH_SIZE = 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type FetchLike = typeof fetch;

type CensusCoordinateResolverOptions = {
  requestTimeoutMs?: number;
  onProgress?: (
    event:
      | {
          stage: "batch";
          batchIndex: number;
          batchCount: number;
          batchSize: number;
          total: number;
        }
      | {
          stage: "unresolved";
          attempted: number;
          total: number;
          rowId: string;
        },
  ) => void;
};

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function zip5(value: string): string {
  return value.trim().slice(0, 5);
}

function normalizeGeocodingStreetAddress(address: string): string {
  const physicalLine = address
    .split(/\r?\n|,/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .find(
      (line) =>
        line.length > 0 && !/\b(?:p\.?\s*o\.?|post office)\s+box\b/i.test(line),
    );

  return physicalLine ?? address.replace(/\s+/g, " ").trim();
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];
}

function failureDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const connection = error as Error & Record<string, unknown>;
  const details = [error.message || error.name];
  for (const key of [
    "code",
    "errno",
    "syscall",
    "hostname",
    "address",
    "port",
  ]) {
    if (connection[key] !== undefined)
      details.push(`${key}=${String(connection[key])}`);
  }
  if (error.cause !== undefined)
    details.push(`cause: ${failureDetails(error.cause)}`);
  if (error instanceof AggregateError)
    details.push(...error.errors.map(failureDetails));
  return details.join("; ");
}

async function requestCensus<T>(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  requests: AgencyCoordinateRequest[],
  readResponse: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok)
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await readResponse(response);
  } catch (error) {
    const reason = controller.signal.aborted
      ? `timed out after ${timeoutMs} ms; ${failureDetails(error)}`
      : failureDetails(error);
    throw new Error(
      `Census geocoder request failed: ${init?.method ?? "GET"} ${url}; agencies=${JSON.stringify(requests)}; ${reason}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function coordinateResolutionFromCensusPayload(
  rowId: string,
  payload: unknown,
): AgencyCoordinateResolution | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const result = (payload as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) {
    return undefined;
  }

  for (const match of asRecords(
    (result as { addressMatches?: unknown }).addressMatches,
  )) {
    const coordinates = match.coordinates;
    if (typeof coordinates !== "object" || coordinates === null) {
      continue;
    }

    const latitude = Number((coordinates as Record<string, unknown>).y);
    const longitude = Number((coordinates as Record<string, unknown>).x);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { rowId, latitude, longitude };
    }
  }

  return undefined;
}

async function resolveBatch(
  requests: AgencyCoordinateRequest[],
  fetchFn: FetchLike,
  requestTimeoutMs: number,
): Promise<AgencyCoordinateResolution[]> {
  const csv = requests
    .map((request) =>
      [
        request.rowId,
        normalizeGeocodingStreetAddress(request.address),
        request.city,
        request.state,
        zip5(request.zipCode),
      ]
        .map(csvEscape)
        .join(","),
    )
    .join("\n");

  const form = new FormData();
  form.set("benchmark", "Public_AR_Current");
  form.set(
    "addressFile",
    new Blob([csv], { type: "text/csv" }),
    "agencies.csv",
  );

  const body = await requestCensus(
    fetchFn,
    CENSUS_BATCH_URL,
    {
      body: form,
      method: "POST",
    },
    requestTimeoutMs,
    requests,
    (response) => response.text(),
  );

  const rows = parseCsv(body, {
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as string[][];
  return rows.flatMap((row): AgencyCoordinateResolution[] => {
    const [rowId, , matchStatus, , , coordinates] = row;
    if (rowId === undefined || matchStatus !== "Match" || !coordinates) {
      return [];
    }

    const [longitudeText, latitudeText] = coordinates.split(",");
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return [];
    }

    return [{ rowId, latitude, longitude }];
  });
}

async function resolveSingleAddress(
  request: AgencyCoordinateRequest,
  fetchFn: FetchLike,
  requestTimeoutMs: number,
): Promise<AgencyCoordinateResolution | undefined> {
  const parameters = new URLSearchParams({
    street: normalizeGeocodingStreetAddress(request.address),
    city: request.city,
    state: request.state,
    zip: zip5(request.zipCode),
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    format: "json",
  });

  return requestCensus(
    fetchFn,
    `${CENSUS_GEOGRAPHIES_ADDRESS_URL}?${parameters.toString()}`,
    undefined,
    requestTimeoutMs,
    [request],
    async (response) =>
      coordinateResolutionFromCensusPayload(
        request.rowId,
        await response.json(),
      ),
  );
}

export function createCensusAgencyCoordinateResolver(
  fetchFn: FetchLike = fetch,
  options: CensusCoordinateResolverOptions = {},
): (
  requests: AgencyCoordinateRequest[],
) => Promise<AgencyCoordinateResolution[]> {
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return async (requests) => {
    const canonical: AgencyCoordinateResolution[] = [];
    const batchCount = Math.ceil(requests.length / BATCH_SIZE);
    for (let index = 0; index < requests.length; index += BATCH_SIZE) {
      const batch = requests.slice(index, index + BATCH_SIZE);
      options.onProgress?.({
        stage: "batch",
        batchIndex: Math.floor(index / BATCH_SIZE) + 1,
        batchCount,
        batchSize: batch.length,
        total: requests.length,
      });
      const batchCoordinateResolutions = await resolveBatch(
        batch,
        fetchFn,
        requestTimeoutMs,
      );
      canonical.push(...batchCoordinateResolutions);

      const resolvedRowIds = new Set(
        batchCoordinateResolutions.map((resolution) => resolution.rowId),
      );
      const unresolvedRequests = batch.filter(
        (request) => !resolvedRowIds.has(request.rowId),
      );
      for (const [unresolvedIndex, request] of unresolvedRequests.entries()) {
        options.onProgress?.({
          stage: "unresolved",
          attempted: unresolvedIndex + 1,
          total: unresolvedRequests.length,
          rowId: request.rowId,
        });
        const resolution = await resolveSingleAddress(
          request,
          fetchFn,
          requestTimeoutMs,
        );
        if (resolution !== undefined) {
          canonical.push(resolution);
        }
      }
    }
    return canonical;
  };
}
