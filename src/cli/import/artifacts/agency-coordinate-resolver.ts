import { parse as parseCsv } from "csv-parse/sync";
import type {
  AgencyCoordinateRequest,
  AgencyCoordinateResolution,
} from "./agency-coordinate-types.js";
import type {
  LocationAdministrativeAreaRequest,
  LocationAdministrativeAreaResolution,
} from "./location-resolution.js";

const CENSUS_BATCH_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const CENSUS_GEOGRAPHIES_ADDRESS_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/address";
// TIGERweb serves Census place/ZCTA boundaries with a centroid, letting us
// resolve a locality (city or ZIP) to a coordinate when an agency's address
// is a PO box or landmark that the address-range geocoder above cannot
// match to a street segment.
const CENSUS_PLACES_QUERY_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer";
const CENSUS_ZCTA_QUERY_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer";
// Incorporated Places, then Census Designated Places (current vintage).
const CENSUS_PLACE_LAYER_IDS = [4, 5] as const;
// 2020 Census ZIP Code Tabulation Areas (current vintage).
const CENSUS_ZCTA_LAYER_ID = 1;
const BATCH_SIZE = 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const STATE_FIPS_CODES: Record<string, string> = {
  AL: "01",
  AK: "02",
  AZ: "04",
  AR: "05",
  CA: "06",
  CO: "08",
  CT: "09",
  DE: "10",
  DC: "11",
  FL: "12",
  GA: "13",
  HI: "15",
  ID: "16",
  IL: "17",
  IN: "18",
  IA: "19",
  KS: "20",
  KY: "21",
  LA: "22",
  ME: "23",
  MD: "24",
  MA: "25",
  MI: "26",
  MN: "27",
  MS: "28",
  MO: "29",
  MT: "30",
  NE: "31",
  NV: "32",
  NH: "33",
  NJ: "34",
  NM: "35",
  NY: "36",
  NC: "37",
  ND: "38",
  OH: "39",
  OK: "40",
  OR: "41",
  PA: "42",
  RI: "44",
  SC: "45",
  SD: "46",
  TN: "47",
  TX: "48",
  UT: "49",
  VT: "50",
  VA: "51",
  WA: "53",
  WV: "54",
  WI: "55",
  WY: "56",
  AS: "60",
  GU: "66",
  MP: "69",
  PR: "72",
  VI: "78",
};

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

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];
}

function geographyRecords(
  geographies: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  return asRecords(geographies[key]);
}

function administrativeAreaNameFromCounty(
  county: Record<string, unknown>,
): string | undefined {
  const name = valueAsString(county.NAME) ?? valueAsString(county.BASENAME);
  if (name === undefined) {
    return undefined;
  }

  return /\b(county|parish|borough|municipality|census area|city and borough)\b/i.test(
    name,
  )
    ? name
    : `${name} County`;
}

function administrativeAreaFromCensusPayload(
  payload: unknown,
): LocationAdministrativeAreaResolution | undefined {
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
    const geographies = match.geographies;
    if (typeof geographies !== "object" || geographies === null) {
      continue;
    }

    const counties = [
      ...geographyRecords(geographies as Record<string, unknown>, "Counties"),
      ...geographyRecords(geographies as Record<string, unknown>, "County"),
    ];
    for (const county of counties) {
      const administrativeAreaName = administrativeAreaNameFromCounty(county);
      if (administrativeAreaName !== undefined) {
        return { administrativeAreaName };
      }
    }
  }

  return undefined;
}

