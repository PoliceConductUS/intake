import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { DatabaseMutations } from "../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { LocationPathCreate } from "../../src/cli/import/artifacts/io/generated-mutations/LocationPathCreate.js";
import { LocationPathGeometryCreate } from "../../src/cli/import/artifacts/io/generated-mutations/LocationPathGeometryCreate.js";
import { replayDatabaseMutations } from "../../src/cli/replay/database-mutations/config.js";
import { importArtifacts } from "../../src/cli/import/artifacts/config.js";
import { Artifacts } from "../../src/shared/io/Artifacts.js";
import { persistSourceNameToCanonicalIds } from "../../src/cli/state/source-name-to-canonical-id/index.js";
import { yamlResourceFileName } from "../../src/shared/io/resource.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "../cli/database/intake-postgres.js";

const LOCATION_PATH_ID = "mn/saint-paul/msp";

function agencySpec(id: string, slug: string): Record<string, unknown> {
  return {
    id,
    name: `Agency ${id}`,
    city: "Saint Paul",
    state: "MN",
    address: "444 Cedar Street",
    zip_code: "55101",
    contact_name: null,
    contact_email: null,
    slug,
    location_path_id: LOCATION_PATH_ID,
    latitude: 44.955097,
    longitude: -93.102211,
  };
}

async function writeEnvelope(
  rootDir: string,
  mutations: { kind: string; name: string; spec: Record<string, unknown> }[],
): Promise<string> {
  const written = await DatabaseMutations.write(
    rootDir,
    DatabaseMutations.new({
      metadata: { name: "run-1", namespace: "mn-post" },
      spec: { mutations },
    }),
  );
  return written.path;
}

async function writeRefEnvelope(
  rootDir: string,
  mutationPath: string,
  kind: string,
): Promise<string> {
  const written = await DatabaseMutations.write(
    rootDir,
    DatabaseMutations.new({
      metadata: { name: "run-1", namespace: "mn-post" },
      spec: {
        mutations: [
          { ref: { path: path.relative(rootDir, mutationPath), kind } },
        ],
      },
    }),
  );
  return written.path;
}

const describeWithDocker = dockerAvailable() ? describe : describe.skip;

