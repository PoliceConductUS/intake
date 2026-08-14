import { describe, expect, test } from "vitest";
import type { ResolvedProperties } from "../src/cli/import/artifacts/transform.js";
import type {
  ImportArtifactKind,
  ArtifactsEnvelope,
} from "../src/shared/io/Artifacts.js";
import type { SourceNameToCanonicalIds } from "../src/cli/state/source-name-to-canonical-id/index.js";
import { transformArtifacts } from "../src/cli/import/artifacts/transform.js";

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
  personnel_id: "003-personnel-source",
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
  agencies: {
    [agency.id]: {
      canonicalId: "agency-canonical-id",
    },
  },
  personnel: {
    [personnel.id]: {
      canonicalId: "personnel-canonical-id",
    },
  },
  agencyPersonnel: {
    [roster.id]: {
      canonicalId: "agency-personnel-canonical-id",
    },
  },
} satisfies SourceNameToCanonicalIds;

const resolvedProperties: ResolvedProperties = {
  agencies: {
    "agency-canonical-id": {
      slug: "minnesota-state-patrol",
      locationPathId: "mn/saint-paul/minnesota-state-patrol",
      latitude: 44.955097,
      longitude: -93.102211,
    },
  },
  personnel: {
    "personnel-canonical-id": {
      slug: "spenser-stockwell",
    },
  },
};

type EntityName = "agencies" | "personnel" | "agencyPersonnel";

