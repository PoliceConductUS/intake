import { describe, expect, test } from "vitest";
import type {
  ImportArtifactKind,
  ArtifactsEnvelope,
} from "../src/shared/io/Artifacts.js";
import { validateArtifactRecords } from "../src/cli/import/artifacts/validate-artifact-records.js";

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

describe("validateArtifactRecords", () => {
  test("rejects unknown source record fields", async () => {
    const artifacts = artifactsWithEntities({
      agencies: { [agency.id]: { ...agency, unsupported: "rejected" } },
    });

    expect(() => validateArtifactRecords(artifacts)).toThrow(
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

        expect(() => validateArtifactRecords(artifacts)).toThrow(
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

    expect(() => validateArtifactRecords(artifacts)).not.toThrow();
  });
});