async function fetchWithTimeout(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  description: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Census geocoder request timed out after ${timeoutMs} ms while resolving ${description}.`,
      );
    }
    throw error;
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

  const response = await fetchWithTimeout(
    fetchFn,
    CENSUS_BATCH_URL,
    {
      body: form,
      method: "POST",
    },
    requestTimeoutMs,
    `agency address coordinates for ${requests.length} ${requests.length === 1 ? "agency" : "agencies"}`,
  );
  if (!response.ok) {
    throw new Error(
      `Census geocoder failed: ${response.status} ${response.statusText}`,
    );
  }

  const rows = parseCsv(await response.text(), {
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

  const response = await fetchWithTimeout(
    fetchFn,
    `${CENSUS_GEOGRAPHIES_ADDRESS_URL}?${parameters.toString()}`,
    undefined,
    requestTimeoutMs,
    `single-address coordinates for agency ${request.rowId}`,
  );
  if (!response.ok) {
    throw new Error(
      `Census geocoder failed: ${response.status} ${response.statusText}`,
    );
  }

  return coordinateResolutionFromCensusPayload(
    request.rowId,
    await response.json(),
  );
}

function stateFipsCode(state: string): string | undefined {
  return STATE_FIPS_CODES[state.trim().toUpperCase()];
}

function sqlStringLiteral(value: string): string {
  return value.trim().replaceAll("'", "''");
}

function localityResolutionFromArcGisPayload(
  rowId: string,
  payload: unknown,
): AgencyCoordinateResolution | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  for (const feature of asRecords(
    (payload as { features?: unknown }).features,
  )) {
    const attributes = feature.attributes;
    if (typeof attributes !== "object" || attributes === null) {
      continue;
    }

    const latitude = Number((attributes as Record<string, unknown>).CENTLAT);
    const longitude = Number((attributes as Record<string, unknown>).CENTLON);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { rowId, latitude, longitude };
    }
  }

  return undefined;
}

async function resolveArcGisLocality(
  rowId: string,
  serviceUrl: string,
  layerId: number,
  where: string,
  fetchFn: FetchLike,
  requestTimeoutMs: number,
  description: string,
): Promise<AgencyCoordinateResolution | undefined> {
  const parameters = new URLSearchParams({
    where,
    outFields: "CENTLAT,CENTLON",
    returnGeometry: "false",
    f: "json",
  });

  const response = await fetchWithTimeout(
    fetchFn,
    `${serviceUrl}/${layerId}/query?${parameters.toString()}`,
    undefined,
    requestTimeoutMs,
    description,
  );
  if (!response.ok) {
    throw new Error(
      `Census locality geocoder failed: ${response.status} ${response.statusText}`,
    );
  }

  return localityResolutionFromArcGisPayload(rowId, await response.json());
}

/**
 * Resolves a coordinate from the agency's city + state + ZIP alone (no
 * street), for rows whose address is a PO box or landmark that the
 * address-range geocoder cannot match. Tries the named place (city or
 * census-designated place) first, then falls back to the ZIP Code
 * Tabulation Area centroid.
 */
async function resolveLocalityAddress(
  request: AgencyCoordinateRequest,
  fetchFn: FetchLike,
  requestTimeoutMs: number,
): Promise<AgencyCoordinateResolution | undefined> {
  const description = `locality coordinates for agency ${request.rowId}`;
  const stateFips = stateFipsCode(request.state);
  const city = valueAsString(request.city);
  if (stateFips !== undefined && city !== undefined) {
    const where = `UPPER(NAME) LIKE UPPER('${sqlStringLiteral(city)}%') AND STATE='${stateFips}'`;
    for (const layerId of CENSUS_PLACE_LAYER_IDS) {
      const resolution = await resolveArcGisLocality(
        request.rowId,
        CENSUS_PLACES_QUERY_URL,
        layerId,
        where,
        fetchFn,
        requestTimeoutMs,
        description,
      );
      if (resolution !== undefined) {
        return resolution;
      }
    }
  }

  const zip = zip5(request.zipCode);
  if (zip.length === 5) {
    const resolution = await resolveArcGisLocality(
      request.rowId,
      CENSUS_ZCTA_QUERY_URL,
      CENSUS_ZCTA_LAYER_ID,
      `ZCTA5='${sqlStringLiteral(zip)}'`,
      fetchFn,
      requestTimeoutMs,
      description,
    );
    if (resolution !== undefined) {
      return resolution;
    }
  }

  return undefined;
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
        const resolution =
          (await resolveSingleAddress(request, fetchFn, requestTimeoutMs)) ??
          (await resolveLocalityAddress(request, fetchFn, requestTimeoutMs));
        if (resolution !== undefined) {
          canonical.push(resolution);
        }
      }
    }
    return canonical;
  };
}

export function createCensusLocationAdministrativeAreaResolver(
  fetchFn: FetchLike = fetch,
): (
  request: LocationAdministrativeAreaRequest,
) => Promise<LocationAdministrativeAreaResolution | undefined> {
  const cache = new Map<
    string,
    LocationAdministrativeAreaResolution | undefined
  >();

  return async (request) => {
    const cacheKey = [
      valueAsString(request.address) ?? "",
      request.placeSlug,
      request.state.trim().toUpperCase(),
      valueAsString(request.zipCode) ?? "",
    ].join("|");
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const parameters = new URLSearchParams({
      city: request.placeName,
      state: request.state,
      benchmark: "Public_AR_Current",
      vintage: "Current_Current",
      layers: "82",
      format: "json",
    });
    const address = valueAsString(request.address);
    if (address !== undefined) {
      parameters.set("street", normalizeGeocodingStreetAddress(address));
    }
    const zipCode = valueAsString(request.zipCode);
    if (zipCode !== undefined) {
      parameters.set("zip", zip5(zipCode));
    }

    const response = await fetchFn(
      `${CENSUS_GEOGRAPHIES_ADDRESS_URL}?${parameters.toString()}`,
    );
    if (!response.ok) {
      throw new Error(
        `Census geography resolver failed: ${response.status} ${response.statusText}`,
      );
    }

    const resolution = administrativeAreaFromCensusPayload(
      await response.json(),
    );
    cache.set(cacheKey, resolution);
    return resolution;
  };
}
