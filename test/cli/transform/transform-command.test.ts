import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ResolvedProperty } from "../../../src/cli/state/resolved-property/ResolvedProperty.js";
import {
  readResolvedProperty,
  resolvedPropertyCacheName,
} from "../../../src/cli/state/resolved-property/index.js";
import path from "node:path";
import { describe, it, expect, vi, type Mock } from "vitest";
import { loadExcludedRecords } from "../../../src/shared/io/excluded-records.js";
import {
  buildTransformSourceDeps,
  transformSource,
} from "../../../src/cli/transform/index.js";
import { writeCommandPointer } from "../../../src/cli/state/command-pointer.js";
import { onlyCommandLog, readLogRecords } from "../command-log.js";

const testRefItems = [
  {
    ref: {
      path: "geometries.LocationPathGeometries.yaml",
      kind: "LocationPathGeometries" as const,
      sha256: "a".repeat(64),
    },
  },
];

// A factory (not a shared const) so each test gets fresh vi.fn() call
// history — vitest does not auto-reset mocks between `it` blocks here.
function makeOkDeps(
  logger: { info: Mock; error: Mock } = { info: vi.fn(), error: vi.fn() },
) {
  return {
    beginCompletion: async () => {},
    complete: async () => {},
    sourcesRoot: "/sources",
    // The manifest emits Personnel; the emit sink (flush) emits
    // LocationPathGeometries via testRefItems — both must be declared.
    produces: ["Personnel", "LocationPathGeometries"] as const,
    loadSourceModule: vi.fn(async () =>
      vi.fn(async (_deps: unknown) => ({
        artifacts: [
          {
            kind: "Personnel" as const,
            records: {
              "1001": {
                spec: { id: "1001", first_name: "Skip", last_name: "Woodward" },
              },
            },
          },
        ],
      })),
    ),
    readXlsx: vi.fn(async () => []),
    state: "/ws/state/gov/az/post/roster",
    digest: vi.fn(async () => "testdigest"),
    createEmitSink: vi.fn(() => ({
      emit: vi.fn(async () => {}),
      records: async function* () {},
      flush: vi.fn(async () => testRefItems),
    })),
    loadExcludedRecords: vi.fn(async () => new Map()),
    writeEnvelope: vi.fn(async () => ({ path: "/ws/artifacts.yaml" })),
    makeWorkspace: vi.fn(async () => ({ outputDirectory: "/ws", logger })),
    env: { INTAKE_WORKSPACE: "/ws" },
    logger,
  };
}

