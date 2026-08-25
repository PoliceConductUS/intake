import { describe, expect, test } from "vitest";
import type {
  ImportArtifactKind,
  ArtifactsEnvelope,
} from "../src/shared/io/Artifacts.js";
import type { SourceNameToCanonicalIds } from "../src/cli/state/source-name-to-canonical-id/index.js";
import { transformArtifacts } from "../src/cli/import/artifacts/transform.js";
import { fakeSourceNameLedger } from "./cli/state/fake-source-name-ledger.js";

const agency = {
  id: "a2j-agency-source",
  name: "Minnesota State Patrol",
  city: "Saint Paul",
  state: "MN",
  address: "444 Cedar Street",
  zip_code: "55101",
  contact_name: null,
  contact_email: null,
};

const personnel = {
  id: "003-personnel-source",
  first_name: "Spenser",
  last_name: "Stockwell",
  middle_name: null,
  prefix: null,
  suffix: null,
};

const roster = {
  id: "a2m-roster-source",
  agency_id: "a2j-agency-source",
  officer_id: "003-personnel-source",
  badge_number: "49112",
  start_date: "2020-01-01",
  end_date: null,
  title: "Peace Officer",
};

type EntityMaps = {
  locationPaths?: Record<string, unknown>;
  locationPathAliases?: Record<string, unknown>;
  agencies?: Record<string, unknown>;
  personnel?: Record<string, unknown>;
  agencyPersonnel?: Record<string, unknown>;
  licensingAuthorities?: Record<string, unknown>;
  licenses?: Record<string, unknown>;
  licenseActions?: Record<string, unknown>;
};

function artifactsWithEntities(entities: EntityMaps): ArtifactsEnvelope {
  const kindByEntityName = {
    locationPaths: "LocationPaths",
    locationPathAliases: "LocationPathAliases",
    agencies: "Agencies",
    personnel: "Personnel",
    agencyPersonnel: "AgencyPersonnel",
    licensingAuthorities: "LicensingAuthorities",
    licenses: "Licenses",
    licenseActions: "LicenseActions",
  } satisfies Record<keyof EntityMaps, ImportArtifactKind>;
  return {
    apiVersion: "policeconduct.org/intake/v1alpha1",
    kind: "Artifacts",
    metadata: { name: "test-run", namespace: "mn-post" },
    spec: {
      artifacts: Object.entries(entities).map(([entityName, records]) => ({
        kind: kindByEntityName[entityName as keyof EntityMaps],
        spec: { records },
      })),
    },
  };
}

const mappings = {
  locationPaths: {},
  agencies: { [agency.id]: { canonicalId: "agency-canonical-id" } },
  personnel: { [personnel.id]: { canonicalId: "personnel-canonical-id" } },
  agencyPersonnel: {
    [roster.id]: { canonicalId: "agency-personnel-canonical-id" },
  },
} satisfies SourceNameToCanonicalIds;

type EntityName = "agencies" | "personnel" | "agencyPersonnel";

function artifactsWithInvalidRequiredField(
  entityName: EntityName,
  fieldName: string,
  value: unknown,
): ArtifactsEnvelope {
  const invalidEntity: Record<string, unknown> =
    entityName === "agencies"
      ? { ...agency }
      : entityName === "personnel"
        ? { ...personnel }
        : { ...roster };

  if (value === undefined) {
    delete invalidEntity[fieldName];
  } else {
    invalidEntity[fieldName] = value;
  }

  return artifactsWithEntities({
    agencies: {
      [agency.id]: entityName === "agencies" ? invalidEntity : agency,
    },
    personnel: {
      [personnel.id]: entityName === "personnel" ? invalidEntity : personnel,
    },
    agencyPersonnel: {
      [roster.id]: entityName === "agencyPersonnel" ? invalidEntity : roster,
    },
  });
}

