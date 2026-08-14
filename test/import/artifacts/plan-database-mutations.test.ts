import { describe, expect, test, vi } from "vitest";
import {
  createCensusAgencyCoordinateResolver,
  createCensusLocationAdministrativeAreaResolver,
} from "../../../src/cli/import/artifacts/agency-coordinate-resolver.js";
import type { ResolvedProperties } from "../../../src/cli/import/artifacts/transform.js";
import {
  DatabaseMutationPlanningError,
  planDatabaseMutations,
  type DatabaseClient,
} from "../../../src/cli/import/artifacts/plan-database-mutations.js";
import { AgencyCreate } from "../../../src/cli/import/artifacts/io/generated-mutations/AgencyCreate.js";
import { type ImportOperations } from "../../../src/cli/import/artifacts/operations.js";
import type {
  ImportRows,
  LocationPathGeometryRow,
  LocationPathRow,
} from "../../../src/cli/import/artifacts/transform.js";
import { excludedRecordKey } from "../../../src/shared/io/excluded-records.js";

const rows: ImportRows = {
  locationPaths: [],
  locationPathAliases: [],
  agencies: [
    {
      id: "agency-canonical-id",
      name: "Minnesota State Patrol",
      city: "Saint Paul",
      state: "MN",
      address: "444 Cedar Street",
      zip_code: "55101",
      contact_name: null,
      contact_email: null,
      slug: "minnesota-state-patrol",
      location_path_id: "mn/saint-paul/minnesota-state-patrol",
      latitude: 44.955097,
      longitude: -93.102211,
    },
  ],
  officers: [
    {
      id: "personnel-canonical-id",
      first_name: "Spenser",
      last_name: "Stockwell",
      middle_name: null,
      prefix: null,
      suffix: null,
      slug: "spenser-stockwell",
    },
  ],
  agencyOfficers: [
    {
      id: "agency-personnel-canonical-id",
      agency_id: "agency-canonical-id",
      personnel_id: "personnel-canonical-id",
      badge_number: "49112",
      start_date: "2020-01-01",
      end_date: null,
      title: "Peace Officer",
      license_id: null,
    },
  ],
  preparationMutations: [],
  ownedColumns: {
    agencies: {
      "agency-canonical-id": [
        "name",
        "city",
        "state",
        "address",
        "zip_code",
        "contact_name",
        "contact_email",
        "slug",
        "location_path_id",
        "latitude",
        "longitude",
      ],
    },
    officers: {
      "personnel-canonical-id": [
        "first_name",
        "last_name",
        "middle_name",
        "prefix",
        "suffix",
        "slug",
      ],
    },
    agencyOfficers: {
      "agency-personnel-canonical-id": [
        "agency_id",
        "personnel_id",
        "badge_number",
        "start_date",
        "end_date",
        "title",
      ],
    },
  },
};

const createOperations: ImportOperations = {
  locationPaths: {},
  locationPathGeometries: {},
  locationPathAliases: {},
  agencies: {},
  officers: {},
  agencyOfficers: {},
  licensingAuthorities: {},
  licenses: {},
  licenseActions: {},
};

test("DatabaseMutationPlanningError summarizes repeated missing cached location paths", () => {
  const error = new DatabaseMutationPlanningError(
    rows,
    [
      "Cached location_path_id missing-one for public.agency agency-one does not exist.",
      "Cached location_path_id missing-two for public.agency agency-two does not exist.",
      "Other preparation failure.",
    ],
    { appliedMigrations: [] },
  );

  expect(error.message).toContain("Import preparation failed with 3 errors:");
  expect(error.message).toContain("- Other preparation failure.");
  expect(error.message).toContain(
    "2 cached agency location_path_id values do not exist in the current database.",
  );
  expect(error.message).toContain(
    "Import or replay the current census LocationPath data first",
  );
  expect(error.message).toContain(
    "  - Cached location_path_id missing-one for public.agency agency-one does not exist.",
  );
  expect(error.errors).toHaveLength(3);
});

function locationPathSnapshot(
  placeLocationPathId = "mn/saint-paul/minnesota-state-patrol",
): LocationPathRow[] {
  return [
    {
      location_path_id: "mn-state-location-path-id",
      path: "/mn/",
      level: "state",
      state_or_territory_slug: "mn",
      administrative_area_slug: null,
      place_slug: null,
      state_or_territory_name: "Minnesota",
      administrative_area_name: null,
      place_name: null,
      parent_location_path_id: null,
    },
    {
      location_path_id: "ramsey-county-location-path-id",
      path: "/mn/ramsey-county/",
      level: "administrative_area",
      state_or_territory_slug: "mn",
      administrative_area_slug: "ramsey-county",
      place_slug: null,
      state_or_territory_name: "Minnesota",
      administrative_area_name: "Ramsey County",
      place_name: null,
      parent_location_path_id: "mn-state-location-path-id",
    },
    {
      location_path_id: placeLocationPathId,
      path: "/mn/ramsey-county/saint-paul/",
      level: "place",
      state_or_territory_slug: "mn",
      administrative_area_slug: "ramsey-county",
      place_slug: "saint-paul",
      state_or_territory_name: "Minnesota",
      administrative_area_name: "Ramsey County",
      place_name: "Saint Paul",
      parent_location_path_id: "ramsey-county-location-path-id",
    },
  ];
}

function locationPathGeometry(
  locationPathId: string,
  coordinates: [number, number][],
): LocationPathGeometryRow {
  return {
    location_path_id: locationPathId,
    sourceLocationPathKey: `source:${locationPathId}`,
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
  };
}

class RecordingClient implements DatabaseClient {
  readonly queries: { text: string; values: readonly unknown[] }[] = [];
  ended = false;

  constructor(
    private readonly connectError?: Error,
    private readonly queryFailure?: { pattern: RegExp; error: Error },
    private readonly queryResponses: {
      pattern: RegExp;
      values?: readonly unknown[];
      rows: Record<string, unknown>[];
    }[] = [],
  ) {}

  async connect(): Promise<void> {
    if (this.connectError) {
      throw this.connectError;
    }
  }

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push({ text, values });

    if (this.queryFailure?.pattern.test(text)) {
      throw this.queryFailure.error;
    }

    if (/from supabase_migrations\.schema_migrations\b/i.test(text)) {
      return {
        rows: [
          {
            version: "20260608172000",
            name: "add_location_path_alias",
          },
        ],
      };
    }

    const isGeometryContainmentQuery =
      /join public\.location_path_geometry\b/i.test(text);
    const response = this.queryResponses.find(
      ({ pattern, values: expected }) =>
        pattern.test(text) &&
        (!isGeometryContainmentQuery ||
          pattern.source.includes("location_path_geometry")) &&
        (expected === undefined ||
          JSON.stringify(expected) === JSON.stringify(values)),
    );
    if (response) {
      return { rows: response.rows };
    }

    if (isGeometryContainmentQuery) {
      return { rows: [] };
    }

    if (/from public\.location_path\b/i.test(text) && values.length === 0) {
      return {
        rows: locationPathSnapshot(),
      };
    }

    if (
      /from public\.location_path\s+where location_path_id = \$1/i.test(text)
    ) {
      return {
        rows:
          typeof values[0] === "string"
            ? [
                {
                  location_path_id: values[0],
                  path: `/test/${values[0]}/`,
                  level: "place",
                  state_or_territory_slug: "test",
                  administrative_area_slug: "test-county",
                  place_slug: String(values[0]),
                  state_or_territory_name: "Test",
                  administrative_area_name: "Test County",
                  place_name: String(values[0]),
                  parent_location_path_id: "test-county-location-path-id",
                },
              ]
            : [],
      };
    }

