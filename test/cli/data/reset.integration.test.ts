import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { resetData } from "../../../src/cli/data/reset.js";
import { runIntake } from "../../../src/cli/index.js";
import { createCommandDirectory } from "../../../src/cli/command-directory.js";
import { buildArtifactsEnvelope } from "../../../src/cli/transform/source-transform.js";
import { sourceStateDir } from "../../../src/cli/transform/state.js";
import { Artifacts } from "../../../src/shared/io/Artifacts.js";
import { appendEntry } from "../../../sources/org.policeconduct.manual/chain.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "../database/intake-postgres.js";

const withDocker = dockerAvailable() ? describe : describe.skip;
withDocker("data reset against disposable Postgres", () => {
  let db: IntakeDatabase;
  const workspaces: string[] = [];
  beforeAll(async () => {
    db = await startIntakeDatabase();
    // Match Supabase's extension layout for its remote reset implementation.
    await db.query(
      "create schema if not exists extensions; alter extension pgcrypto set schema extensions",
    );
    await db.query("alter role test set search_path to public, extensions");
  }, 180000);
  afterAll(async () => {
    await db?.stop();
    await Promise.all(
      workspaces.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  async function fixture() {
    const workspace = await mkdtemp(path.join(tmpdir(), "reset-integration-"));
    workspaces.push(workspace);
    vi.stubEnv("INTAKE_WORKSPACE", workspace);
    vi.stubEnv("DATABASE_URL", db.connectionString);
    const env = {
      INTAKE_WORKSPACE: workspace,
      DATABASE_URL: db.connectionString,
    };
    await mkdir(path.join(workspace, "data", "mutations"), { recursive: true });
    // Deliberately unusable as a mutation: a reset must retire it, never replay it.
    await writeFile(
      path.join(workspace, "data", "mutations", "old.DatabaseMutations.yaml"),
      "old data",
    );
    const commands: string[] = [];
    const runDataCommand = async (args: readonly string[]) => {
      commands.push(args.join(" "));
      if (args[1] === "acquire") throw new Error("Unexpected acquisition");
      if (args[1] === "transform" && args[2] === "us-census-gazetteer") {
        const command = await createCommandDirectory(env, {
          namespace: args[2],
          args,
        });
        await Artifacts.write(
          command.outputDirectory,
          buildArtifactsEnvelope(args[2], command.commandName, {
            artifacts: [
              {
                kind: "LocationPaths",
                records: {
                  "/zz/": {
                    spec: {
                      location_path_id: "/zz/",
                      path: "/zz/",
                      level: "state",
                      display_name: "Test State",
                      parent_location_path_id: null,
                    },
                  },
                },
              },
              {
                kind: "Personnel",
                records: {
                  "person-one": {
                    spec: { first_name: "Chris", last_name: "True" },
                  },
                },
              },
            ],
          }),
        );
        return { exitCode: 0 };
      }
      return runIntake(args);
    };
    return {
      env,
      commands,
      runDataCommand,
      logger: { info: () => {} },
      orderedSourceIds: async () => ["us-census-gazetteer"],
    };
  }

  test("runs actual schema reset, regenerates source and manual data, and preserves IDs and slugs on repetition", async () => {
    const deps = await fixture();
    await appendEntry(
      await sourceStateDir(deps.env, "org.policeconduct.manual"),
      {
        kind: "LocationPathAlias",
        record: { alias_path: "/zz/alias/", location_path_id: "/zz/" },
      },
      "alias_path",
    );
    await db.query(
      "insert into public.location_path (location_path_id,path,level,display_name) values ('old-only','/old/','state','Old')",
    );
    expect(await resetData({ acquire: false }, deps)).toMatchObject({
      exitCode: 0,
    });
    const first = (
      await db.query(
        "select id,slug,first_name,last_name from public.personnel",
      )
    ).rows;
    expect(first).toEqual([
      {
        id: expect.any(String),
        slug: expect.stringContaining("chris-true"),
        first_name: "Chris",
        last_name: "True",
      },
    ]);
    expect(
      (await db.query("select path from public.location_path")).rows,
    ).toEqual([{ path: "/zz/" }]);
    expect(
      (await db.query("select alias_path from public.location_path_alias"))
        .rows,
    ).toEqual([{ alias_path: "/zz/alias/" }]);
    expect(
      (
        await db.query(
          "select count(*)::int as count from public.data_mutation_applied",
        )
      ).rows,
    ).toEqual([{ count: 2 }]);
    expect(await resetData({ acquire: false }, deps)).toMatchObject({
      exitCode: 0,
    });
    expect(
      (
        await db.query(
          "select id,slug,first_name,last_name from public.personnel",
        )
      ).rows,
    ).toEqual(first);
  }, 180000);

  test("a real missing-location failure returns nonzero without replaying old data", async () => {
    const deps = await fixture();
    await appendEntry(
      await sourceStateDir(deps.env, "org.policeconduct.manual"),
      {
        kind: "LocationPathAlias",
        record: { alias_path: "/zz/alias/", location_path_id: "/missing/" },
      },
      "alias_path",
    );
    const result = await resetData({ acquire: false }, deps);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("data generate org.policeconduct.manual");
    expect(result.stderr).toContain("/missing/");
    expect(result.stderr).toContain("incomplete");
    expect(deps.commands.at(-1)).toBe("data generate org.policeconduct.manual");
    expect(
      (await db.query("select alias_path from public.location_path_alias"))
        .rows,
    ).toEqual([]);
  }, 180000);
});
