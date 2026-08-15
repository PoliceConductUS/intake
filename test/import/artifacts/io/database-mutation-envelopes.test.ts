import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseMutations } from "../../../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { AgencyCreate } from "../../../../src/cli/import/artifacts/io/generated-mutations/AgencyCreate.js";
import { AgencyPersonnelUpdate } from "../../../../src/cli/import/artifacts/io/generated-mutations/AgencyPersonnelUpdate.js";
import { AgencyUpdate } from "../../../../src/cli/import/artifacts/io/generated-mutations/AgencyUpdate.js";
import { LocationPathCreate } from "../../../../src/cli/import/artifacts/io/generated-mutations/LocationPathCreate.js";
import { LocationPathUpdate } from "../../../../src/cli/import/artifacts/io/generated-mutations/LocationPathUpdate.js";
import { PersonnelUpdate } from "../../../../src/cli/import/artifacts/io/generated-mutations/PersonnelUpdate.js";

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "intake-database-mutations-"));
}

describe("database mutation envelopes", () => {
  test("DatabaseMutations writes and reads database mutation refs through exact kind IO", async () => {
    const directory = await tempDir();
    const mutation = await AgencyCreate.write(
      directory,
      AgencyCreate.new({
        metadata: { name: "agency-source-name", namespace: "mn-post" },
        spec: {
          id: "agency-canonical-id",
          name: "Minnesota State Patrol",
          city: "Saint Paul",
          state: "MN",
          address: null,
          zip_code: null,
          contact_name: null,
          contact_email: null,
          slug: "minnesota-state-patrol",
          location_path_id: "mn",
          latitude: 44.9537,
          longitude: -93.09,
        },
      }),
    );

    const written = await DatabaseMutations.write(
      directory,
      DatabaseMutations.new({
        metadata: { name: "command-name", namespace: "mn-post" },
        spec: {
          mutations: [
            {
              ref: {
                path: path.basename(mutation.path),
                kind: "AgencyCreate",
              },
            },
          ],
        },
      }),
    );

    await expect(DatabaseMutations.read(written.path)).resolves.toMatchObject({
      kind: "DatabaseMutations",
      metadata: { name: "command-name", namespace: "mn-post" },
      spec: {
        mutations: [
          {
            kind: "AgencyCreate",
            name: "agency-source-name",
            spec: { id: "agency-canonical-id" },
          },
        ],
      },
    });
  });

  test("DatabaseMutations chunks a large mutation set and reads it back whole", async () => {
    const directory = await tempDir();
    // Over MUTATIONS_PER_FILE (5000) so the writer splits into chunk files. Reads
    // have empty specs, so this stays cheap.
    const total = 5001;
    const mutations = Array.from({ length: total }, (_, index) => ({
      kind: "AgencyRead" as const,
      name: `agency-${index}`,
      spec: {},
    }));

    const written = await DatabaseMutations.write(
      directory,
      DatabaseMutations.new({
        metadata: { name: "command-name", namespace: "gov.tx.tcole" },
        spec: { mutations },
      }),
    );

    // The top-level envelope holds only chunk refs — never all mutations inline.
    const raw = await DatabaseMutations.read(written.path, { raw: true });
    expect(raw.spec.mutations).toHaveLength(2);
    expect(
      raw.spec.mutations.every(
        (item) => "ref" in item && item.ref.kind === "DatabaseMutations",
      ),
    ).toBe(true);

    // The ref-expanding read flattens the chunks back to every mutation, in order.
    const expanded = await DatabaseMutations.read(written.path);
    expect(expanded.spec.mutations).toHaveLength(total);
    expect(expanded.spec.mutations[0]).toMatchObject({
      kind: "AgencyRead",
      name: "agency-0",
    });
    expect(expanded.spec.mutations[total - 1]).toMatchObject({
      kind: "AgencyRead",
      name: `agency-${total - 1}`,
    });
  });

  test("DatabaseMutations rejects inline mutations with malformed generated specs", () => {
    expect(() =>
      DatabaseMutations.new({
        metadata: { name: "command-name", namespace: "mn-post" },
        spec: {
          mutations: [
            {
              kind: "AgencyCreate",
              name: "agency-source-name",
              spec: {
                id: "agency-canonical-id",
                name: "Minnesota State Patrol",
                not_a_column: "bad",
              },
            },
          ],
        },
      }),
    ).toThrow("DatabaseMutations is malformed");
  });

  test("AgencyUpdate writes and reads database update operations", async () => {
    const directory = await tempDir();

    const written = await AgencyUpdate.write(
      directory,
      AgencyUpdate.new({
        metadata: { name: "agency-canonical-id", namespace: "intake" },
        spec: {
          operations: [
            {
              action: "set",
              path: "slug",
              from: "minnesota-state-patrol",
              to: "msp",
              reason: "Set agency slug.",
              source: {
                namespace: "intake",
                command: { name: "command-name" },
                kind: "Agency",
                name: "agency-canonical-id",
              },
            },
            {
              action: "check",
              path: "name",
              value: "Minnesota State Patrol",
              reason: "Expected current agency name.",
              source: {
                namespace: "intake",
                command: { name: "command-name" },
                kind: "Agency",
                name: "agency-canonical-id",
              },
            },
          ],
        },
      }),
    );

    await expect(AgencyUpdate.read(written.path)).resolves.toMatchObject({
      kind: "AgencyUpdate",
      metadata: { name: "agency-canonical-id", namespace: "intake" },
      spec: {
        operations: [
          {
            action: "set",
            path: "slug",
            from: "minnesota-state-patrol",
            to: "msp",
          },
          { action: "check", path: "name", value: "Minnesota State Patrol" },
        ],
      },
    });
  });

  test("AgencyUpdate rejects old set value operations", async () => {
    const filePath = path.join(await tempDir(), "agency.AgencyUpdate.yaml");
    await writeFile(
      filePath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: AgencyUpdate",
        "metadata:",
        "  name: agency-canonical-id",
        "  namespace: intake",
        "spec:",
        "  operations:",
        "    - action: set",
        "      path: slug",
        "      value: agency-slug",
        "      reason: old shape",
        "      source:",
        "        namespace: intake",
        "        command:",
        "          name: command-name",
        "        kind: Agency",
        "        name: agency-canonical-id",
      ].join("\n"),
    );

    await expect(AgencyUpdate.read(filePath)).rejects.toThrow(
      "AgencyUpdate is malformed",
    );
  });

  test("AgencyUpdate rejects fields outside the agency table", async () => {
    const filePath = path.join(await tempDir(), "agency.AgencyUpdate.yaml");
    await writeFile(
      filePath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: AgencyUpdate",
        "metadata:",
        "  name: agency-canonical-id",
        "  namespace: intake",
        "spec:",
        "  operations:",
        "    - action: set",
        "      path: not_a_column",
        "      from: old",
        "      to: value",
        "      reason: bad field",
        "      source:",
        "        namespace: intake",
        "        command:",
        "          name: command-name",
        "        kind: Agency",
        "        name: agency-canonical-id",
      ].join("\n"),
    );

    await expect(AgencyUpdate.read(filePath)).rejects.toThrow(
      "AgencyUpdate is malformed",
    );
  });

  test("PersonnelUpdate rejects the wrong value type for a personnel field", async () => {
    const filePath = path.join(
      await tempDir(),
      "personnel.PersonnelUpdate.yaml",
    );
    await writeFile(
      filePath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: PersonnelUpdate",
        "metadata:",
        "  name: personnel-canonical-id",
        "  namespace: intake",
        "spec:",
        "  operations:",
        "    - action: check",
        "      path: slug",
        "      value: 123",
        "      reason: bad type",
        "      source:",
        "        namespace: intake",
        "        command:",
        "          name: command-name",
        "        kind: Personnel",
        "        name: personnel-canonical-id",
      ].join("\n"),
    );

    await expect(PersonnelUpdate.read(filePath)).rejects.toThrow(
      "PersonnelUpdate is malformed",
    );
  });

  test("DatabaseMutations accepts personnel mutation kinds and rejects old person kinds", () => {
    expect(() =>
      DatabaseMutations.new({
        metadata: { name: "command-name", namespace: "mn-post" },
        spec: {
          mutations: [
            {
              kind: "PersonnelCreate",
              name: "personnel-source-name",
              spec: {
                id: "personnel-canonical-id",
                first_name: "Spenser",
                last_name: "Stockwell",
                middle_name: null,
                prefix: null,
                suffix: null,
                slug: "spenser-stockwell",
              },
            },
            {
              kind: "AgencyPersonnelCreate",
              name: "agency-personnel-source-name",
              spec: {
                id: "agency-personnel-canonical-id",
                agency_id: "agency-canonical-id",
                personnel_id: "personnel-canonical-id",
                badge_number: "49112",
                start_date: "2020-01-01",
                end_date: null,
                title: "Peace Officer",
              },
            },
          ],
        },
      }),
    ).not.toThrow();

    expect(() =>
      DatabaseMutations.new({
        metadata: { name: "command-name", namespace: "mn-post" },
        spec: {
          mutations: [
            {
              kind: "PersonCreate",
              name: "person-source-name",
              spec: {
                id: "personnel-canonical-id",
                first_name: "Spenser",
                last_name: "Stockwell",
                slug: "spenser-stockwell",
              },
            },
          ],
        },
      }),
    ).toThrow("DatabaseMutations is malformed");
  });

  test("LocationPathUpdate rejects nested paths", async () => {
    const filePath = path.join(
      await tempDir(),
      "location.LocationPathUpdate.yaml",
    );
    await writeFile(
      filePath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: LocationPathUpdate",
        "metadata:",
        "  name: location-path-id",
        "  namespace: intake",
        "spec:",
        "  operations:",
        "    - action: set",
        "      path: bbox.min_lat",
        "      from: 44.0",
        "      to: 44.1",
        "      reason: nested path",
        "      source:",
        "        namespace: intake",
        "        command:",
        "          name: command-name",
        "        kind: LocationPath",
        "        name: location-path-id",
      ].join("\n"),
    );

    await expect(LocationPathUpdate.read(filePath)).rejects.toThrow(
      "LocationPathUpdate is malformed",
    );
  });

  test("LocationPathCreate accepts centroid and bbox and rejects top-level latitude", () => {
    expect(() =>
      LocationPathCreate.new({
        metadata: { name: "location-path-id", namespace: "intake" },
        spec: {
          location_path_id: "location-path-id",
          path: "/mn/ramsey-county/saint-paul/",
          level: "place",
          state_or_territory_slug: "mn",
          administrative_area_slug: "ramsey-county",
          place_slug: "saint-paul",
          state_or_territory_name: "Minnesota",
          administrative_area_name: "Ramsey County",
          place_name: "Saint Paul",
          parent_location_path_id: "ramsey-county-location-path-id",
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
      }),
    ).not.toThrow();

    expect(() =>
      LocationPathCreate.new({
        metadata: { name: "location-path-id", namespace: "intake" },
        spec: {
          location_path_id: "location-path-id",
          path: "/mn/ramsey-county/saint-paul/",
          level: "place",
          state_or_territory_slug: "mn",
          administrative_area_slug: "ramsey-county",
          place_slug: "saint-paul",
          state_or_territory_name: "Minnesota",
          administrative_area_name: "Ramsey County",
          place_name: "Saint Paul",
          parent_location_path_id: "ramsey-county-location-path-id",
          latitude: 44.9537,
        } as unknown as Parameters<typeof LocationPathCreate.new>[0]["spec"],
      }),
    ).toThrow("LocationPathCreate is malformed");
  });
});