    return { rows: [] };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

describe("createCensusAgencyCoordinateResolver", () => {
  test("fails a stalled Census geocoder request with a timeout", async () => {
    const fetchFn = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const resolver = createCensusAgencyCoordinateResolver(fetchFn, {
      requestTimeoutMs: 1,
    });

    await expect(
      resolver([
        {
          rowId: "agency-canonical-id",
          name: "Minnesota State Patrol",
          address: "444 Cedar Street",
          city: "Saint Paul",
          state: "MN",
          zipCode: "55101",
        },
      ]),
    ).rejects.toThrow(
      "Census geocoder request timed out after 1 ms while resolving agency address coordinates for 1 agency.",
    );
  });

  test("resolves matched Census batch geocoder coordinates", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          [
            '"agency-canonical-id","444 Cedar Street, Saint Paul, MN, 55101","Match","Exact","444 CEDAR ST, SAINT PAUL, MN, 55101","-93.102211,44.955097"',
            '"unmatched-agency","Missing","No_Match","No_Match","",""',
          ].join("\n"),
          { status: 200, statusText: "OK" },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { addressMatches: [] } }), {
          status: 200,
          statusText: "OK",
        }),
      )
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ features: [] }), {
            status: 200,
            statusText: "OK",
          }),
      );
    const onProgress = vi.fn();
    const resolver = createCensusAgencyCoordinateResolver(fetchFn, {
      onProgress,
    });

    const result = await resolver([
      {
        rowId: "agency-canonical-id",
        sourceName: "agency-source-id",
        name: "Minnesota State Patrol",
        address: "444 Cedar Street",
        city: "Saint Paul",
        state: "MN",
        zipCode: "55101",
      },
      {
        rowId: "unmatched-agency",
        name: "Missing",
        address: "1 Missing St",
        city: "Missing",
        state: "MN",
        zipCode: "55555",
      },
    ]);

    expect(fetchFn).toHaveBeenCalledWith(
      "https://geocoding.geo.census.gov/geocoder/locations/addressbatch",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual([
      {
        rowId: "agency-canonical-id",
        latitude: 44.955097,
        longitude: -93.102211,
      },
    ]);
  });

  test("normalizes physical street address before Census batch geocoding", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          '"agency-canonical-id","108 Main Street E, Battle Lake, MN, 56515","Match","Exact","108 MAIN ST E, BATTLE LAKE, MN, 56515","-95.713,46.283"',
          { status: 200, statusText: "OK" },
        ),
    );
    const onProgress = vi.fn();
    const resolver = createCensusAgencyCoordinateResolver(fetchFn, {
      onProgress,
    });

    await resolver([
      {
        rowId: "agency-canonical-id",
        name: "Battle Lake Police Dept.",
        address: "108 Main Street E\nP.O. Box 386",
        city: "Battle Lake",
        state: "MN",
        zipCode: "56515",
      },
    ]);

    const call = fetchFn.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    const init = call?.[1];
    const body = init?.body;
    expect(body).toBeInstanceOf(FormData);
    const blob = (body as FormData).get("addressFile");
    expect(blob).toBeInstanceOf(Blob);
    await expect((blob as Blob).text()).resolves.toContain(
      '"agency-canonical-id","108 Main Street E","Battle Lake","MN","56515"',
    );
  });

  test("falls back to Census address geographies for batch misses", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '"agency-canonical-id","13190 Memorywood Dr, Baxter, MN, 56425","No_Match","No_Match","",""',
          { status: 200, statusText: "OK" },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              addressMatches: [
                {
                  coordinates: { x: -94.2821, y: 46.3433 },
                },
              ],
            },
          }),
          { status: 200, statusText: "OK" },
        ),
      );
    const onProgress = vi.fn();
    const resolver = createCensusAgencyCoordinateResolver(fetchFn, {
      onProgress,
    });

    const result = await resolver([
      {
        rowId: "agency-canonical-id",
        name: "Baxter Police Dept.",
        address: "13190 Memorywood Dr",
        city: "Baxter",
        state: "MN",
        zipCode: "56425-1000",
      },
    ]);

    expect(String(fetchFn.mock.calls[1]?.[0])).toContain(
      "https://geocoding.geo.census.gov/geocoder/geographies/address?",
    );
    expect(String(fetchFn.mock.calls[1]?.[0])).toContain(
      "street=13190+Memorywood+Dr",
    );
    expect(result).toEqual([
      {
        rowId: "agency-canonical-id",
        latitude: 46.3433,
        longitude: -94.2821,
      },
    ]);
    expect(onProgress).toHaveBeenCalledWith({
      stage: "unresolved",
      attempted: 1,
      total: 1,
      rowId: "agency-canonical-id",
    });
  });

  test("falls back to a Census locality (place) centroid for a PO box address", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '"agency-canonical-id","P.O. Box 952, Elkhart, TX, 75839","No_Match","No_Match","",""',
          { status: 200, statusText: "OK" },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { addressMatches: [] } }), {
          status: 200,
          statusText: "OK",
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  CENTLAT: "+31.6279683",
                  CENTLON: "-095.5789576",
                },
              },
            ],
          }),
          { status: 200, statusText: "OK" },
        ),
      );
    const resolver = createCensusAgencyCoordinateResolver(fetchFn);

    const result = await resolver([
      {
        rowId: "agency-canonical-id",
        name: "Anderson Co. Const. Pct. 1",
        address: "P.O. Box 952",
        city: "Elkhart",
        state: "TX",
        zipCode: "75839",
      },
    ]);

    const localityUrl = new URL(String(fetchFn.mock.calls[2]?.[0]));
    expect(localityUrl.origin + localityUrl.pathname).toBe(
      "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query",
    );
    expect(localityUrl.searchParams.get("where")).toBe(
      "UPPER(NAME) LIKE UPPER('Elkhart%') AND STATE='48'",
    );
    expect(result).toEqual([
      {
        rowId: "agency-canonical-id",
        latitude: 31.6279683,
        longitude: -95.5789576,
      },
    ]);
  });

  test("falls back to a Census ZCTA centroid when no locality place matches a landmark address", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '"agency-canonical-id","ANDERSON CO. COURTHOUSE, PALESTINE, TX, 75801","No_Match","No_Match","",""',
          { status: 200, statusText: "OK" },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { addressMatches: [] } }), {
          status: 200,
          statusText: "OK",
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ features: [] }), {
          status: 200,
          statusText: "OK",
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ features: [] }), {
          status: 200,
          statusText: "OK",
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  CENTLAT: "+31.7544203",
                  CENTLON: "-095.6471333",
                },
              },
            ],
          }),
          { status: 200, statusText: "OK" },
        ),
      );
    const resolver = createCensusAgencyCoordinateResolver(fetchFn);

    const result = await resolver([
      {
        rowId: "agency-canonical-id",
        name: "Anderson Co. Att. Office",
        address: "ANDERSON CO. COURTHOUSE",
        city: "PALESTINE",
        state: "TX",
        zipCode: "75801",
      },
    ]);

    const zctaUrl = new URL(String(fetchFn.mock.calls[4]?.[0]));
    expect(zctaUrl.origin + zctaUrl.pathname).toBe(
      "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query",
    );
    expect(zctaUrl.searchParams.get("where")).toBe("ZCTA5='75801'");
    expect(result).toEqual([
      {
        rowId: "agency-canonical-id",
        latitude: 31.7544203,
        longitude: -95.6471333,
      },
    ]);
  });

  test("reports coordinate progress before Census batch lookup", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          '"agency-canonical-id","444 Cedar Street, Saint Paul, MN, 55101","Match","Exact","444 CEDAR ST, SAINT PAUL, MN, 55101","-93.102211,44.955097"',
          { status: 200, statusText: "OK" },
        ),
    );
    const onProgress = vi.fn();
    const resolver = createCensusAgencyCoordinateResolver(fetchFn, {
      onProgress,
    });

    await resolver([
      {
        rowId: "agency-canonical-id",
        name: "Minnesota State Patrol",
        address: "444 Cedar Street",
        city: "Saint Paul",
        state: "MN",
        zipCode: "55101",
      },
    ]);

    expect(onProgress).toHaveBeenCalledWith({
      stage: "batch",
      batchIndex: 1,
      batchCount: 1,
      batchSize: 1,
      total: 1,
    });
  });
});