describe("transformArtifacts", () => {
  test("transforms artifacts-provided location paths and aliases", async () => {
    const artifacts = artifactsWithEntities({
      locationPaths: {
        "/mn/ramsey-county/saint-paul/": {
          location_path_id: "/mn/ramsey-county/saint-paul/",
          path: "/mn/ramsey-county/saint-paul/",
          level: "place",
          state_or_territory_slug: "mn",
          administrative_area_slug: "ramsey-county",
          place_slug: "saint-paul",
          state_or_territory_name: "Minnesota",
          administrative_area_name: "Ramsey County",
          place_name: "Saint Paul",
          parent_location_path_id: "/mn/ramsey-county/",
          centroid: { type: "Point", coordinates: [-93.09, 44.9537] },
          bbox: {
            type: "Polygon",
            coordinates: [
              [
                [-93.23, 44.88],
                [-92.98, 44.88],
                [-92.98, 45.03],
                [-93.23, 45.03],
                [-93.23, 44.88],
              ],
            ],
          },
        },
      },
      locationPathAliases: {
        "st-paul-alias": {
          alias_path: "/mn/ramsey-county/st-paul/",
          location_path_id: "saint-paul-location-path",
        },
      },
    });

    const rows = await transformArtifacts(
      artifacts,
      fakeSourceNameLedger({
        locationPaths: {
          "/mn/ramsey-county/saint-paul/": {
            canonicalId: "saint-paul-location-path",
          },
          "/mn/ramsey-county/": {
            canonicalId: "ramsey-county-location-path",
          },
        },
      }),
    );

    expect(rows.locationPaths).toEqual([
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
        centroid: { type: "Point", coordinates: [-93.09, 44.9537] },
        bbox: {
          type: "Polygon",
          coordinates: [
            [
              [-93.23, 44.88],
              [-92.98, 44.88],
              [-92.98, 45.03],
              [-93.23, 45.03],
              [-93.23, 44.88],
            ],
          ],
        },
      },
    ]);
    expect(rows.locationPathAliases).toEqual([
      {
        alias_path: "/mn/ramsey-county/st-paul/",
        location_path_id: "saint-paul-location-path",
      },
    ]);
  });

  test("allows location path source names to differ from source location paths", async () => {
    const artifacts = artifactsWithEntities({
      locationPaths: {
        "place:GEOID:2758000": {
          location_path_id: "/mn/ramsey-county/saint-paul/",
          path: "/mn/ramsey-county/saint-paul/",
          level: "place",
          state_or_territory_slug: "mn",
          administrative_area_slug: "ramsey-county",
          place_slug: "saint-paul",
          state_or_territory_name: "Minnesota",
          administrative_area_name: "Ramsey County",
          place_name: "Saint Paul",
          parent_location_path_id: "administrative_area:GEOID:27123",
        },
      },
    });

    const rows = await transformArtifacts(
      artifacts,
      fakeSourceNameLedger({
        locationPaths: {
          "place:GEOID:2758000": { canonicalId: "canonical-location-path-id" },
          "administrative_area:GEOID:27123": {
            canonicalId: "ramsey-county-location-path",
          },
        },
      }),
    );

    expect(rows.locationPaths[0]).toMatchObject({
      location_path_id: "canonical-location-path-id",
      parent_location_path_id: "ramsey-county-location-path",
      path: "/mn/ramsey-county/saint-paul/",
    });
  });

  // Agency, Personnel, and AgencyPersonnel mutation building moved from the
  // transform to their facades (ADR 0016/0019); the transform only validates
  // their source records against the schema and builds location-path rows.

  test("rejects unknown source record fields", async () => {
    const artifacts = artifactsWithEntities({
      agencies: { [agency.id]: { ...agency, unsupported: "rejected" } },
    });

    await expect(
      transformArtifacts(artifacts, fakeSourceNameLedger(mappings)),
    ).rejects.toThrow(
      "Artifacts Agencies record a2j-agency-source is malformed at unsupported.",
    );
  });

  test.each([
    ["agencies", agency.id, "name"],
    ["agencies", agency.id, "state"],
    ["personnel", personnel.id, "first_name"],
    ["agencyPersonnel", roster.id, "start_date"],
  ] as const)(
    "fails before returning rows when %s source record %s has an invalid required field %s",
    async (entityName, sourceName, fieldName) => {
      for (const value of [undefined, null, 49112]) {
        const artifacts = artifactsWithInvalidRequiredField(
          entityName,
          fieldName,
          value,
        );

        await expect(
          transformArtifacts(artifacts, fakeSourceNameLedger(mappings)),
        ).rejects.toThrow(
          `Artifacts ${entityName === "agencyPersonnel" ? "AgencyPersonnel" : entityName === "personnel" ? "Personnel" : "Agencies"} record ${sourceName} is malformed at ${fieldName}.`,
        );
      }
    },
  );

  test("accepts a null last_name (some officers have no last name in the source)", async () => {
    const artifacts = artifactsWithEntities({
      agencies: { [agency.id]: agency },
      personnel: { [personnel.id]: { ...personnel, last_name: null } },
      agencyPersonnel: { [roster.id]: roster },
    });

    await expect(
      transformArtifacts(artifacts, fakeSourceNameLedger(mappings)),
    ).resolves.toBeDefined();
  });
});
