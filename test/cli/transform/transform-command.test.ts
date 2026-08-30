import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { transformSource } from "../../../src/cli/transform/index.js";

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
function makeOkDeps() {
  return {
    sourcesRoot: "/sources",
    // The manifest emits Personnel; the emit sink (flush) emits
    // LocationPathGeometries via testRefItems — both must be declared.
    produces: ["Personnel", "LocationPathGeometries"] as const,
    loadSourceModule: vi.fn(async () => async () => ({
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
    readXlsx: vi.fn(async () => []),
    state: "/ws/intake/state/sources/gov.azpost.roster",
    digest: vi.fn(async () => "testdigest"),
    createEmitSink: vi.fn(() => ({
      emit: vi.fn(async () => {}),
      flush: vi.fn(async () => testRefItems),
    })),
    loadExcludedRecords: vi.fn(async () => new Map()),
    seedResolvedPropertyCache: vi.fn(async () => ({ seeded: [], skipped: [] })),
    writeEnvelope: vi.fn(async () => ({ path: "/ws/artifacts.yaml" })),
    makeWorkspace: vi.fn(async () => "/ws"),
    env: { INTAKE_WORKSPACE: "/ws" },
  };
}

describe("transformSource", () => {
  it("loads the module, writes the envelope, returns the artifacts path", async () => {
    const okDeps = makeOkDeps();
    const result = await transformSource(
      "gov.azpost.roster",
      ["file.xlsx"],
      {},
      okDeps,
    );
    expect(okDeps.loadSourceModule).toHaveBeenCalledWith(
      "gov.azpost.roster",
      "/sources",
    );
    expect(okDeps.writeEnvelope).toHaveBeenCalledWith(
      "/ws",
      "gov.azpost.roster",
      "testdigest",
      expect.anything(),
      testRefItems,
    );
    expect(okDeps.createEmitSink).toHaveBeenCalledWith(
      "/ws",
      "gov.azpost.roster",
    );
    expect(okDeps.loadExcludedRecords).toHaveBeenCalledWith(
      path.join("/sources", "gov.azpost.roster"),
    );
    expect(result).toEqual({ artifactsPath: "/ws/artifacts.yaml" });
  });

  it("fails cleanly when no paths are given", async () => {
    const okDeps = makeOkDeps();
    const result = await transformSource("gov.azpost.roster", [], {}, okDeps);
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
      "gov.azpost.roster",
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
});
