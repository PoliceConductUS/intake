import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { runIntake } from "../../../src/cli/index.js";
import { createCommandDirectory } from "../../../src/cli/command-directory.js";
import { buildArtifactsEnvelope } from "../../../src/cli/transform/source-transform.js";
import { Artifacts } from "../../../src/shared/io/Artifacts.js";
import { defaultDatabaseClientFactory } from "../../../src/cli/database/index.js";
import { CurrentRowReader } from "../../../src/cli/import/artifacts/current-row-reader.js";
import { listEntries } from "../../../src/cli/data/chain.js";
import { DatabaseMutations } from "../../../src/cli/import/artifacts/io/DatabaseMutations.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "../database/intake-postgres.js";

const withDocker = dockerAvailable() ? describe : describe.skip;
withDocker("mutable entity edits through the data CLI", () => {
  let db: IntakeDatabase;
  let workspace: string;
  const source = "org.policeconduct.manual";
  beforeAll(async () => {
    db = await startIntakeDatabase();
    workspace = await mkdtemp(path.join(tmpdir(), "entity-updates-"));
    vi.stubEnv("INTAKE_WORKSPACE", workspace);
    vi.stubEnv("DATABASE_URL", db.connectionString);
  }, 180_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await db?.stop();
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });
  async function command(...args: string[]) {
    const result = await runIntake(["data", ...args]);
    expect(result, result.stderr).toMatchObject({ exitCode: 0 });
    return result;
  }
  async function acquire(kind: string, record: Record<string, unknown>) {
    vi.stubEnv("MANUAL_KIND", kind);
    vi.stubEnv("MANUAL_RECORD", JSON.stringify(record));
    await command("acquire", source);
  }
  async function generate() {
    await command("transform", source);
    return command("generate", source);
  }
  async function snapshot() {
    return {
      locations: (
        await db.query(
          "select location_path_id, path, display_name, ST_AsGeoJSON(centroid::geometry, 15)::jsonb as centroid, ST_AsGeoJSON(bbox, 15)::jsonb as bbox from public.location_path order by path",
        )
      ).rows,
      aliases: (
        await db.query(
          "select alias_path, location_path_id from public.location_path_alias",
        )
      ).rows,
      links: (
        await db.query(
          "select id, review_id, agency_personnel_id, rating_overall, created_by from public.review_personnel",
        )
      ).rows,
    };
  }
  test("generates location, alias, and report-personnel updates, applies them, and converges unchanged input", async () => {
    const location = {
      location_path_id: "/aa/",
      path: "/aa/",
      level: "state",
      display_name: "Original Place",
      parent_location_path_id: null,
      centroid: {
        type: "Point",
        coordinates: [-96.123456789123, 32.123456789123],
      },
      bbox: {
        type: "Polygon",
        coordinates: [
          [
            [-97, 32],
            [-96, 32],
            [-96, 33],
            [-97, 33],
            [-97, 32],
          ],
        ],
      },
    };
    await acquire("LocationPath", location);
    await acquire("LocationPath", {
      location_path_id: "/bb/",
      path: "/bb/",
      level: "state",
      display_name: "Other Place",
      parent_location_path_id: null,
    });
    await acquire("LocationPathAlias", {
      alias_path: "/alias/",
      location_path_id: "/aa/",
    });
    await generate();
    await command("up");
    const locationId = (await snapshot()).locations[0]!.location_path_id;
    const agency = {
      id: "agency",
      name: "Test Agency",
      state: "TX",
      city: "Test City",
      address: "1 Main St",
      zip_code: "75001",
      location_path_id: locationId,
      latitude: 32.8,
      longitude: -96.8,
    };
    const person = {
      id: "person",
      first_name: "Test",
      last_name: "Officer",
    };
    const assignment = {
      id: "assignment",
      agency_id: "agency",
      personnel_id: "person",
      start_date: "2020-01-01",
      title: "Officer",
    };
    // Supporting roster fixture uses canonical artifacts and the real CLI;
    // manual acquisition deliberately does not own roster entity kinds.
    const rosterCommand = await createCommandDirectory(process.env, {
      namespace: source,
      args: ["data", "transform", source],
    });
    await Artifacts.write(
      rosterCommand.outputDirectory,
      buildArtifactsEnvelope(source, rosterCommand.commandName, {
        artifacts: [
          { kind: "Agencies", records: { agency: { spec: agency } } },
          { kind: "Personnel", records: { person: { spec: person } } },
          {
            kind: "AgencyPersonnel",
            records: { assignment: { spec: assignment } },
          },
        ],
      }),
    );
    await command("generate", source);
    await command("up");
    await acquire("Review", {
      id: "report",
      title: "Test report",
      location_path_id: locationId,
      latitude: 32.8,
      longitude: -96.8,
    });
    const link = {
      id: "report-assignment",
      review_id: "report",
      agency_personnel_id: "assignment",
      rating_overall: 1,
    };
    await acquire("ReviewPersonnel", {
      ...link,
      created_by: "00000000-0000-4000-8000-000000000001",
    });
    await generate();
    await command("up");
    const original = await snapshot();
    const client = defaultDatabaseClientFactory(db.connectionString);
    await client.connect();
    try {
      const reader = new CurrentRowReader(client);
      const [readLocation] = await Promise.all([
        reader.getById("LocationPath", String(locationId), "location_path_id"),
        reader.getById("Review", "report"),
      ]);
      expect(readLocation).toMatchObject({
        centroid: location.centroid,
        bbox: location.bbox,
      });
    } finally {
      await client.end();
    }

    const updatedLocation = {
      ...location,
      display_name: "Corrected Place",
      centroid: {
        type: "Point",
        coordinates: [-96.223456789123, 32.223456789123],
      },
      bbox: {
        type: "Polygon",
        coordinates: [
          [
            [-98, 31],
            [-95, 31],
            [-95, 34],
            [-98, 34],
            [-98, 31],
          ],
        ],
      },
    };
    await acquire("LocationPath", updatedLocation);
    await acquire("LocationPathAlias", {
      alias_path: "/alias/",
      location_path_id: "/bb/",
    });
    await acquire("ReviewPersonnel", { ...link, rating_overall: 5 });
    const generated = await generate();
    expect(await snapshot()).toEqual(original);
    const entries = await listEntries();
    expect(entries, generated.stdout).toHaveLength(4);
    const mutations = (await DatabaseMutations.read(entries[3]!.filePath)).spec
      .mutations;
    expect(mutations.map((mutation) => mutation.kind).sort()).toEqual([
      "LocationPathAliasUpdate",
      "LocationPathUpdate",
      "ReviewPersonnelUpdate",
    ]);
    await command("up");
    const corrected = await snapshot();
    expect(corrected.locations).toEqual([
      {
        ...original.locations[0],
        display_name: "Corrected Place",
        centroid: updatedLocation.centroid,
        bbox: updatedLocation.bbox,
      },
      original.locations[1],
    ]);
    expect(corrected.aliases).toEqual([
      {
        alias_path: "/alias/",
        location_path_id: original.locations[1]!.location_path_id,
      },
    ]);
    expect(corrected.links).toEqual([
      { ...original.links[0], rating_overall: 5 },
    ]);
    await generate();
    expect(await listEntries()).toEqual(entries);
    const conflict = await runIntake([
      "replay",
      "database-mutations",
      entries[3]!.filePath,
    ]);
    expect(conflict).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("expected"),
    });
    expect(await snapshot()).toEqual(corrected);
    const assertions = await DatabaseMutations.write(
      workspace,
      DatabaseMutations.new({
        metadata: { name: "explicit-reads", namespace: source },
        spec: {
          mutations: [
            { kind: "LocationPathRead", name: String(locationId), spec: {} },
            { kind: "LocationPathAliasRead", name: "/alias/", spec: {} },
            {
              kind: "ReviewPersonnelRead",
              name: String(corrected.links[0]!.id),
              spec: {},
            },
          ],
        },
      }),
    );
    expect(
      await runIntake(["replay", "database-mutations", assertions.path]),
    ).toMatchObject({ exitCode: 0 });
    expect(await snapshot()).toEqual(corrected);
  }, 180_000);
});