describe("transformSource", () => {
  it("loads the module, writes the envelope, returns the artifacts path", async () => {
    const okDeps = makeOkDeps();
    const result = await transformSource(
      "gov/az/post/roster",
      ["file.xlsx"],
      {},
      okDeps,
    );
    expect(okDeps.loadSourceModule).toHaveBeenCalledWith(
      "gov/az/post/roster",
      "/sources",
    );
    expect(okDeps.writeEnvelope).toHaveBeenCalledWith(
      "/ws",
      "gov/az/post/roster",
      "testdigest",
      expect.anything(),
      testRefItems,
    );
    expect(okDeps.createEmitSink).toHaveBeenCalledWith(
      "/ws",
      "gov/az/post/roster",
    );
    expect(okDeps.loadExcludedRecords).toHaveBeenCalledWith(okDeps.state);
    expect(result).toEqual({ artifactsPath: "/ws/artifacts.yaml" });
    expect(okDeps.logger.info).not.toHaveBeenCalled();
    const sourceTransform =
      await okDeps.loadSourceModule.mock.results[0]!.value;
    expect(sourceTransform.mock.calls[0]![0]).not.toHaveProperty(
      "applyPropertyCorrections",
    );
  });

  it("filters using workspace exclusions and ignores a different list in the checkout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "transform-exclusions-"));
    try {
      const state = path.join(root, "workspace", "state", "gov/az/post/roster");
      const sourcesRoot = path.join(root, "sources");
      const sourceDir = path.join(sourcesRoot, "gov/az/post/roster");
      await mkdir(state, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        path.join(state, "excluded.yaml"),
        'excluded:\n  - kind: Personnel\n    key: "1001"\n    reason: workspace exclusion\n  - kind: Personnel\n    key: "9999"\n    reason: absent from source\n',
      );
      await writeFile(path.join(sourceDir, "excluded.yaml"), "excluded: []\n");
      const logger = { info: vi.fn(), error: vi.fn() };
      const deps = {
        ...makeOkDeps(logger),
        state,
        sourcesRoot,
        loadExcludedRecords,
      };
      const authority = {
        kind: "LicensingAuthorities" as const,
        records: {
          board: {
            spec: {
              name: "Test board",
              location_path_id: "test",
              source_namespaces: ["gov/az/post/roster"],
            },
          },
        },
      };
      const originalModule = await deps.loadSourceModule();
      const originalManifest = await originalModule({});
      const exclusionsDeps = {
        ...deps,
        produces: [...deps.produces, "LicensingAuthorities"] as const,
        loadSourceModule: async () => async () => ({
          artifacts: [...originalManifest.artifacts, authority],
        }),
      };
      expect(
        await transformSource(
          "gov/az/post/roster",
          ["file.xlsx"],
          {},
          exclusionsDeps,
        ),
      ).toEqual({ artifactsPath: "/ws/artifacts.yaml" });
      expect(deps.writeEnvelope).toHaveBeenCalledWith(
        "/ws",
        "gov/az/post/roster",
        "testdigest",
        {
          artifacts: [
            { kind: "Personnel", records: {} },
            {
              ...authority,
              records: {
                board: {
                  spec: {
                    ...authority.records.board.spec,
                    source_exclusions: {
                      "gov/az/post/roster": [
                        {
                          kind: "Personnel",
                          key: "1001",
                          reason: "workspace exclusion",
                        },
                        {
                          kind: "Personnel",
                          key: "9999",
                          reason: "absent from source",
                        },
                      ],
                    },
                  },
                },
              },
            },
          ],
        },
        testRefItems,
      );
      expect(logger.info).toHaveBeenCalledWith(
        "gov/az/post/roster: excluded Personnel 1001: workspace exclusion",
      );
      expect(logger.info).toHaveBeenCalledWith(
        "gov/az/post/roster: exclusion totals (including dependents): Personnel=1",
      );
      expect(logger.info).toHaveBeenCalledTimes(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not refill a cleared cache from files in the source checkout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "intake-transform-cache-"));
    try {
      const sourcesRoot = path.join(root, "sources");
      const workspaceRoot = path.join(root, "workspace");
      const input = {
        subject: {
          apiVersion: "policeconduct.org/intake/v1alpha1" as const,
          kind: "Agency",
          name: "agency-id",
        },
        targetProperty: "latitude",
      };
      await ResolvedProperty.write(
        path.join(sourcesRoot, "gov/az/post/roster", "resolved-property-seed"),
        ResolvedProperty.new({
          metadata: {
            name: resolvedPropertyCacheName(input),
            namespace: "intake",
          },
          spec: { ...input, entries: [{ value: 33.4 }] },
        }),
      );
      const result = await transformSource(
        "gov/az/post/roster",
        ["file.xlsx"],
        {},
        {
          ...makeOkDeps(),
          sourcesRoot,
          env: { INTAKE_WORKSPACE: workspaceRoot },
        },
      );
      expect(result).toEqual({ artifactsPath: "/ws/artifacts.yaml" });
      await expect(
        readResolvedProperty({ rootDir: workspaceRoot, ...input }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails cleanly when no paths are given", async () => {
    const okDeps = makeOkDeps();
    const result = await transformSource("gov/az/post/roster", [], {}, okDeps);
    expect(result).toMatchObject({ error: { exitCode: 1 } });
    expect(okDeps.loadSourceModule).not.toHaveBeenCalled();
  });

  it("returns an error when the module load fails", async () => {
    const deps = {
      ...makeOkDeps(),
      loadSourceModule: vi.fn(async () => {
        throw new Error("Unknown source id");
      }),
    };
    const result = await transformSource("nope", ["file.xlsx"], {}, deps);
    expect(result).toMatchObject({
      error: {
        exitCode: 1,
        stderr: expect.stringMatching(/Unknown source id/),
      },
    });
  });

  it("fails loud when the source emits a kind it did not declare", async () => {
    // Module emits Personnel, but the source declares only
    // LocationPathGeometries (the sink kind): the manifest's Personnel is drift.
    const deps = {
      ...makeOkDeps(),
      produces: ["LocationPathGeometries"] as const,
    };
    const result = await transformSource(
      "gov/az/post/roster",
      ["file.xlsx"],
      {},
      deps,
    );
    expect(result).toMatchObject({
      error: {
        exitCode: 1,
        stderr: expect.stringMatching(/undeclared kind\(s\): Personnel/),
      },
    });
  });

  it("writes each line it prints to <command-name>.log and ends a failed run's log with its error", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "intake-transform-log-"));
    try {
      const sourceId = "gov/az/post/roster";
      const input = path.join(root, "input");
      await mkdir(input);
      await writeFile(path.join(input, "roster.csv"), "id\n1001\n");
      await writeCommandPointer(path.join(root, "state", sourceId), "acquire", {
        latest: "input",
      });
      const printed: string[] = [];
      const deps = await buildTransformSourceDeps(
        sourceId,
        [path.join(input, "roster.csv")],
        { INTAKE_WORKSPACE_TEST: root },
        {
          commandArgs: ["data", "transform", sourceId],
          terminal: { write: (text) => printed.push(text) },
        },
      );
      deps.loadSourceModule = async () => async (transformInput) => {
        transformInput.logger?.info("roster: read 1 row");
        throw new Error("roster: row 2 has no license number");
      };
      expect(
        await transformSource(
          sourceId,
          [path.join(input, "roster.csv")],
          {},
          deps,
        ),
      ).toEqual({
        error: {
          exitCode: 1,
          stderr: "roster: row 2 has no license number\n",
        },
      });
      expect(printed).toEqual(["roster: read 1 row\n"]);
      const records = await readLogRecords(
        (await onlyCommandLog(root)).logPath,
      );
      expect(records.map((record) => record.msg)).toEqual([
        "roster: read 1 row",
        undefined,
      ]);
      expect(records.at(-1)).toMatchObject({
        level: 50,
        error: {
          message: "roster: row 2 has no license number",
          stack: expect.stringContaining(
            "Error: roster: row 2 has no license number\n    at ",
          ),
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