function artifactsWithInvalidRequiredField(
  entityName: EntityName,
  sourceName: string,
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
  test("transforms artifacts-provided location paths and aliases", () => {
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
          centroid: {
            type: "Point",
            coordinates: [-93.09, 44.9537],
          },
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

    const rows = transformArtifacts(artifacts, {
      locationPaths: {
        "/mn/ramsey-county/saint-paul/": {
          canonicalId: "saint-paul-location-path",
        },
        "/mn/ramsey-county/": {
          canonicalId: "ramsey-county-location-path",
        },
      },
      agencies: {},
      personnel: {},
      agencyPersonnel: {},
    });

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
        centroid: {
          type: "Point",
          coordinates: [-93.09, 44.9537],
        },
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

  test("allows location path source names to differ from source location paths", () => {
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

    const rows = transformArtifacts(artifacts, {
      locationPaths: {
        "place:GEOID:2758000": {
          canonicalId: "canonical-location-path-id",
        },
        "administrative_area:GEOID:27123": {
          canonicalId: "ramsey-county-location-path",
        },
      },
      agencies: {},
      personnel: {},
      agencyPersonnel: {},
    });

    expect(rows.locationPaths[0]).toMatchObject({
      location_path_id: "canonical-location-path-id",
      parent_location_path_id: "ramsey-county-location-path",
      path: "/mn/ramsey-county/saint-paul/",
    });
  });

  test("transforms artifacts entities into database rows with canonical mappings", () => {
    const artifacts = artifactsWithEntities({
      agencies: {
        [agency.id]: agency,
      },
      personnel: {
        [personnel.id]: personnel,
      },
      agencyPersonnel: {
        [roster.id]: roster,
      },
    });

    const rows = transformArtifacts(artifacts, mappings, resolvedProperties);

    expect(rows).toEqual({
      locationPaths: [],
      locationPathGeometries: [],
      locationPathAliases: [],
      agencies: [
        {
          sourceName: "a2j-agency-source",
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
    });
  });

  // Personnel is facade-based (ADR 0016): the canonical-id find-or-create and
  // unique-slug generation are exercised in data-context.test.ts, not here — the
  // transform no longer produces personnel rows.

  test("rejects unknown source record fields", () => {
    const artifacts = artifactsWithEntities({
      agencies: {
        [agency.id]: { ...agency, unsupported: "rejected" },
      },
    });

    expect(() =>
      transformArtifacts(artifacts, mappings, resolvedProperties),
    ).toThrow(
      "Artifacts Agencies record a2j-agency-source is malformed at unsupported.",
    );
  });

  test("preserves agency mutation enrichment containers for import preparation", () => {
    const artifacts = artifactsWithEntities({
      agencies: {
        [agency.id]: {
          ...agency,
          latitude: 46.343130015928,
          longitude: -94.293600020136,
          addresses: {
            physical: "13190 Memorywood Dr, Baxter, MN 56425",
            mailing: "PO Box 380, Baxter, MN 56425",
          },
          location: {
            administrativeAreaName: "Crow Wing County",
            administrativeAreaSlug: "crow-wing-county",
          },
          phones: { main: "(218) 454-5090" },
          urls: {
            website: "https://www.baxtermn.gov/government/departments/police",
          },
        },
      },
    });

    const rows = transformArtifacts(artifacts, mappings, {
      agencies: { "agency-canonical-id": {} },
      personnel: {},
    });

    expect(rows.agencies[0]).toMatchObject({
      latitude: 46.343130015928,
      longitude: -94.293600020136,
      addresses: {
        physical: "13190 Memorywood Dr, Baxter, MN 56425",
        mailing: "PO Box 380, Baxter, MN 56425",
      },
      location: {
        administrativeAreaName: "Crow Wing County",
        administrativeAreaSlug: "crow-wing-county",
      },
      phones: { main: "(218) 454-5090" },
      urls: {
        website: "https://www.baxtermn.gov/government/departments/police",
      },
    });
  });

  test("owns only supported source fields present in the artifacts plus intake mapping fields", () => {
    const artifacts = artifactsWithEntities({
      agencies: {
        [agency.id]: {
          id: agency.id,
          name: agency.name,
          state: agency.state,
        },
      },
    });

    const rows = transformArtifacts(artifacts, mappings, resolvedProperties);

    expect(rows.ownedColumns.agencies["agency-canonical-id"]).toEqual([
      "name",
      "state",
      "slug",
      "location_path_id",
      "latitude",
      "longitude",
    ]);
  });

  test("allows source agency fields to be absent until database create needs them", () => {
    const artifacts = artifactsWithEntities({
      agencies: {
        [agency.id]: {
          id: agency.id,
          name: agency.name,
          state: agency.state,
        },
      },
    });
    const partialMappings: SourceNameToCanonicalIds = {
      locationPaths: {},
      agencies: {
        [agency.id]: {
          canonicalId: "agency-canonical-id",
        },
      },
      personnel: {},
      agencyPersonnel: {},
    };
    const partialResolvedProperties: ResolvedProperties = {
      agencies: {
        "agency-canonical-id": {},
      },
      personnel: {},
    };

    const rows = transformArtifacts(
      artifacts,
      partialMappings,
      partialResolvedProperties,
    );

    expect(rows.agencies).toEqual([
      {
        sourceName: "a2j-agency-source",
        id: "agency-canonical-id",
        name: "Minnesota State Patrol",
        city: null,
        state: "MN",
        address: null,
        zip_code: null,
        contact_name: null,
        contact_email: null,
        slug: undefined,
        location_path_id: undefined,
        latitude: undefined,
        longitude: undefined,
      },
    ]);
    expect(rows.ownedColumns.agencies["agency-canonical-id"]).toEqual([
      "name",
      "state",
    ]);
  });

  test("fails before returning rows when agency-personnel references an unmapped agency", () => {
    const artifacts = artifactsWithEntities({
      agencies: { [agency.id]: agency },
      personnel: { [personnel.id]: personnel },
      agencyPersonnel: {
        [roster.id]: { ...roster, agency_id: "missing-agency" },
      },
    });

    expect(() =>
      transformArtifacts(artifacts, mappings, resolvedProperties),
    ).toThrow(
      "Agency-personnel source record a2m-roster-source references unmapped agency missing-agency.",
    );
  });

  test("fails before returning rows when agency-personnel references unmapped personnel", () => {
    const artifacts = artifactsWithEntities({
      agencies: { [agency.id]: agency },
      personnel: { [personnel.id]: personnel },
      agencyPersonnel: {
        [roster.id]: { ...roster, personnel_id: "missing-personnel" },
      },
    });

    expect(() =>
      transformArtifacts(artifacts, mappings, resolvedProperties),
    ).toThrow(
      "Agency-personnel source record a2m-roster-source references unmapped personnel missing-personnel.",
    );
  });

  // License and LicenseAction foreign-key resolution moved from the transform to
  // the LicenseFacade / LicenseActionFacade resolvers (ADR 0016); they no longer
  // produce transform rows. Their emit + FK-find behavior is covered by the
  // DataContext facade tests. The agency-personnel `license_id` reference below
  // still resolves against the mappings ledger (AgencyPersonnel stays row-based).

  test("resolves an agency-personnel license_id reference to its canonical license id", () => {
    const artifacts = artifactsWithEntities({
      agencies: { [agency.id]: agency },
      personnel: { [personnel.id]: personnel },
      agencyPersonnel: {
        [roster.id]: {
          ...roster,
          license_id: "003-personnel-source|Peace Officer License",
        },
      },
    });

    const rows = transformArtifacts(
      artifacts,
      {
        ...mappings,
        licenses: {
          "003-personnel-source|Peace Officer License": {
            canonicalId: "license-canonical-id",
          },
        },
      },
      resolvedProperties,
    );

    expect(rows.agencyOfficers[0]?.license_id).toBe("license-canonical-id");
  });

  test("fails when an agency-personnel license_id reference is unmapped", () => {
    const artifacts = artifactsWithEntities({
      agencies: { [agency.id]: agency },
      personnel: { [personnel.id]: personnel },
      agencyPersonnel: {
        [roster.id]: { ...roster, license_id: "missing-license" },
      },
    });

    expect(() =>
      transformArtifacts(artifacts, mappings, resolvedProperties),
    ).toThrow(
      "Agency-personnel source record a2m-roster-source references unmapped license missing-license.",
    );
  });

  // LicensingAuthority location resolve-or-fail and License authority/officer FK
  // resolution moved from the transform to their facades' resolvers (ADR 0016);
  // covered by the DataContext facade tests.

  test.each([
    ["agencies", agency.id, "name"],
    ["agencies", agency.id, "state"],
    ["personnel", personnel.id, "first_name"],
    ["personnel", personnel.id, "last_name"],
    ["agencyPersonnel", roster.id, "start_date"],
  ] as const)(
    "fails before returning rows when %s source record %s has an invalid required field %s",
    (entityName, sourceName, fieldName) => {
      for (const value of [undefined, null, 49112]) {
        const artifacts = artifactsWithInvalidRequiredField(
          entityName,
          sourceName,
          fieldName,
          value,
        );

        expect(() =>
          transformArtifacts(artifacts, mappings, resolvedProperties),
        ).toThrow(
          `Artifacts ${entityName === "agencyPersonnel" ? "AgencyPersonnel" : entityName === "personnel" ? "Personnel" : "Agencies"} record ${sourceName} is malformed at ${fieldName}.`,
        );
      }
    },
  );
});