describeWithDocker("replay against a real Postgres", () => {
  let db: IntakeDatabase;

  beforeAll(async () => {
    db = await startIntakeDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.truncateAll();
    await db.query(
      `insert into public.location_path (location_path_id, path, level, state_or_territory_slug, display_name)
       values ($1, '/mn/saint-paul/', 'place', 'mn', 'Minnesota')`,
      [LOCATION_PATH_ID],
    );
  });

  test("batches contiguous creates into the same table and applies every row", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-replay-"));
    const envelopePath = await writeEnvelope(
      rootDir,
      [1, 2, 3].map((n) => ({
        kind: "AgencyCreate",
        name: `agency-${n}`,
        spec: agencySpec(`agency-${n}`, `agency-${n}`),
      })),
    );

    const result = await replayDatabaseMutations({
      databaseMutationsPath: envelopePath,
      env: { DATABASE_URL: db.connectionString },
    });

    expect(result.ok).toBe(true);
    const rows = await db.query(
      "select id, slug from public.agency order by id",
    );
    expect(rows.rows).toEqual([
      { id: "agency-1", slug: "agency-1" },
      { id: "agency-2", slug: "agency-2" },
      { id: "agency-3", slug: "agency-3" },
    ]);
  });

  test("fails loud when a create targets an already-existing row", async () => {
    await db.query(
      `insert into public.agency (id, name, city, state, address, zip_code, slug, location_path_id, latitude, longitude)
       values ('agency-1', 'A', 'Saint Paul', 'MN', '444 Cedar', '55101', 'existing', $1, 44.9, -93.1)`,
      [LOCATION_PATH_ID],
    );
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-replay-"));
    const envelopePath = await writeEnvelope(rootDir, [
      {
        kind: "AgencyCreate",
        name: "agency-1",
        spec: agencySpec("agency-1", "a1"),
      },
    ]);

    const result = await replayDatabaseMutations({
      databaseMutationsPath: envelopePath,
      env: { DATABASE_URL: db.connectionString },
    });

    expect(result).toEqual({
      ok: false,
      error: "DatabaseMutation agency-1 cannot create existing Agency.",
    });
    // The transaction rolled back: the pre-existing row is untouched, no partial writes.
    const rows = await db.query("select slug from public.agency");
    expect(rows.rows).toEqual([{ slug: "existing" }]);
  });

  test("applies an update by canonical id (metadata.name is the row key, ADR 0027)", async () => {
    // An existing id-keyed row; its canonical id is what the update must locate.
    await db.query(
      `insert into public.agency (id, name, city, state, address, zip_code, slug, location_path_id, latitude, longitude)
       values ('agency-canonical-id', 'A', 'Saint Paul', 'MN', '444 Cedar', '55101', 'old-slug', $1, 44.9, -93.1)`,
      [LOCATION_PATH_ID],
    );
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-replay-"));
    const source = {
      namespace: "mn-post",
      command: { name: "import" },
      kind: "Agency",
      name: "agency-canonical-id",
    };
    // metadata.name is the canonical id (the row key), NOT the source name — the
    // update spec carries no id, so replay locates the row by metadata.name.
    const envelopePath = await writeEnvelope(rootDir, [
      {
        kind: "AgencyUpdate",
        name: "agency-canonical-id",
        spec: {
          operations: [
            {
              action: "set",
              path: "slug",
              from: "old-slug",
              to: "new-slug",
              reason: "Set Agency slug.",
              source,
            },
          ],
        },
      },
    ]);

    const result = await replayDatabaseMutations({
      databaseMutationsPath: envelopePath,
      env: { DATABASE_URL: db.connectionString },
    });

    expect(result.ok).toBe(true);
    const rows = await db.query(
      "select id, slug from public.agency where id = 'agency-canonical-id'",
    );
    expect(rows.rows).toEqual([
      { id: "agency-canonical-id", slug: "new-slug" },
    ]);
  });

  test("stores a location path centroid and bbox as real PostGIS geometry", async () => {
    await db.query(
      `insert into public.location_path (location_path_id, path, level, state_or_territory_slug, display_name)
       values ('ramsey-county', '/mn/ramsey-county/', 'administrative_area', 'mn', 'Minnesota')`,
    );
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-replay-"));
    const mutation = await LocationPathCreate.write(
      path.join(rootDir, "mutations"),
      LocationPathCreate.new({
        metadata: { name: "lp", namespace: "mn-post" },
        spec: {
          location_path_id: "lp",
          path: "/mn/ramsey-county/saint-paul/",
          level: "place",
          state_or_territory_slug: "mn",
          administrative_area_slug: "ramsey-county",
          place_slug: "saint-paul",
          display_name: "Saint Paul",
          parent_location_path_id: "ramsey-county",
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
      }),
    );
    const envelopePath = await writeRefEnvelope(
      rootDir,
      mutation.path,
      "LocationPathCreate",
    );

    const result = await replayDatabaseMutations({
      databaseMutationsPath: envelopePath,
      env: { DATABASE_URL: db.connectionString },
    });

    expect(result.ok).toBe(true);
    const rows = await db.query(
      `select round(ST_X(centroid::geometry)::numeric, 4) as cx,
              round(ST_Y(centroid::geometry)::numeric, 4) as cy,
              ST_GeometryType(bbox) as bbox_type,
              round(ST_Area(bbox)::numeric, 4) as bbox_area
       from public.location_path where location_path_id = 'lp'`,
    );
    expect(rows.rows).toEqual([
      {
        cx: "-93.0900",
        cy: "44.9537",
        bbox_type: "ST_Polygon",
        bbox_area: "0.0375",
      },
    ]);
  });

  test("stores location path geometry boundary as a real PostGIS value", async () => {
    await db.query(
      `insert into public.location_path (location_path_id, path, level, state_or_territory_slug, display_name)
       values ('lp', '/mn/', 'state', 'mn', 'Minnesota')`,
    );
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-replay-"));
    const mutation = await LocationPathGeometryCreate.write(
      path.join(rootDir, "mutations"),
      LocationPathGeometryCreate.new({
        metadata: { name: "lp", namespace: "mn-post" },
        spec: {
          location_path_id: "lp",
          sourceLocationPathKey: "place:GEOID:2743000",
          geometry: JSON.stringify({
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [-93.2, 44.9],
                  [-93.0, 44.9],
                  [-93.0, 45.0],
                  [-93.2, 45.0],
                  [-93.2, 44.9],
                ],
              ],
            ],
          }),
        },
      }),
    );
    const envelopePath = await writeRefEnvelope(
      rootDir,
      mutation.path,
      "LocationPathGeometryCreate",
    );

    const result = await replayDatabaseMutations({
      databaseMutationsPath: envelopePath,
      env: { DATABASE_URL: db.connectionString },
    });

    expect(result.ok).toBe(true);
    const rows = await db.query(
      `select ST_GeometryType(boundary) as t, ST_SRID(boundary) as srid,
              round(ST_Area(boundary)::numeric, 4) as area
       from public.location_path_geometry where location_path_id = 'lp'`,
    );
    expect(rows.rows).toEqual([
      { t: "ST_MultiPolygon", srid: 4326, area: "0.0200" },
    ]);
  });

  test("imports artifacts end to end and applies the rows to the database", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-pipeline-"));
    const runId = "tz4a98xxat96iws9zmbrgj3a";

    // Seed the place path (+ geometry) the agency resolves into by containment,
    // and the path the streamed geometry attaches to.
    await db.query(
      `insert into public.location_path (location_path_id, path, level, state_or_territory_slug, display_name) values
       ('saint-paul-location-path-id', '/mn/ramsey-county/saint-paul/', 'place', 'mn', 'Minnesota'),
       ('mn/saint-paul/minnesota-state-patrol', '/mn/state-patrol-geometry/', 'place', 'mn', 'Minnesota')`,
    );
    await db.query(
      "insert into public.location_path_geometry (location_path_id, boundary) values ('saint-paul-location-path-id', ST_GeomFromGeoJSON($1))",
      [
        JSON.stringify({
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
        }),
      ],
    );

    const writtenArtifacts = await Artifacts.write(
      rootDir,
      Artifacts.new({
        metadata: { name: "test-run", namespace: "mn-post" },
        spec: {
          artifacts: [
            {
              kind: "LocationPathGeometries",
              spec: {
                records: {
                  "saint-paul-geometry": {
                    spec: {
                      location_path_id: "/mn/ramsey-county/saint-paul/",
                      sourceLocationPathKey: "place:GEOID:2743000",
                      geometry: JSON.stringify({
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
                      }),
                    },
                  },
                },
              },
            },
            {
              kind: "Agencies",
              spec: {
                records: {
                  "agency-source-id": {
                    spec: {
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
                    },
                  },
                },
              },
            },
            {
              kind: "Personnel",
              spec: {
                records: {
                  "personnel-source-id": {
                    spec: {
                      first_name: "Spenser",
                      last_name: "Stockwell",
                      middle_name: null,
                      prefix: null,
                      suffix: null,
                      slug: "spenser-stockwell",
                    },
                  },
                },
              },
            },
            {
              kind: "AgencyPersonnel",
              spec: {
                records: {
                  "agency-personnel-source-id": {
                    spec: {
                      agency_id: "agency-source-id",
                      personnel_id: "personnel-source-id",
                      badge_number: "49112",
                      start_date: "2020-01-01",
                      end_date: null,
                      title: "Peace Officer",
                    },
                  },
                },
              },
            },
          ],
        },
      }),
    );
    await persistSourceNameToCanonicalIds(
      "mn-post",
      {
        locationPaths: {
          "place:GEOID:2743000": {
            kind: "LocationPath",
            canonicalId: "mn/saint-paul/minnesota-state-patrol",
          },
        },
        agencies: {
          "agency-source-id": {
            kind: "Agency",
            canonicalId: "agency-canonical-id",
          },
        },
        personnel: {
          "personnel-source-id": {
            kind: "Personnel",
            canonicalId: "personnel-canonical-id",
          },
        },
        agencyPersonnel: {
          "agency-personnel-source-id": {
            kind: "AgencyPersonnel",
            canonicalId: "agency-personnel-canonical-id",
          },
        },
      },
      { rootDir },
    );

    const commandDirectory = path.join(
      rootDir,
      "intake",
      "commands",
      `2026-06-08T00-00-00-000Z-${runId}`,
    );
    const result = await importArtifacts({
      artifactsPath: writtenArtifacts.path,
      env: {
        DATABASE_URL: db.connectionString,
        INTAKE_WORKSPACE_TEST: rootDir,
      },
      logger: { info: () => {}, debug: () => {} },
      commandName: runId,
      commandDirectory,
    });

    expect(result).toEqual({
      ok: true,
      counts: {
        mutations: 4,
        recordsByEntityType: {
          Agency: 1,
          AgencyPersonnel: 1,
          LocationPathGeometry: 1,
          Personnel: 1,
        },
      },
    });

    // The rows landed in the real database with their resolved canonical ids.
    expect((await db.query("select id, slug from public.agency")).rows).toEqual(
      [{ id: "agency-canonical-id", slug: "minnesota-state-patrol" }],
    );
    expect(
      (await db.query("select id, first_name from public.personnel")).rows,
    ).toEqual([{ id: "personnel-canonical-id", first_name: "Spenser" }]);
    expect(
      (
        await db.query(
          "select agency_id, personnel_id from public.agency_personnel",
        )
      ).rows,
    ).toEqual([
      {
        agency_id: "agency-canonical-id",
        personnel_id: "personnel-canonical-id",
      },
    ]);
    expect(
      (
        await db.query(
          "select location_path_id from public.location_path_geometry where location_path_id = 'mn/saint-paul/minnesota-state-patrol'",
        )
      ).rows,
    ).toEqual([{ location_path_id: "mn/saint-paul/minnesota-state-patrol" }]);
  });
});
