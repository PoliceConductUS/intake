import { mkdtemp, readdir, rm } from "node:fs/promises";
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
import { acquire } from "../../sources/org.policeconduct.manual/acquire.js";
import { transform } from "../../sources/org.policeconduct.manual/transform.js";
import { buildArtifactsEnvelope } from "../../src/cli/transform/source-transform.js";
import { importArtifacts } from "../../src/cli/import/artifacts/config.js";
import { replayDatabaseMutations } from "../../src/cli/replay/database-mutations/config.js";
import { Artifacts } from "../../src/shared/io/Artifacts.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "../cli/database/intake-postgres.js";

const placePath = "/tx/fannin-county/ivanhoe/";
const countyPath = "/tx/fannin-county/";
const aliasPath = "/tx/fannin-county/ivanhoe-community/";
const describeWithDocker = dockerAvailable() ? describe : describe.skip;

describeWithDocker("manual community creation and reconstruction", () => {
  let db: IntakeDatabase;
  let rootDir: string;
  const workspaces: string[] = [];

  beforeAll(async () => {
    db = await startIntakeDatabase();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
    await Promise.all(
      workspaces.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function seedParents() {
    await db.query(
      "insert into public.location_path (location_path_id, path, level, display_name) values ('texas-id', '/tx/', 'state', 'Texas')",
    );
    await db.query(
      "insert into public.location_path (location_path_id, path, level, display_name, parent_location_path_id) values ('fannin-id', $1, 'administrative_area', 'Fannin County', 'texas-id')",
      [countyPath],
    );
  }

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "manual-place-"));
    workspaces.push(rootDir);
    await db.truncateAll();
    await seedParents();
  });

  async function prepare(parent = countyPath) {
    const state = path.join(rootDir, "manual-state");
    for (const [kind, record] of [
      [
        "LocationPath",
        {
          location_path_id: placePath,
          path: placePath,
          level: "place",
          display_name: "Ivanhoe",
          parent_location_path_id: parent,
        },
      ],
      [
        "LocationPathAlias",
        { alias_path: aliasPath, location_path_id: placePath },
      ],
    ] as const) {
      await acquire({
        sourceDir: rootDir,
        state,
        env: { MANUAL_KIND: kind, MANUAL_RECORD: JSON.stringify(record) },
        data: {} as never,
      });
    }
    const manifest = await transform({
      paths: [],
      readXlsx: async () => [],
      state,
      emit: async () => {},
    } as never);
    return Artifacts.write(
      rootDir,
      buildArtifactsEnvelope(
        "org.policeconduct.manual",
        "manual-community",
        manifest,
      ),
    );
  }

  function load(artifactsPath: string, run: string) {
    return importArtifacts({
      artifactsPath,
      env: {
        DATABASE_URL: db.connectionString,
        INTAKE_WORKSPACE_TEST: rootDir,
      },
      commandName: run,
      commandDirectory: path.join(rootDir, run),
      logger: { info: () => {}, debug: () => {} },
    });
  }

  async function storedPlace() {
    return (
      await db.query(
        "select location_path_id, path, display_name, parent_location_path_id, centroid, bbox from public.location_path where path = $1",
        [placePath],
      )
    ).rows;
  }

  test("creates a boundary-free community and alias, preserving both through re-import and replay", async () => {
    const artifacts = await prepare();
    expect(await load(artifacts.path, "create-place")).toMatchObject({
      ok: true,
    });
    const original = await storedPlace();
    expect(original).toEqual([
      {
        location_path_id: expect.stringMatching(/^[a-z][a-z0-9]{23}$/),
        path: placePath,
        display_name: "Ivanhoe",
        parent_location_path_id: "fannin-id",
        centroid: null,
        bbox: null,
      },
    ]);
    expect(
      (await db.query("select * from public.location_path_geometry")).rows,
    ).toEqual([]);
    const expectedAlias = [
      { alias_path: aliasPath, location_path_id: original[0].location_path_id },
    ];
    expect(
      (
        await db.query(
          "select alias_path, location_path_id from public.location_path_alias",
        )
      ).rows,
    ).toEqual(expectedAlias);

    expect(await load(artifacts.path, "reimport-place")).toMatchObject({
      ok: true,
    });
    expect(await storedPlace()).toEqual(original);
    const commandDir = path.join(rootDir, "create-place");
    const files = (await readdir(commandDir)).filter((file) =>
      file.endsWith(".DatabaseMutations.yaml"),
    );
    expect(files).toHaveLength(1);
    await db.truncateAll();
    await seedParents();
    expect(
      await replayDatabaseMutations({
        databaseMutationsPath: path.join(commandDir, files[0]),
        env: { DATABASE_URL: db.connectionString },
      }),
    ).toMatchObject({ ok: true });
    expect(await storedPlace()).toEqual(original);
    expect(
      (
        await db.query(
          "select alias_path, location_path_id from public.location_path_alias",
        )
      ).rows,
    ).toEqual(expectedAlias);
  });

  test("rejects an unresolved county without creating the community or its alias", async () => {
    const artifacts = await prepare("/tx/nonexistent-county/");
    const result = await load(artifacts.path, "missing-parent");
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("/tx/nonexistent-county/"),
    });
    expect(await storedPlace()).toEqual([]);
    expect(
      (await db.query("select * from public.location_path_alias")).rows,
    ).toEqual([]);
  });
});
