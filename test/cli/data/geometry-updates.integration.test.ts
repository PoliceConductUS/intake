import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { runIntake } from "../../../src/cli/index.js";
import { createCommandDirectory } from "../../../src/cli/command-directory.js";
import { buildArtifactsEnvelope } from "../../../src/cli/transform/source-transform.js";
import { Artifacts } from "../../../src/shared/io/Artifacts.js";
import { listEntries } from "../../../src/cli/data/chain.js";
import { DatabaseMutations } from "../../../src/cli/import/artifacts/io/DatabaseMutations.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "../database/intake-postgres.js";

const withDocker = dockerAvailable() ? describe : describe.skip;
withDocker("streamed geometry updates through the data CLI", () => {
  let db: IntakeDatabase;
  let workspace: string;
  const source = "org.policeconduct.manual";
  beforeAll(async () => {
    db = await startIntakeDatabase();
    workspace = await mkdtemp(path.join(tmpdir(), "geometry-updates-"));
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
  async function stageGeometry(geometry: unknown) {
    const output = await createCommandDirectory(process.env, {
      namespace: source,
      args: ["data", "transform", source],
    });
    await Artifacts.write(
      output.outputDirectory,
      buildArtifactsEnvelope(source, output.commandName, {
        artifacts: [
          {
            kind: "LocationPathGeometries",
            records: {
              "/zz/": {
                spec: {
                  location_path_id: "/zz/",
                  sourceLocationPathKey: "/zz/",
                  selectedYear: 2026,
                  geometry,
                },
              },
            },
          },
        ],
      }),
    );
  }
  async function stored() {
    return (
      await db.query(
        "select location_path_id, ST_AsGeoJSON(boundary, 17)::jsonb as boundary from public.location_path_geometry",
      )
    ).rows;
  }
  test("generates changed boundary updates, preserves identity and precision, and rejects stale replay", async () => {
    vi.stubEnv("MANUAL_KIND", "LocationPath");
    vi.stubEnv(
      "MANUAL_RECORD",
      JSON.stringify({
        location_path_id: "/zz/",
        path: "/zz/",
        level: "state",
        display_name: "Test State",
        parent_location_path_id: null,
      }),
    );
    await command("acquire", source);
    await command("transform", source);
    await command("generate", source);
    await command("up");
    const initial = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [-96.123456789123, 32],
            [-95, 32],
            [-95, 33],
            [-96.123456789123, 33],
            [-96.123456789123, 32],
          ],
        ],
      ],
    };
    await stageGeometry(initial);
    await command("generate", source);
    await command("up");
    const original = await stored();
    expect(original).toEqual([
      { location_path_id: expect.any(String), boundary: initial },
    ]);
    const revised = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [-97.123456789123, 31],
            [-94, 31],
            [-94, 34],
            [-97.123456789123, 34],
            [-97.123456789123, 31],
          ],
        ],
      ],
    };
    await stageGeometry(revised);
    const result = await command("generate", source);
    expect(await stored()).toEqual(original);
    const entries = await listEntries();
    expect(entries, result.stdout).toHaveLength(3);
    const updates = (await DatabaseMutations.read(entries[2]!.filePath)).spec
      .mutations;
    expect(updates).toEqual([
      expect.objectContaining({
        kind: "LocationPathGeometryUpdate",
        name: original[0]!.location_path_id,
        spec: {
          operations: [
            expect.objectContaining({
              action: "set",
              path: "geometry",
              to: revised,
            }),
          ],
        },
      }),
    ]);
    await command("up");
    const corrected = [{ ...original[0], boundary: revised }];
    expect(await stored()).toEqual(corrected);
    await command("generate", source);
    expect(await listEntries()).toEqual(entries);
    // Different serialization of the same geometry is still a no-op.
    await stageGeometry(
      JSON.stringify(
        { coordinates: revised.coordinates, type: revised.type },
        null,
        2,
      ),
    );
    await command("generate", source);
    expect(await listEntries()).toEqual(entries);
    const conflict = await runIntake([
      "replay",
      "database-mutations",
      entries[2]!.filePath,
    ]);
    expect(conflict).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("expected boundary"),
    });
    expect(await stored()).toEqual(corrected);
  }, 180_000);
});