describe("createCensusLocationAdministrativeAreaResolver", () => {
  test("resolves a county from Census geography results", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: {
              addressMatches: [
                {
                  geographies: {
                    Counties: [{ NAME: "Ramsey County" }],
                  },
                },
              ],
            },
          }),
          { status: 200, statusText: "OK" },
        ),
    );
    const resolver = createCensusLocationAdministrativeAreaResolver(fetchFn);

    await expect(
      resolver({
        address: "444 Cedar Street",
        placeName: "Saint Paul",
        placeSlug: "saint-paul",
        state: "MN",
        zipCode: "55101",
      }),
    ).resolves.toEqual({ administrativeAreaName: "Ramsey County" });

    const calls = fetchFn.mock.calls as unknown as [string][];
    const url = String(calls[0]?.[0]);
    expect(url).toContain(
      "https://geocoding.geo.census.gov/geocoder/geographies/address?",
    );
    expect(url).toContain("street=444+Cedar+Street");
    expect(url).toContain("city=Saint+Paul");
    expect(url).toContain("state=MN");
    expect(url).toContain("zip=55101");
    expect(url).toContain("layers=82");
  });

  test("caches repeated place canonical", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: {
              addressMatches: [
                {
                  geographies: {
                    Counties: [{ BASENAME: "Ramsey" }],
                  },
                },
              ],
            },
          }),
          { status: 200, statusText: "OK" },
        ),
    );
    const resolver = createCensusLocationAdministrativeAreaResolver(fetchFn);
    const request = {
      placeName: "Saint Paul",
      placeSlug: "saint-paul",
      state: "MN",
    };

    await expect(resolver(request)).resolves.toEqual({
      administrativeAreaName: "Ramsey County",
    });
    await expect(resolver(request)).resolves.toEqual({
      administrativeAreaName: "Ramsey County",
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("planDatabaseMutations", () => {
  test("AgencyCreate envelope rejects missing required database-create fields", () => {
    expect(() =>
      AgencyCreate.new({
        metadata: { name: "agency-canonical-id", namespace: "intake" },
        spec: {
          id: "agency-canonical-id",
          name: "Minnesota State Patrol",
          state: "MN",
        } as Parameters<typeof AgencyCreate.new>[0]["spec"],
      }),
    ).toThrow("AgencyCreate is malformed");
  });

  test("missing DATABASE_URL fails before write", async () => {
    const clientFactory = vi.fn(() => new RecordingClient());

    await expect(
      planDatabaseMutations(rows, { env: {}, clientFactory }),
    ).rejects.toThrow("DATABASE_URL is required to plan database mutations.");

    expect(clientFactory).not.toHaveBeenCalled();
  });

  test("connection failure fails before write", async () => {
    const client = new RecordingClient(new Error("connection refused"));

    await expect(
      planDatabaseMutations(rows, {
        env: { DATABASE_URL: "postgres://example/intake" },
        clientFactory: () => client,
      }),
    ).rejects.toThrow("Database connection failed: connection refused");

    expect(client.queries).toEqual([]);
    expect(client.ended).toBe(true);
  });

  test("agency records are planned before replay writes database records", async () => {
    const client = new RecordingClient();

    const result = await planDatabaseMutations(rows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
    });

    expect(result.counts).toEqual({
      locationPaths: 0,
      locationPathGeometries: 0,
      locationPathAliases: 0,
      agencies: 1,
      officers: 1,
      agencyOfficers: 1,
      licensingAuthorities: 0,
      licenses: 0,
      licenseActions: 0,
    });

    expect(result.operations.agencies["agency-canonical-id"]).toBe("create");
    expect(result.operations.officers["personnel-canonical-id"]).toBe("create");
    expect(
      result.operations.agencyOfficers["agency-personnel-canonical-id"],
    ).toBe("create");
    expect(
      client.queries.some(({ text }) => /insert into\s+public\./i.test(text)),
    ).toBe(false);
    expect(
      client.queries.some(({ text }) => /update\s+public\./i.test(text)),
    ).toBe(false);
    expect(client.queries.map(({ text }) => text.toLowerCase())).toContain(
      "rollback",
    );
    expect(client.ended).toBe(true);
  });

  test("location path aliases are planned after location paths", async () => {
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern:
          /select \* from public\.location_path where location_path_id = \$1 or path = \$2/i,
        rows: [],
      },
    ]);
    const aliasRows: ImportRows = {
      ...rows,
      locationPaths: [
        {
          location_path_id: "new-saint-paul-location-path",
          path: "/mn/ramsey-county/new-saint-paul/",
          level: "place",
          state_or_territory_slug: "mn",
          administrative_area_slug: "ramsey-county",
          place_slug: "new-saint-paul",
          state_or_territory_name: "Minnesota",
          administrative_area_name: "Ramsey County",
          place_name: "New Saint Paul",
          parent_location_path_id: "ramsey-county-location-path",
        },
      ],
      locationPathAliases: [
        {
          alias_path: "/mn/ramsey-county/new-st-paul/",
          location_path_id: "new-saint-paul-location-path",
        },
      ],
      agencies: [],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {},
        officers: {},
        agencyOfficers: {},
      },
    };

    const result = await planDatabaseMutations(aliasRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
    });

    expect(result.operations.locationPaths).toEqual({
      "new-saint-paul-location-path": "create",
    });
    expect(result.operations.locationPathAliases).toEqual({
      "/mn/ramsey-county/new-st-paul/": "create",
    });
    expect(
      client.queries.some(({ text }) => /insert into\s+public\./i.test(text)),
    ).toBe(false);
  });

  test("rejects location path source IDs that disagree with an existing database path", async () => {
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /from public\.location_path\b/i,
        rows: [
          {
            location_path_id: "existing-ak-id",
            path: "/ak/",
            level: "state",
            state_or_territory_slug: "ak",
            administrative_area_slug: null,
            place_slug: null,
            state_or_territory_name: "Alaska",
            administrative_area_name: null,
            place_name: null,
            parent_location_path_id: null,
          },
        ],
      },
    ]);
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [
        {
          location_path_id: "mapped-ak-id",
          path: "/ak/",
          level: "state",
          state_or_territory_slug: "ak",
          administrative_area_slug: null,
          place_slug: null,
          state_or_territory_name: "Alaska",
          administrative_area_name: null,
          place_name: null,
          parent_location_path_id: null,
        },
      ],
      agencies: [],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {},
        officers: {},
        agencyOfficers: {},
      },
    };

    await expect(
      planDatabaseMutations(partialRows, {
        env: { DATABASE_URL: "postgres://example/intake" },
        clientFactory: () => client,
      }),
    ).rejects.toThrow(
      "Location path /ak/ already exists with location_path_id existing-ak-id, but import mapped it to mapped-ak-id.",
    );
  });

  test("loads import schema metadata without column requiredness validation", async () => {
    const client = new RecordingClient();

    const result = await planDatabaseMutations(rows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
    });

    const columnMetadataQueries = client.queries.filter(({ text }) =>
      /from information_schema\.columns\b/i.test(text),
    );
    expect(columnMetadataQueries).toEqual([]);
    expect(result.schema).toEqual({
      appliedMigrations: [
        {
          version: "20260608172000",
          name: "add_location_path_alias",
        },
      ],
    });
  });

  test("marks prepared commands as update when rows exist at command creation time", async () => {
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency\b/i,
        rows: [{ id: "agency-canonical-id" }],
      },
      {
        pattern: /select \* from public\.officers\b/i,
        rows: [{ id: "personnel-canonical-id" }],
      },
      {
        pattern: /select \* from public\.agency_officers\b/i,
        rows: [{ id: "agency-personnel-canonical-id" }],
      },
    ]);
    const result = await planDatabaseMutations(rows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
    });

    expect(result.operations).toEqual(
      expect.objectContaining({
        agencies: { "agency-canonical-id": "update" },
        officers: { "personnel-canonical-id": "update" },
        agencyOfficers: { "agency-personnel-canonical-id": "update" },
      }),
    );
  });

  test("fails before writing a ready import-artifacts replay when a new agency slug already belongs to another row", async () => {
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select id, slug from public\.agency where slug = any/i,
        rows: [{ id: "existing-agency-id", slug: "minnesota-state-patrol" }],
      },
    ]);
    await expect(
      planDatabaseMutations(rows, {
        env: { DATABASE_URL: "postgres://example/intake" },
        clientFactory: () => client,
      }),
    ).rejects.toThrow(
      [
        "Import preparation failed with 1 error:",
        "- Cannot insert public.agency agency-canonical-id; slug minnesota-state-patrol already belongs to public.agency existing-agency-id.",
      ].join("\n"),
    );

    const slugQueries = client.queries.filter(({ text }) =>
      /where slug = any/i.test(text),
    );
    expect(slugQueries).toHaveLength(2);
    expect(slugQueries[0]?.values).toEqual([["minnesota-state-patrol"]]);
    expect(slugQueries[1]?.values).toEqual([["spenser-stockwell"]]);
  });

  test("SQL text does not contain ON CONFLICT, DO NOTHING, or upsert behavior", async () => {
    const client = new RecordingClient();

    await planDatabaseMutations(rows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
    });

    const sql = client.queries.map(({ text }) => text).join("\n");
    expect(sql).not.toMatch(/\bon\s+conflict\b/i);
    expect(sql).not.toMatch(/\bdo\s+nothing\b/i);
    expect(sql).not.toMatch(/\bupsert\b/i);
  });

  test("existing canonical records are planned as updates", async () => {
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency\b/i,
        rows: [{ ...rows.agencies[0], name: "Old Agency Name" }],
      },
      {
        pattern: /select \* from public\.officers\b/i,
        rows: [rows.officers[0]],
      },
      {
        pattern: /select \* from public\.agency_officers\b/i,
        rows: [rows.agencyOfficers[0]],
      },
    ]);

    const result = await planDatabaseMutations(rows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
    });

    expect(result.counts).toEqual({
      locationPaths: 0,
      locationPathGeometries: 0,
      locationPathAliases: 0,
      agencies: 1,
      officers: 1,
      agencyOfficers: 1,
      licensingAuthorities: 0,
      licenses: 0,
      licenseActions: 0,
    });
    expect(
      client.queries.some(({ text }) => /insert into\s+public\./i.test(text)),
    ).toBe(false);
    expect(result.operations.agencies["agency-canonical-id"]).toBe("update");
    expect(result.operations.officers["personnel-canonical-id"]).toBe("update");
    expect(
      result.operations.agencyOfficers["agency-personnel-canonical-id"],
    ).toBe("update");
    expect(
      client.queries.some(({ text }) => /update\s+public\./i.test(text)),
    ).toBe(false);
    expect(client.queries.map(({ text }) => text.toLowerCase())).toContain(
      "rollback",
    );
  });

  test("columns absent from artifacts ownership are left untouched", async () => {
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      ownedColumns: {
        ...rows.ownedColumns,
        agencies: {
          "agency-canonical-id": ["name", "slug"],
        },
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency\b/i,
        rows: [{ ...rows.agencies[0], name: "Different Agency Name" }],
      },
    ]);

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
    });

    expect(partialRows.ownedColumns.agencies["agency-canonical-id"]).toEqual([
      "name",
      "slug",
    ]);
    expect(
      client.queries.some(({ text }) => /update\s+public\./i.test(text)),
    ).toBe(false);
  });

  test("existing agency rows can update source-owned fields before location resolution is present", async () => {
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          slug: undefined,
          location_path_id: undefined,
          latitude: undefined,
          longitude: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "state"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency\b/i,
        rows: [{ id: "agency-canonical-id", name: "Old Agency Name" }],
      },
    ]);

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
    });

    expect(partialRows.ownedColumns.agencies["agency-canonical-id"]).toEqual([
      "name",
      "state",
    ]);
    expect(
      client.queries.some(({ text }) => /update\s+public\./i.test(text)),
    ).toBe(false);
  });

  test("new agency insert fails loud (not excluded) when dynamic location resolution fails", async () => {
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          slug: undefined,
          location_path_id: undefined,
          latitude: undefined,
          longitude: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "state"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await expect(
      planDatabaseMutations(partialRows, {
        env: { DATABASE_URL: "postgres://example/intake" },
        clientFactory: () => client,
        logger,
      }),
    ).rejects.toThrow(
      "Agency agency-canonical-id (Minnesota State Patrol): Cannot resolve coordinates for public.agency agency-canonical-id",
    );

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "public.agency",
        entityType: "agency",
        rowId: "agency-canonical-id",
        missingFields: ["slug", "location_path_id", "latitude", "longitude"],
      }),
      "Agency field resolution failed.",
    );

    expect(
      client.queries.some(({ text }) =>
        /insert into\s+public\.agency\b/i.test(text),
      ),
    ).toBe(false);
  });

  test("new agency insert resolves dynamic mapping fields and persists them", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: { "agency-canonical-id": {} },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      locationPathGeometries: [
        locationPathGeometry("saint-paul-location-path", [
          [-93.2, 44.9],
          [-93.0, 44.9],
          [-93.0, 45.0],
          [-93.2, 45.0],
          [-93.2, 44.9],
        ]),
      ],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          slug: undefined,
          location_path_id: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "state"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        rows: locationPathSnapshot("saint-paul-location-path").filter(
          (locationPath) => locationPath.level === "place",
        ),
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path"),
      },
    ]);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    };

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      resolvedProperties,
      logger,
      resolveAgencyCoordinates: async () => [
        {
          rowId: "agency-canonical-id",
          latitude: 44.955097,
          longitude: -93.102211,
        },
      ],
      resolveLocationAdministrativeArea: async () => ({
        administrativeAreaName: "Ramsey County",
      }),
    });

    expect(partialRows.agencies[0]?.slug).toBe("minnesota-state-patrol-icalid");
    expect(partialRows.agencies[0]?.location_path_id).toBe(
      "saint-paul-location-path",
    );
    expect(resolvedProperties.agencies["agency-canonical-id"]).toEqual({
      slug: "minnesota-state-patrol-icalid",
      locationPathId: "saint-paul-location-path",
      latitude: 44.955097,
      longitude: -93.102211,
    });
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "public.agency",
        entityType: "agency",
        rowId: "agency-canonical-id",
        resolvedFields: ["slug"],
      }),
      "Resolved agency fields: slug.",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "public.agency",
        entityType: "agency",
        rowId: "agency-canonical-id",
        resolvedFields: ["location_path_id"],
      }),
      "Resolved agency fields: location_path_id.",
    );
    expect(logger.info).toHaveBeenCalledWith(
      { entityType: "agency", total: 1 },
      "Preparing 1 agency row.",
    );
    expect(logger.info).toHaveBeenCalledWith(
      { entityType: "agency", processed: 1, total: 1, errors: 0 },
      "Prepared 1 of 1 agency rows.",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      {
        entityType: "agency",
        processed: 1,
        total: 1,
        rowId: "agency-canonical-id",
        sourceName: "agency-source-id",
        name: "Minnesota State Patrol",
      },
      "Preparing agency row 1 of 1.",
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("Preparing agency row"),
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("Resolving agency fields:"),
    );
  });

  test("new agency insert fails loud (not excluded) when no place, county, or state boundary contains the resolved point", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: { "agency-canonical-id": {} },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          slug: undefined,
          location_path_id: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "state"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path_alias\b/i,
        rows: [],
      },
    ]);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await expect(
      planDatabaseMutations(partialRows, {
        env: { DATABASE_URL: "postgres://example/intake" },
        clientFactory: () => client,
        resolvedProperties,
        logger,
        resolveAgencyCoordinates: async () => [
          {
            rowId: "agency-canonical-id",
            latitude: 44.955097,
            longitude: -93.102211,
          },
        ],
        resolveLocationAdministrativeArea: async () => ({
          administrativeAreaName: "Ramsey County",
        }),
      }),
    ).rejects.toThrow(
      "no place location_path_geometry boundary contains point 44.955097, -93.102211",
    );

    expect(
      client.queries.some(({ text }) =>
        /insert into\s+public\.agency\b/i.test(text),
      ),
    ).toBe(false);
  });

  test("an excluded agency (kind:sourceKey in excluded.yaml) is dropped before resolution, cascades to its agency_officers rows, and the import proceeds", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: {
        "agency-canonical-id": {},
        "second-agency-canonical-id": {},
      },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          id: "agency-canonical-id",
          sourceName: "agency-source-id",
          slug: undefined,
          location_path_id: undefined,
        },
        {
          ...rows.agencies[0],
          id: "second-agency-canonical-id",
          sourceName: "second-agency-source-id",
          name: "Resolvable Agency",
          slug: "resolvable-agency",
          location_path_id: "existing-location-path-id",
          latitude: 44.9,
          longitude: -93.1,
        },
      ],
      officers: [
        {
          id: "personnel-canonical-id",
          first_name: "Spenser",
          last_name: "Stockwell",
          middle_name: null,
          prefix: null,
          suffix: null,
          slug: "spenser-stockwell",
        },
        {
          id: "second-personnel-canonical-id",
          first_name: "Alex",
          last_name: "Rivera",
          middle_name: null,
          prefix: null,
          suffix: null,
          slug: "alex-rivera",
        },
      ],
      agencyOfficers: [
        {
          id: "agency-personnel-canonical-id",
          agency_id: "agency-canonical-id",
          personnel_id: "personnel-canonical-id",
          badge_number: "49112",
          start_date: "2020-01-01",
          end_date: null,
          title: "Peace Officer",
          license_id: null,
        },
        {
          id: "second-agency-personnel-canonical-id",
          agency_id: "second-agency-canonical-id",
          personnel_id: "second-personnel-canonical-id",
          badge_number: "49113",
          start_date: "2020-01-01",
          end_date: null,
          title: "Peace Officer",
          license_id: null,
        },
      ],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "state"],
          "second-agency-canonical-id": [
            "name",
            "location_path_id",
            "latitude",
            "longitude",
          ],
        },
        officers: {
          "personnel-canonical-id": [
            "first_name",
            "last_name",
            "middle_name",
            "prefix",
            "suffix",
            "slug",
          ],
          "second-personnel-canonical-id": [
            "first_name",
            "last_name",
            "middle_name",
            "prefix",
            "suffix",
            "slug",
          ],
        },
        agencyOfficers: {
          "agency-personnel-canonical-id": [
            "agency_id",
            "personnel_id",
            "badge_number",
            "start_date",
            "end_date",
            "title",
          ],
          "second-agency-personnel-canonical-id": [
            "agency_id",
            "personnel_id",
            "badge_number",
            "start_date",
            "end_date",
            "title",
          ],
        },
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: [
          {
            location_path_id: "existing-location-path-id",
            path: "/mn/ramsey-county/saint-paul/",
            level: "place",
            state_or_territory_slug: "mn",
            administrative_area_slug: "ramsey-county",
            place_slug: "saint-paul",
            state_or_territory_name: "Minnesota",
            administrative_area_name: "Ramsey County",
            place_name: "Saint Paul",
            parent_location_path_id: "ramsey-county-location-path-id",
          },
        ],
      },
      {
        pattern: /from public\.location_path_alias\b/i,
        rows: [],
      },
    ]);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const resolveAgencyCoordinates = vi.fn(async () => [
      {
        rowId: "agency-canonical-id",
        latitude: 44.955097,
        longitude: -93.102211,
      },
    ]);

    const result = await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      resolvedProperties,
      logger,
      resolveAgencyCoordinates,
      resolveLocationAdministrativeArea: async () => ({
        administrativeAreaName: "Ramsey County",
      }),
      excludedRecords: new Map([
        [
          excludedRecordKey("Agency", "agency-source-id"),
          {
            kind: "Agency",
            key: "agency-source-id",
            name: "Minnesota State Patrol",
            reason: "addressless county agency (test fixture)",
          },
        ],
      ]),
    });

    // The excluded agency is dropped; the resolvable one is kept.
    expect(partialRows.agencies.map((agency) => agency.id)).toEqual([
      "second-agency-canonical-id",
    ]);
    expect(result.counts.agencies).toBe(1);

    // Dropped early, before resolution: geocoding is never attempted for the
    // excluded agency.
    expect(resolveAgencyCoordinates).not.toHaveBeenCalled();

    // The agency_officers row for the excluded agency is cascaded out; the
    // row for the still-imported agency is kept.
    expect(
      partialRows.agencyOfficers.map((agencyOfficer) => agencyOfficer.id),
    ).toEqual(["second-agency-personnel-canonical-id"]);
    expect(result.counts.agencyOfficers).toBe(1);

    // Personnel/officer rows are never affected by an excluded agency.
    expect(partialRows.officers).toHaveLength(2);
    expect(result.counts.officers).toBe(2);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "agency", excludedCount: 1 }),
      expect.stringContaining(
        "Excluded 1 agency row listed in the source's excluded.yaml.",
      ),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "agency",
        rowId: "agency-canonical-id",
        sourceName: "agency-source-id",
        reason: "addressless county agency (test fixture)",
      }),
      expect.stringContaining(
        "Excluded agency agency-source-id — addressless county agency (test fixture)",
      ),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "agencyOfficer",
        droppedCount: 1,
        excludedAgencyIds: ["agency-canonical-id"],
      }),
      expect.stringContaining("Dropped 1 agency-officer row"),
    );
  });

  test("new agency insert resolves location path from database boundary containment", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: { "agency-canonical-id": {} },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      locationPathGeometries: [],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          slug: undefined,
          location_path_id: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "state"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        rows: locationPathSnapshot("saint-paul-location-path").filter(
          (locationPath) => locationPath.level === "place",
        ),
      },
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path"),
      },
    ]);
    const write = vi.fn(async () => undefined);

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      sourceNamespace: "mn-post",
      resolvedProperties,
      resolvedPropertyCache: {
        read: async () => undefined,
        write,
      },
      resolveAgencyCoordinates: async () => [
        {
          rowId: "agency-canonical-id",
          latitude: 44.955097,
          longitude: -93.102211,
        },
      ],
    });

    expect(partialRows.agencies[0]?.location_path_id).toBe(
      "saint-paul-location-path",
    );
    expect(resolvedProperties.agencies["agency-canonical-id"]).toMatchObject({
      locationPathId: "saint-paul-location-path",
      latitude: 44.955097,
      longitude: -93.102211,
    });
    expect(
      client.queries.some(({ text }) =>
        /ST_Covers\(lpg\.boundary, ST_SetSRID\(ST_MakePoint\(\$1, \$2\), 4326\)\)/i.test(
          text,
        ),
      ),
    ).toBe(true);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: {
          apiVersion: "policeconduct.org/intake/v1alpha1",
          kind: "Agency",
          name: "agency-canonical-id",
        },
        source: expect.objectContaining({
          namespace: "mn-post",
          kind: "Agency",
          name: "agency-source-id",
        }),
        targetProperty: "location_path_id",
        value: "saint-paul-location-path",
      }),
    );
  });

  test("new agency insert falls back to the containing county location path when no place boundary contains the point", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: { "agency-canonical-id": {} },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      locationPathGeometries: [],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          name: "Ramsey County Constable Precinct 1",
          city: "Unincorporated Ramsey County",
          slug: undefined,
          location_path_id: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "city", "state"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        values: [-93.102211, 44.955097, "place"],
        rows: [],
      },
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        values: [-93.102211, 44.955097, "administrative_area"],
        rows: locationPathSnapshot("saint-paul-location-path").filter(
          (locationPath) => locationPath.level === "administrative_area",
        ),
      },
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path"),
      },
    ]);

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      sourceNamespace: "mn-post",
      resolvedProperties,
      resolveAgencyCoordinates: async () => [
        {
          rowId: "agency-canonical-id",
          latitude: 44.955097,
          longitude: -93.102211,
        },
      ],
    });

    expect(partialRows.agencies[0]?.location_path_id).toBe(
      "ramsey-county-location-path-id",
    );
    expect(resolvedProperties.agencies["agency-canonical-id"]).toMatchObject({
      locationPathId: "ramsey-county-location-path-id",
      latitude: 44.955097,
      longitude: -93.102211,
    });
    const geometryQueries = client.queries.filter(({ text }) =>
      /join public\.location_path_geometry\b/i.test(text),
    );
    expect(geometryQueries.map(({ values }) => values[2])).toEqual([
      "place",
      "administrative_area",
    ]);
  });

  test("new agency insert resolves Fort Snelling postal address to Saint Paul when no place contains the point", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: { "agency-canonical-id": {} },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      locationPathGeometries: [],
      agencies: [
        {
          ...rows.agencies[0],
          name: "Metropolitan Airports Commission",
          sourceName: "a2j40000000crQtAAI",
          address: "4300 Glumack Dr, Ste 3255",
          city: "St. Paul",
          state: "MN",
          zip_code: "55111-3002",
          slug: undefined,
          location_path_id: undefined,
          latitude: 44.893029536350156,
          longitude: -93.23296250042694,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "state"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        rows: [],
      },
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path"),
      },
    ]);
    const write = vi.fn(async () => undefined);

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      sourceNamespace: "mn-post",
      resolvedProperties,
      resolvedPropertyCache: {
        read: async () => undefined,
        write,
      },
      resolveAgencyCoordinates: async () => [],
    });

    expect(partialRows.agencies[0]?.location_path_id).toBe(
      "saint-paul-location-path",
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: {
          apiVersion: "policeconduct.org/intake/v1alpha1",
          kind: "Agency",
          name: "agency-canonical-id",
        },
        source: expect.objectContaining({
          namespace: "mn-post",
          kind: "Agency",
          name: "a2j40000000crQtAAI",
        }),
        targetProperty: "location_path_id",
        value: "saint-paul-location-path",
      }),
    );
  });

  test.each([
    {
      name: "Duluth Township Police Dept.",
      sourceName: "a2j40000000crOkAAI",
      address: "6092 Homestead Rd",
      city: "Duluth",
      zipCode: "55804-9646",
      latitude: 46.952243324368915,
      longitude: -91.84677383570872,
      expectedPath: "/mn/st-louis-county/duluth/",
      expectedLocationPathId: "duluth-location-path",
      locationPaths: [
        {
          location_path_id: "duluth-location-path",
          path: "/mn/st-louis-county/duluth/",
          level: "place",
          state_or_territory_slug: "mn",
          administrative_area_slug: "st-louis-county",
          place_slug: "duluth",
          state_or_territory_name: "Minnesota",
          administrative_area_name: "St. Louis County",
          place_name: "Duluth",
          parent_location_path_id: "st-louis-county-location-path",
        },
      ],
    },
    {
      name: "Lower Sioux Tribal Police Dept.",
      sourceName: "a2j40000000crQXAAY",
      address: "39527 Reservation Highway 1",
      city: "Morton",
      zipCode: "56270",
      latitude: 44.532598575956364,
      longitude: -94.995737828836,
      expectedPath: "/mn/renville-county/morton/",
      expectedLocationPathId: "morton-location-path",
      locationPaths: [
        {
          location_path_id: "morton-location-path",
          path: "/mn/renville-county/morton/",
          level: "place",
          state_or_territory_slug: "mn",
          administrative_area_slug: "renville-county",
          place_slug: "morton",
          state_or_territory_name: "Minnesota",
          administrative_area_name: "Renville County",
          place_name: "Morton",
          parent_location_path_id: "renville-county-location-path",
        },
      ],
    },
    {
      name: "Upper Sioux Tribal Community Police Dept.",
      sourceName: "a2j40000000crTKAAY",
      address: "5722 Travers Ln",
      city: "Granite Falls",
      zipCode: "56241",
      latitude: 44.74719617048954,
      longitude: -95.49601657060424,
      expectedPath: "/mn/chippewa-county/granite-falls/",
      expectedLocationPathId: "granite-falls-location-path",
      locationPaths: [
        {
          location_path_id: "granite-falls-location-path",
          path: "/mn/chippewa-county/granite-falls/",
          level: "place",
          state_or_territory_slug: "mn",
          administrative_area_slug: "chippewa-county",
          place_slug: "granite-falls",
          state_or_territory_name: "Minnesota",
          administrative_area_name: "Chippewa County",
          place_name: "Granite Falls",
          parent_location_path_id: "chippewa-county-location-path",
        },
      ],
    },
  ])(
    "new agency insert resolves $name from explicit postal-area rule when no place contains the point",
    async ({
      name,
      sourceName,
      address,
      city,
      zipCode,
      latitude,
      longitude,
      expectedLocationPathId,
      locationPaths,
    }) => {
      const resolvedProperties: ResolvedProperties = {
        agencies: { "agency-canonical-id": {} },
        personnel: {},
      };
      const partialRows: ImportRows = {
        ...rows,
        locationPaths: [],
        locationPathGeometries: [],
        agencies: [
          {
            ...rows.agencies[0],
            name,
            sourceName,
            address,
            city,
            state: "MN",
            zip_code: zipCode,
            slug: undefined,
            location_path_id: undefined,
            latitude,
            longitude,
          },
        ],
        officers: [],
        agencyOfficers: [],
        ownedColumns: {
          agencies: {
            "agency-canonical-id": ["name", "state"],
          },
          officers: {},
          agencyOfficers: {},
        },
      };
      const client = new RecordingClient(undefined, undefined, [
        {
          pattern:
            /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
          rows: [],
        },
        {
          pattern: /select \* from public\.agency where id = \$1/i,
          rows: [],
        },
        {
          pattern: /from public\.location_path\b/i,
          rows: locationPaths,
        },
      ]);

      await planDatabaseMutations(partialRows, {
        env: { DATABASE_URL: "postgres://example/intake" },
        clientFactory: () => client,
        sourceNamespace: "mn-post",
        resolvedProperties,
        resolveAgencyCoordinates: async () => [],
      });

      expect(partialRows.agencies[0]?.location_path_id).toBe(
        expectedLocationPathId,
      );
    },
  );

  test("new agency insert fails loud (not Fort Snelling postal override, not excluded) when multiple places contain the point", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: { "agency-canonical-id": {} },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      locationPathGeometries: [],
      agencies: [
        {
          ...rows.agencies[0],
          name: "Metropolitan Airports Commission",
          sourceName: "a2j40000000crQtAAI",
          address: "4300 Glumack Dr, Ste 3255",
          city: "St. Paul",
          state: "MN",
          zip_code: "55111-3002",
          slug: undefined,
          location_path_id: undefined,
          latitude: 44.893029536350156,
          longitude: -93.23296250042694,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "state"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        rows: [
          ...locationPathSnapshot("first-saint-paul-location-path").filter(
            (locationPath) => locationPath.level === "place",
          ),
          {
            ...locationPathSnapshot("second-saint-paul-location-path").find(
              (locationPath) => locationPath.level === "place",
            )!,
            path: "/mn/ramsey-county/saint-paul-duplicate/",
          },
        ],
      },
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path"),
      },
    ]);

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await expect(
      planDatabaseMutations(partialRows, {
        env: { DATABASE_URL: "postgres://example/intake" },
        clientFactory: () => client,
        sourceNamespace: "mn-post",
        resolvedProperties,
        logger,
        resolveAgencyCoordinates: async () => [],
      }),
    ).rejects.toThrow(
      "multiple place location_path_geometry boundaries contain point",
    );
  });

  test("new agency insert resolves address coordinates and persists them", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: {
        "agency-canonical-id": {
          slug: "minnesota-state-patrol-icalid",
          locationPathId: "saint-paul-location-path",
        },
      },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          location_path_id: "saint-paul-location-path",
          latitude: undefined,
          longitude: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "latitude", "longitude"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        rows: locationPathSnapshot("saint-paul-location-path").filter(
          (locationPath) => locationPath.level === "place",
        ),
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path"),
      },
    ]);
    const resolveAgencyCoordinates = vi.fn(async () => [
      {
        rowId: "agency-canonical-id",
        latitude: 44.955097,
        longitude: -93.102211,
      },
    ]);

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      resolvedProperties,
      resolveAgencyCoordinates,
    });

    expect(resolveAgencyCoordinates).toHaveBeenCalledWith([
      expect.objectContaining({
        rowId: "agency-canonical-id",
        sourceName: "agency-source-id",
        address: "444 Cedar Street",
        city: "Saint Paul",
        state: "MN",
        zipCode: "55101",
      }),
    ]);
    expect(partialRows.agencies[0]?.latitude).toBe(44.955097);
    expect(partialRows.agencies[0]?.longitude).toBe(-93.102211);
    expect(resolvedProperties.agencies["agency-canonical-id"]).toMatchObject({
      latitude: 44.955097,
      longitude: -93.102211,
    });
  });

  test("new agency insert reuses cached address coordinates and skips resolver", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: {
        "agency-canonical-id": {
          slug: "minnesota-state-patrol-icalid",
          locationPathId: "saint-paul-location-path",
        },
      },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          location_path_id: "saint-paul-location-path",
          latitude: undefined,
          longitude: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "latitude", "longitude"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        rows: locationPathSnapshot("saint-paul-location-path").filter(
          (locationPath) => locationPath.level === "place",
        ),
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path"),
      },
    ]);
    const resolveAgencyCoordinates = vi.fn(async () => [
      {
        rowId: "agency-canonical-id",
        latitude: 1,
        longitude: 2,
      },
    ]);
    const cacheReads: {
      targetProperty: string;
      inputFingerprint: string | undefined;
    }[] = [];

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      sourceNamespace: "mn-post",
      resolvedProperties,
      resolveAgencyCoordinates,
      resolvedPropertyCache: {
        read: async (input) => {
          cacheReads.push({
            targetProperty: input.targetProperty,
            inputFingerprint: input.source?.inputFingerprint,
          });
          if (input.subject.kind !== "Agency") {
            return undefined;
          }
          if (input.subject.name !== "agency-canonical-id") {
            return undefined;
          }
          if (
            input.source?.namespace !== "mn-post" ||
            input.source.kind !== "Agency" ||
            input.source.name !== "agency-source-id"
          ) {
            return undefined;
          }
          return input.targetProperty === "latitude"
            ? 44.955097
            : input.targetProperty === "longitude"
              ? -93.102211
              : undefined;
        },
        write: vi.fn(),
      },
    });

    expect(resolveAgencyCoordinates).not.toHaveBeenCalled();
    expect(cacheReads.map(({ targetProperty }) => targetProperty)).toEqual([
      "latitude",
      "longitude",
    ]);
    expect(cacheReads[0]!.inputFingerprint).toBe(
      cacheReads[1]!.inputFingerprint,
    );
    expect(partialRows.agencies[0]?.latitude).toBe(44.955097);
    expect(partialRows.agencies[0]?.longitude).toBe(-93.102211);
  });

  test("new agency insert reuses cached location path and coordinates without containment lookup", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: { "agency-canonical-id": {} },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          location_path_id: undefined,
          latitude: undefined,
          longitude: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": [
            "name",
            "location_path_id",
            "latitude",
            "longitude",
          ],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path"),
      },
    ]);
    const resolveAgencyCoordinates = vi.fn(async () => {
      throw new Error("coordinates should have been read from cache");
    });

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      sourceNamespace: "mn-post",
      resolvedProperties,
      resolveAgencyCoordinates,
      resolvedPropertyCache: {
        read: async (input) => {
          if (
            input.subject.kind !== "Agency" ||
            input.subject.name !== "agency-canonical-id" ||
            input.source?.namespace !== "mn-post" ||
            input.source.kind !== "Agency" ||
            input.source.name !== "agency-source-id"
          ) {
            return undefined;
          }
          if (input.targetProperty === "location_path_id") {
            return "saint-paul-location-path";
          }
          if (input.targetProperty === "latitude") {
            return 44.955097;
          }
          if (input.targetProperty === "longitude") {
            return -93.102211;
          }
          return undefined;
        },
        write: vi.fn(),
      },
    });

    expect(resolveAgencyCoordinates).not.toHaveBeenCalled();
    expect(
      client.queries.some(({ text }) =>
        /join public\.location_path_geometry\b/i.test(text),
      ),
    ).toBe(false);
    expect(partialRows.agencies[0]?.location_path_id).toBe(
      "saint-paul-location-path",
    );
    expect(partialRows.agencies[0]?.latitude).toBe(44.955097);
    expect(partialRows.agencies[0]?.longitude).toBe(-93.102211);
  });

  test("new agency insert retries resolver when cached coordinates are unresolved", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: { "agency-canonical-id": {} },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          location_path_id: undefined,
          latitude: undefined,
          longitude: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": [
            "name",
            "location_path_id",
            "latitude",
            "longitude",
          ],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        rows: locationPathSnapshot("saint-paul-location-path").filter(
          (locationPath) => locationPath.level === "place",
        ),
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path"),
      },
    ]);
    const resolveAgencyCoordinates = vi.fn(async () => [
      {
        rowId: "agency-canonical-id",
        latitude: 44.955097,
        longitude: -93.102211,
      },
    ]);

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      sourceNamespace: "mn-post",
      resolvedProperties,
      resolveAgencyCoordinates,
      resolvedPropertyCache: {
        read: async (input) => {
          if (
            input.subject.kind !== "Agency" ||
            input.subject.name !== "agency-canonical-id" ||
            input.source?.namespace !== "mn-post" ||
            input.source.kind !== "Agency" ||
            input.source.name !== "agency-source-id"
          ) {
            return undefined;
          }
          return input.targetProperty === "latitude" ||
            input.targetProperty === "longitude"
            ? { status: "unresolved" }
            : undefined;
        },
        write: vi.fn(),
      },
    });

    expect(resolveAgencyCoordinates).toHaveBeenCalledTimes(1);
    expect(partialRows.agencies[0]?.latitude).toBe(44.955097);
    expect(partialRows.agencies[0]?.longitude).toBe(-93.102211);
  });

  test("new agency insert does not retry the same unresolved coordinate batch inside one import", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: {
        "agency-canonical-id": {},
        "second-agency-canonical-id": {},
      },
      personnel: {},
    };
    const secondAgency = {
      ...rows.agencies[0],
      id: "second-agency-canonical-id",
      sourceName: "second-agency-source-id",
      name: "Second Agency",
      slug: undefined,
      location_path_id: "saint-paul-location-path",
      latitude: undefined,
      longitude: undefined,
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          slug: undefined,
          location_path_id: "saint-paul-location-path",
          latitude: undefined,
          longitude: undefined,
        },
        secondAgency,
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": [
            "name",
            "location_path_id",
            "latitude",
            "longitude",
          ],
          "second-agency-canonical-id": [
            "name",
            "location_path_id",
            "latitude",
            "longitude",
          ],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path"),
      },
    ]);
    const resolveAgencyCoordinates = vi.fn(async () => []);

    await expect(
      planDatabaseMutations(partialRows, {
        env: { DATABASE_URL: "postgres://example/intake" },
        clientFactory: () => client,
        sourceNamespace: "mn-post",
        resolvedProperties,
        resolveAgencyCoordinates,
        resolvedPropertyCache: {
          read: async () => undefined,
          write: vi.fn(),
        },
      }),
    ).rejects.toThrow(DatabaseMutationPlanningError);

    // Both unresolvable agencies are collected into one loud failure; the
    // batch resolver is still called once with both rows (not retried per
    // row) even though the import as a whole now aborts.
    expect(resolveAgencyCoordinates).toHaveBeenCalledTimes(1);
    expect(resolveAgencyCoordinates).toHaveBeenCalledWith([
      expect.objectContaining({ rowId: "agency-canonical-id" }),
      expect.objectContaining({ rowId: "second-agency-canonical-id" }),
    ]);
  });

  test("new agency insert writes resolved address coordinates to cache on miss", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: {
        "agency-canonical-id": {
          slug: "minnesota-state-patrol-icalid",
          locationPathId: "saint-paul-location-path",
        },
      },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          location_path_id: "saint-paul-location-path",
          latitude: undefined,
          longitude: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "latitude", "longitude"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path"),
      },
    ]);
    const write = vi.fn(async () => undefined);

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      sourceNamespace: "mn-post",
      resolvedProperties,
      resolvedPropertyCache: {
        read: async () => undefined,
        write,
      },
      resolveAgencyCoordinates: async () => [
        {
          rowId: "agency-canonical-id",
          latitude: 44.955097,
          longitude: -93.102211,
        },
      ],
    });

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: {
          apiVersion: "policeconduct.org/intake/v1alpha1",
          kind: "Agency",
          name: "agency-canonical-id",
        },
        source: expect.objectContaining({
          namespace: "mn-post",
          kind: "Agency",
          name: "agency-source-id",
        }),
        targetProperty: "latitude",
        value: 44.955097,
      }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: {
          apiVersion: "policeconduct.org/intake/v1alpha1",
          kind: "Agency",
          name: "agency-canonical-id",
        },
        source: expect.objectContaining({
          namespace: "mn-post",
          kind: "Agency",
          name: "agency-source-id",
        }),
        targetProperty: "longitude",
        value: -93.102211,
      }),
    );
  });

  test("new agency insert resolves missing address coordinates without changing a valid location path", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: {
        "agency-canonical-id": {
          slug: "minnesota-state-patrol-icalid",
          locationPathId: "saint-paul-location-path",
          latitude: 44.955097,
        },
      },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          location_path_id: "saint-paul-location-path",
          latitude: 44.955097,
          longitude: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "latitude", "longitude"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: locationPathSnapshot("saint-paul-location-path"),
      },
    ]);
    const resolveAgencyCoordinates = vi.fn(async () => [
      {
        rowId: "agency-canonical-id",
        latitude: 44.955097,
        longitude: -93.102211,
      },
    ]);

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      resolvedProperties,
      resolveAgencyCoordinates,
    });

    expect(resolveAgencyCoordinates).toHaveBeenCalledTimes(1);
    expect(
      client.queries.some(({ text }) =>
        /insert into\s+public\.location_path\b/i.test(text),
      ),
    ).toBe(false);
    expect(partialRows.agencies[0]?.location_path_id).toBe(
      "saint-paul-location-path",
    );
    expect(partialRows.agencies[0]?.latitude).toBe(44.955097);
    expect(partialRows.agencies[0]?.longitude).toBe(-93.102211);
    expect(resolvedProperties.agencies["agency-canonical-id"]).toMatchObject({
      locationPathId: "saint-paul-location-path",
      latitude: 44.955097,
      longitude: -93.102211,
    });
  });

  test("new agency insert uses supplied coordinates while resolving existing location path", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: { "agency-canonical-id": {} },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      locationPathGeometries: [
        locationPathGeometry("baxter-place-location-path-id", [
          [-94.4, 46.2],
          [-94.2, 46.2],
          [-94.2, 46.4],
          [-94.4, 46.4],
          [-94.4, 46.2],
        ]),
      ],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          city: "Baxter",
          state: "MN",
          zip_code: "56425-1000",
          address: "13190 Memorywood Dr",
          slug: undefined,
          location_path_id: undefined,
          latitude: 46.343130015928,
          longitude: -94.293600020136,
          location: {
            administrativeAreaName: "Crow Wing County",
            administrativeAreaSlug: "crow-wing-county",
          },
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": [
            "name",
            "city",
            "state",
            "address",
            "latitude",
            "longitude",
          ],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        rows: [
          {
            location_path_id: "baxter-place-location-path-id",
            path: "/mn/crow-wing-county/baxter/",
            level: "place",
            state_or_territory_slug: "mn",
            administrative_area_slug: "crow-wing-county",
            place_slug: "baxter",
            state_or_territory_name: "Minnesota",
            administrative_area_name: "Crow Wing County",
            place_name: "Baxter",
            parent_location_path_id: "crow-wing-county-location-path-id",
          },
        ],
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: [
          ...locationPathSnapshot(),
          {
            location_path_id: "baxter-place-location-path-id",
            path: "/mn/crow-wing-county/baxter/",
            level: "place",
            state_or_territory_slug: "mn",
            administrative_area_slug: "crow-wing-county",
            place_slug: "baxter",
            state_or_territory_name: "Minnesota",
            administrative_area_name: "Crow Wing County",
            place_name: "Baxter",
            parent_location_path_id: "crow-wing-county-location-path-id",
          },
        ],
      },
    ]);
    const resolveAgencyCoordinates = vi.fn(async () => []);
    const resolveLocationAdministrativeArea = vi.fn(async () => ({
      administrativeAreaName: "Crow Wing County",
      administrativeAreaSlug: "crow-wing-county",
    }));

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      resolvedProperties,
      resolveAgencyCoordinates,
      resolveLocationAdministrativeArea,
    });

    expect(resolveAgencyCoordinates).not.toHaveBeenCalled();
    expect(resolveLocationAdministrativeArea).not.toHaveBeenCalled();
    expect(partialRows.agencies[0]?.location_path_id).toBe(
      "baxter-place-location-path-id",
    );
    expect(partialRows.agencies[0]?.latitude).toBe(46.343130015928);
    expect(partialRows.agencies[0]?.longitude).toBe(-94.293600020136);
    expect(resolvedProperties.agencies["agency-canonical-id"]).toMatchObject({
      latitude: 46.343130015928,
      longitude: -94.293600020136,
    });
  });

  test("new agency insert resolves location path from address point containment", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: { "agency-canonical-id": {} },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      locationPathGeometries: [
        locationPathGeometry("duluth-location-path", [
          [-92.3, 46.7],
          [-92.0, 46.7],
          [-92.0, 46.9],
          [-92.3, 46.9],
          [-92.3, 46.7],
        ]),
      ],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          city: "Duluth",
          state: "MN",
          zip_code: "55802",
          address: "2030 North Arlington Avenue",
          slug: undefined,
          location_path_id: undefined,
          latitude: undefined,
          longitude: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "city", "state"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern:
          /from public\.location_path lp\s+join public\.location_path_geometry lpg/i,
        rows: [
          {
            location_path_id: "duluth-location-path",
            path: "/mn/st-louis-county/duluth/",
            level: "place",
            state_or_territory_slug: "mn",
            administrative_area_slug: "st-louis-county",
            place_slug: "duluth",
            state_or_territory_name: "Minnesota",
            administrative_area_name: "St. Louis County",
            place_name: "Duluth",
            parent_location_path_id: "st-louis-county-location-path",
          },
        ],
      },
      {
        pattern: /from public\.location_path\b/i,
        rows: [
          {
            location_path_id: "mn-state-location-path",
            path: "/mn/",
            level: "state",
            state_or_territory_slug: "mn",
            administrative_area_slug: null,
            place_slug: null,
            state_or_territory_name: "Minnesota",
            administrative_area_name: null,
            place_name: null,
            parent_location_path_id: null,
          },
          {
            location_path_id: "st-louis-county-location-path",
            path: "/mn/st-louis-county/",
            level: "administrative_area",
            state_or_territory_slug: "mn",
            administrative_area_slug: "st-louis-county",
            place_slug: null,
            state_or_territory_name: "Minnesota",
            administrative_area_name: "St. Louis County",
            place_name: null,
            parent_location_path_id: "mn-state-location-path",
          },
          {
            location_path_id: "duluth-location-path",
            path: "/mn/st-louis-county/duluth/",
            level: "place",
            state_or_territory_slug: "mn",
            administrative_area_slug: "st-louis-county",
            place_slug: "duluth",
            state_or_territory_name: "Minnesota",
            administrative_area_name: "St. Louis County",
            place_name: "Duluth",
            parent_location_path_id: "st-louis-county-location-path",
          },
        ],
      },
    ]);
    const resolveLocationAdministrativeArea = vi.fn();
    const resolveAgencyCoordinates = vi.fn().mockResolvedValue([
      {
        rowId: "agency-canonical-id",
        latitude: 46.835,
        longitude: -92.18,
      },
    ]);

    await planDatabaseMutations(partialRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
      resolvedProperties,
      resolveAgencyCoordinates,
      resolveLocationAdministrativeArea,
    });

    expect(resolveLocationAdministrativeArea).not.toHaveBeenCalled();
    expect(partialRows.agencies[0]?.location_path_id).toBe(
      "duluth-location-path",
    );
    expect(resolvedProperties.agencies["agency-canonical-id"]).toMatchObject({
      slug: "minnesota-state-patrol-icalid",
      locationPathId: "duluth-location-path",
      latitude: 46.835,
      longitude: -92.18,
    });
  });

  test("new agency insert fails loud (not excluded) when a cached location path id does not exist", async () => {
    const resolvedProperties: ResolvedProperties = {
      agencies: {
        "agency-canonical-id": {
          slug: "minnesota-state-patrol-icalid",
          locationPathId: "cached-location-path-id",
        },
      },
      personnel: {},
    };
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          city: "Duluth",
          state: "MN",
          location_path_id: "cached-location-path-id",
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "city", "state", "location_path_id"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\s+where location_path_id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\s+where level = 'place'/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\s+where level = 'state'/i,
        rows: [
          {
            location_path_id: "mn-state-location-path",
            state_or_territory_name: "Minnesota",
          },
        ],
      },
    ]);
    const resolveLocationAdministrativeArea = vi
      .fn()
      .mockResolvedValue(undefined);
    const resolveAgencyCoordinates = vi.fn().mockResolvedValue([]);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await expect(
      planDatabaseMutations(partialRows, {
        env: { DATABASE_URL: "postgres://example/intake" },
        clientFactory: () => client,
        resolvedProperties,
        logger,
        resolveAgencyCoordinates,
        resolveLocationAdministrativeArea,
      }),
    ).rejects.toThrow(
      // The single cached-location-path failure is folded into the grouped
      // "N cached agency location_path_id values do not exist" guidance
      // (see formatPlanningErrors), which still names the source agency.
      "Agency agency-source-id (Minnesota State Patrol): Cached location_path_id cached-location-path-id for public.agency agency-canonical-id does not exist.",
    );
    expect(resolveAgencyCoordinates).not.toHaveBeenCalled();
    expect(resolveLocationAdministrativeArea).not.toHaveBeenCalled();
  });

  test("duplicate prepared location path records fail before database create/read/update", async () => {
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [
        {
          location_path_id: "first-location-path-id",
          path: "/mn/aitkin-county/aitkin/",
          level: "place",
          state_or_territory_slug: "mn",
          administrative_area_slug: "aitkin-county",
          place_slug: "aitkin",
          state_or_territory_name: "Minnesota",
          administrative_area_name: "Aitkin County",
          place_name: "Aitkin",
          parent_location_path_id: "aitkin-county-location-path-id",
        },
        {
          location_path_id: "second-location-path-id",
          path: "/mn/aitkin-county/aitkin/",
          level: "place",
          state_or_territory_slug: "mn",
          administrative_area_slug: "aitkin-county",
          place_slug: "aitkin",
          state_or_territory_name: "Minnesota",
          administrative_area_name: "Aitkin County",
          place_name: "Aitkin",
          parent_location_path_id: "aitkin-county-location-path-id",
        },
      ],
      agencies: [],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {},
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient();

    await expect(
      planDatabaseMutations(partialRows, {
        env: { DATABASE_URL: "postgres://example/intake" },
        clientFactory: () => client,
      }),
    ).rejects.toThrow(
      "Import preparation failed with 1 error:\n- Cannot prepare public.location_path second-location-path-id; path /mn/aitkin-county/aitkin/ already belongs to prepared location path first-location-path-id.",
    );

    expect(
      client.queries.some(({ text }) =>
        /insert into\s+public\.location_path\b/i.test(text),
      ),
    ).toBe(false);
  });

  test("planning prepares records and skips database inserts", async () => {
    const client = new RecordingClient();

    const result = await planDatabaseMutations(rows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
    });

    expect(result.counts).toEqual({
      locationPaths: 0,
      locationPathGeometries: 0,
      locationPathAliases: 0,
      agencies: 1,
      officers: 1,
      agencyOfficers: 1,
      licensingAuthorities: 0,
      licenses: 0,
      licenseActions: 0,
    });
    expect(result.operations).toEqual(
      expect.objectContaining({
        agencies: { "agency-canonical-id": "create" },
        officers: { "personnel-canonical-id": "create" },
        agencyOfficers: { "agency-personnel-canonical-id": "create" },
      }),
    );
    expect(
      client.queries.some(({ text }) => /insert into\s+public\./i.test(text)),
    ).toBe(false);
    expect(
      client.queries.some(({ text }) => /update\s+public\./i.test(text)),
    ).toBe(false);
    expect(client.queries.map(({ text }) => text.toLowerCase())).toContain(
      "rollback",
    );
  });

  test("new agency insert logs and fails loud (not excluded) when a non-dynamic required field is absent", async () => {
    const partialRows: ImportRows = {
      ...rows,
      locationPaths: [],
      agencies: [
        {
          ...rows.agencies[0],
          sourceName: "agency-source-id",
          slug: undefined,
          location_path_id: undefined,
          latitude: undefined,
          longitude: undefined,
        },
      ],
      officers: [],
      agencyOfficers: [],
      ownedColumns: {
        agencies: {
          "agency-canonical-id": ["name", "state"],
        },
        officers: {},
        agencyOfficers: {},
      },
    };
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.agency where id = \$1/i,
        rows: [],
      },
      {
        pattern: /from public\.location_path\b/i,
        values: ["/mn/"],
        rows: [
          {
            location_path_id: "mn-state-location-path",
            path: "/mn/",
            level: "state",
            state_or_territory_slug: "mn",
            administrative_area_slug: null,
            place_slug: null,
            state_or_territory_name: "Minnesota",
            administrative_area_name: null,
            place_name: null,
            parent_location_path_id: null,
          },
        ],
      },
      {
        pattern: /from public\.location_path\b/i,
        values: ["/mn/ramsey-county/"],
        rows: [
          {
            location_path_id: "ramsey-county-location-path",
            path: "/mn/ramsey-county/",
            level: "administrative_area",
            state_or_territory_slug: "mn",
            administrative_area_slug: "ramsey-county",
            place_slug: null,
            state_or_territory_name: "Minnesota",
            administrative_area_name: "Ramsey County",
            place_name: null,
            parent_location_path_id: "mn-state-location-path",
          },
        ],
      },
      {
        pattern: /from public\.location_path\b/i,
        values: ["/mn/ramsey-county/saint-paul/"],
        rows: [
          {
            location_path_id: "saint-paul-location-path",
            path: "/mn/ramsey-county/saint-paul/",
            level: "place",
            state_or_territory_slug: "mn",
            administrative_area_slug: "ramsey-county",
            place_slug: "saint-paul",
            state_or_territory_name: "Minnesota",
            administrative_area_name: "Ramsey County",
            place_name: "Saint Paul",
            parent_location_path_id: "ramsey-county-location-path",
          },
        ],
      },
    ]);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await expect(
      planDatabaseMutations(partialRows, {
        env: { DATABASE_URL: "postgres://example/intake" },
        clientFactory: () => client,
        logger,
      }),
    ).rejects.toThrow(
      "Agency agency-source-id (Minnesota State Patrol): Cannot resolve coordinates for public.agency agency-canonical-id",
    );

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "public.agency",
        entityType: "agency",
        rowId: "agency-canonical-id",
        missingFields: ["slug", "location_path_id", "latitude", "longitude"],
      }),
      "Agency field resolution failed.",
    );
    expect(
      client.queries.some(({ text }) =>
        /insert into\s+public\.agency\b/i.test(text),
      ),
    ).toBe(false);
  });

  test("planning rolls back and ends the client without database writes", async () => {
    const client = new RecordingClient(undefined, {
      pattern: /insert into\s+public\.agency\b/i,
      error: new Error("duplicate key value violates unique constraint"),
    });

    const result = await planDatabaseMutations(rows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
    }).then(
      (counts) => ({ ok: true as const, counts }),
      (error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    expect(result.ok).toBe(true);
    expect(
      client.queries.some(({ text }) => /insert into\s+public\./i.test(text)),
    ).toBe(false);
    expect(
      client.queries.some(({ text }) => /update\s+public\./i.test(text)),
    ).toBe(false);
    expect(client.queries.map(({ text }) => text.toLowerCase())).toContain(
      "rollback",
    );
    expect(client.ended).toBe(true);
  });

  const licensingRows: ImportRows = {
    ...rows,
    locationPaths: [],
    agencies: [],
    officers: [],
    agencyOfficers: [],
    licensingAuthorities: [
      {
        id: "authority-canonical-id",
        name: "Texas Commission on Law Enforcement",
        abbreviation: "TCOLE",
        website: "https://www.tcole.texas.gov",
        location_path_id: "tx-location-path-id",
      },
    ],
    licenses: [
      {
        id: "license-canonical-id",
        officer_id: "personnel-canonical-id",
        license_type: "Peace Officer License",
        status: null,
        first_awarded: "1994-06-16",
        issued_by_authority_id: "authority-canonical-id",
      },
    ],
    licenseActions: [
      {
        id: "license-action-canonical-id",
        license_id: "license-canonical-id",
        action: "Issued",
        action_date: "1994-06-16",
        status: null,
      },
    ],
    ownedColumns: {
      agencies: {},
      officers: {},
      agencyOfficers: {},
      licensingAuthorities: {
        "authority-canonical-id": [
          "name",
          "abbreviation",
          "website",
          "location_path_id",
        ],
      },
      licenses: {
        "license-canonical-id": [
          "officer_id",
          "license_type",
          "status",
          "first_awarded",
          "issued_by_authority_id",
        ],
      },
      licenseActions: {
        "license-action-canonical-id": [
          "license_id",
          "action",
          "action_date",
          "status",
        ],
      },
    },
  };

  test("plans licensing authority, license, and license action rows as creates", async () => {
    const client = new RecordingClient();

    const result = await planDatabaseMutations(licensingRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
    });

    expect(result.counts).toEqual({
      locationPaths: 0,
      locationPathGeometries: 0,
      locationPathAliases: 0,
      agencies: 0,
      officers: 0,
      agencyOfficers: 0,
      licensingAuthorities: 1,
      licenses: 1,
      licenseActions: 1,
    });
    expect(result.operations.licensingAuthorities).toEqual({
      "authority-canonical-id": "create",
    });
    expect(result.operations.licenses).toEqual({
      "license-canonical-id": "create",
    });
    expect(result.operations.licenseActions).toEqual({
      "license-action-canonical-id": "create",
    });
    expect(
      client.queries.some(({ text }) => /insert into\s+public\./i.test(text)),
    ).toBe(false);
    expect(client.queries.map(({ text }) => text.toLowerCase())).toContain(
      "rollback",
    );
  });

  test("plans existing licensing rows as updates without upsert or writes", async () => {
    const client = new RecordingClient(undefined, undefined, [
      {
        pattern: /select \* from public\.licensing_authority\b/i,
        rows: [{ id: "authority-canonical-id" }],
      },
      {
        pattern: /select \* from public\.license\b/i,
        rows: [{ id: "license-canonical-id" }],
      },
      {
        pattern: /select \* from public\.license_action\b/i,
        rows: [{ id: "license-action-canonical-id" }],
      },
    ]);

    const result = await planDatabaseMutations(licensingRows, {
      env: { DATABASE_URL: "postgres://example/intake" },
      clientFactory: () => client,
    });

    expect(result.operations.licensingAuthorities["authority-canonical-id"]).toBe(
      "update",
    );
    expect(result.operations.licenses["license-canonical-id"]).toBe("update");
    expect(
      result.operations.licenseActions["license-action-canonical-id"],
    ).toBe("update");

    const sql = client.queries.map(({ text }) => text).join("\n");
    expect(sql).not.toMatch(/\bon\s+conflict\b/i);
    expect(sql).not.toMatch(/\bdo\s+nothing\b/i);
    expect(
      client.queries.some(({ text }) => /insert into\s+public\./i.test(text)),
    ).toBe(false);
    expect(
      client.queries.some(({ text }) => /update\s+public\./i.test(text)),
    ).toBe(false);
    expect(client.queries.map(({ text }) => text.toLowerCase())).toContain(
      "rollback",
    );
  });
});
