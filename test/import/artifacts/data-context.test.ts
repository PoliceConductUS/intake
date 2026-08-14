import { describe, expect, test } from "vitest";
import {
  AgencyFacade,
  DataContext,
} from "../../../src/cli/import/artifacts/data-context.js";
import type { DatabaseClient } from "../../../src/cli/database/index.js";
import type {
  ImportRows,
  LocationPathRow,
} from "../../../src/cli/import/artifacts/transform.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";

class EmptyClient implements DatabaseClient {
  async connect(): Promise<void> {}

  async query(
    _text = "",
    _values: readonly unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    return { rows: [] };
  }

  async end(): Promise<void> {}
}

class BoundaryClient extends EmptyClient {
  async query(text: string): Promise<{ rows: Record<string, unknown>[] }> {
    if (/join public\.location_path_geometry\b/i.test(text)) {
      return {
        rows: locationPaths.filter(
          (locationPath) => locationPath.level === "place",
        ),
      };
    }

    return { rows: [] };
  }
}

const rows: ImportRows = {
  locationPaths: [],
  locationPathAliases: [],
  agencies: [],
  officers: [],
  agencyOfficers: [],
  preparationMutations: [],
  ownedColumns: {
    agencies: {},
    officers: {},
    agencyOfficers: {},
  },
};

const locationPaths: LocationPathRow[] = [
  {
    location_path_id: "mn-location-path-id",
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
    parent_location_path_id: "mn-location-path-id",
  },
  {
    location_path_id: "saint-paul-location-path-id",
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

describe("DataContext", () => {
  test("AgencyFacade emits AgencyCreate when no current database row exists", () => {
    const agency = new AgencyFacade();
    agency.merge({
      name: "Minnesota State Patrol",
      city: "Saint Paul",
      state: "MN",
      address: "444 Cedar Street",
      zip_code: "55101",
      contact_name: null,
      contact_email: null,
      slug: "minnesota-state-patrol",
      location_path_id: "saint-paul-location-path-id",
      latitude: 44.955097,
      longitude: -93.102211,
    });

    expect(
      agency.toMutation({
        namespace: "mn-post",
        name: "mn-state-patrol",
        canonicalId: "agency-canonical-id",
        commandName: "command-name",
      }),
    ).toMatchObject({
      kind: "AgencyCreate",
      metadata: { namespace: "mn-post", name: "mn-state-patrol" },
      spec: {
        id: "agency-canonical-id",
        name: "Minnesota State Patrol",
        slug: "minnesota-state-patrol",
        location_path_id: "saint-paul-location-path-id",
      },
    });
  });

  test("AgencyFacade refuses partial AgencyCreate mutations", () => {
    const agency = new AgencyFacade();
    agency.merge({
      name: "Minnesota State Patrol",
      state: "MN",
    });

    // The slug invariant fails loud (naming the agency) before the AgencyCreate
    // schema would reject the partial spec.
    expect(() =>
      agency.toMutation({
        namespace: "mn-post",
        name: "mn-state-patrol",
        canonicalId: "agency-canonical-id",
        commandName: "command-name",
      }),
    ).toThrow("without a resolved slug");
  });

  test("DatabaseMutations rejects unresolved required create fields", () => {
    const invalidRows: ImportRows = {
      ...rows,
      agencies: [
        {
          ...rows.agencies[0],
          latitude: undefined,
          longitude: undefined,
        },
      ],
      ownedColumns: {
        ...rows.ownedColumns,
        agencies: {
          "agency-canonical-id": ["name", "latitude", "longitude"],
        },
      },
    };

    expect(() =>
      new DataContext({ rows: invalidRows }).toDatabaseMutations({
        namespace: "mn-post",
        name: "command-name",
      }),
    ).toThrow("DatabaseMutations is malformed");
  });

  test("AgencyFacade emits AgencyUpdate with checks and from-to sets when current row exists", () => {
    const agency = new AgencyFacade({
      id: "agency-canonical-id",
      name: "Minnesota State Patrol",
      slug: "minnesota-state-patrol",
    });
    agency.merge({
      name: "Minnesota State Patrol",
      slug: "msp",
    });

    expect(
      agency.toMutation({
        namespace: "mn-post",
        name: "mn-state-patrol",
        canonicalId: "agency-canonical-id",
        commandName: "command-name",
      }),
    ).toMatchObject({
      kind: "AgencyUpdate",
      metadata: { namespace: "mn-post", name: "mn-state-patrol" },
      spec: {
        operations: [
          {
            action: "check",
            path: "name",
            value: "Minnesota State Patrol",
          },
          {
            action: "set",
            path: "slug",
            from: "minnesota-state-patrol",
            to: "msp",
          },
        ],
      },
    });
  });

  test("returns the same facade for the same source identity", () => {
    const context = new DataContext({
      client: new EmptyClient(),
      rows,
      databaseLocationPaths: locationPaths,
      databaseLocationPathAliases: [],
    });

    const first = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    first.merge({ name: "Minnesota State Patrol" });

    const second = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });

    expect(second).toBe(first);
    expect(second.string("name")).toBe("Minnesota State Patrol");
  });

  test("creates agency facade with canonical ID from source mapping and collects create mutation", () => {
    const context = new DataContext({
      client: new EmptyClient(),
      rows,
      commandName: "command-name",
      sourceNameToCanonicalIds: {
        agencies: {
          "mn-state-patrol": { canonicalId: "agency-canonical-id" },
        },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      },
    });

    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    agency.merge({
      name: "Minnesota State Patrol",
      city: "Saint Paul",
      state: "MN",
      address: "444 Cedar Street",
      zip_code: "55101",
      contact_name: null,
      contact_email: null,
      slug: "minnesota-state-patrol",
      location_path_id: "saint-paul-location-path-id",
      latitude: 44.955097,
      longitude: -93.102211,
    });

    expect(context.toMutations()).toMatchObject([
      {
        kind: "AgencyCreate",
        metadata: { namespace: "mn-post", name: "mn-state-patrol" },
        spec: { id: "agency-canonical-id" },
      },
    ]);
  });

  test("collects touched facades into a DatabaseMutations envelope", () => {
    const context = new DataContext({
      client: new EmptyClient(),
      rows,
      commandName: "command-name",
      sourceNameToCanonicalIds: {
        agencies: {
          "mn-state-patrol": { canonicalId: "agency-canonical-id" },
        },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      },
    });

    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    agency.merge({
      name: "Minnesota State Patrol",
      city: "Saint Paul",
      state: "MN",
      address: "444 Cedar Street",
      zip_code: "55101",
      contact_name: null,
      contact_email: null,
      slug: "minnesota-state-patrol",
      location_path_id: "saint-paul-location-path-id",
      latitude: 44.955097,
      longitude: -93.102211,
    });

    expect(
      context.toDatabaseMutations({
        namespace: "mn-post",
        name: "command-name",
        sourceArtifactsName: "source-artifacts-name",
      }),
    ).toMatchObject({
      kind: "DatabaseMutations",
      metadata: {
        namespace: "mn-post",
        name: "command-name",
        sourceArtifactsName: "source-artifacts-name",
      },
      spec: {
        mutations: [
          {
            kind: "AgencyCreate",
            name: "mn-state-patrol",
            spec: { id: "agency-canonical-id" },
          },
        ],
      },
    });
  });

  test("emits empty specs for read-only location path mutations", () => {
    const existingLocationPath = locationPaths[0]!;
    const context = new DataContext({
      rows: {
        ...rows,
        locationPaths: [existingLocationPath],
      },
      operations: {
        locationPaths: {
          [existingLocationPath.location_path_id]: "read",
        },
        locationPathGeometries: {},
        locationPathAliases: {},
        agencies: {},
        officers: {},
        agencyOfficers: {},
        licensingAuthorities: {},
        licenses: {},
        licenseActions: {},
      },
    });

    expect(
      context.toDatabaseMutations({
        namespace: "mn-post",
        name: "command-name",
      }),
    ).toMatchObject({
      spec: {
        mutations: [
          {
            kind: "LocationPathRead",
            name: existingLocationPath.location_path_id,
            spec: {},
          },
        ],
      },
    });
  });

  test("creates agency facade with current database row and collects update mutation", () => {
    const context = new DataContext({
      client: new EmptyClient(),
      rows,
      commandName: "command-name",
      sourceNameToCanonicalIds: {
        agencies: {
          "mn-state-patrol": { canonicalId: "agency-canonical-id" },
        },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      },
      databaseAgencies: [
        {
          id: "agency-canonical-id",
          name: "Minnesota State Patrol",
          slug: "minnesota-state-patrol",
        },
      ],
    });

    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    agency.merge({
      name: "Minnesota State Patrol",
      slug: "msp",
    });

    expect(context.toMutations()).toMatchObject([
      {
        kind: "AgencyUpdate",
        metadata: { namespace: "mn-post", name: "mn-state-patrol" },
        spec: {
          operations: [
            { action: "check", path: "name" },
            {
              action: "set",
              path: "slug",
              from: "minnesota-state-patrol",
              to: "msp",
            },
          ],
        },
      },
    ]);
  });

  test("resolves canonical IDs from a source facade property", async () => {
    const context = new DataContext({
      client: new BoundaryClient(),
      rows: {
        ...rows,
        locationPathGeometries: [
          {
            location_path_id: "saint-paul-location-path-id",
            sourceLocationPathKey: "place:GEOID:2743000",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-93.2, 44.9],
                  [-93.0, 44.9],
                  [-93.0, 45.0],
                  [-93.2, 45.0],
                  [-93.2, 44.9],
                ],
              ],
            },
          },
        ],
      },
      databaseLocationPaths: locationPaths,
      databaseLocationPathAliases: [],
      resolveAddress: async () => ({
        latitude: 44.955097,
        longitude: -93.102211,
      }),
    });

    const agency = context.fromSource({
      apiVersion: INTAKE_API_VERSION,
      namespace: "mn-post",
      name: "mn-state-patrol",
    });
    agency.merge({
      name: "Minnesota State Patrol",
      address: "444 Cedar Street",
      city: "Saint Paul",
      state: "MN",
      zip_code: "55101",
    });

    await expect(
      context.canonicalIdFromProperty({
        source: agency,
        property: "location_path_id",
      }),
    ).resolves.toBe("saint-paul-location-path-id");
  });
});
