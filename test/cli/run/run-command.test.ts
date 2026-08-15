import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { runSource } from "../../../src/cli/run/index.js";

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
    runImport: vi.fn(async () => ({ exitCode: 0, stdout: "ok" })),
    makeWorkspace: vi.fn(async () => "/ws"),
    env: { INTAKE_WORKSPACE: "/ws" },
  };
}

describe("runSource", () => {
  it("loads the module, imports the returned manifest, returns its result", async () => {
    const okDeps = makeOkDeps();
    const result = await runSource(
      "gov.azpost.roster",
      ["file.xlsx"],
      { dryRun: true },
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
    expect(okDeps.runImport).toHaveBeenCalledWith("/ws/artifacts.yaml", {
      dryImport: true,
    });
    expect(result.exitCode).toBe(0);
  });

  it("fails cleanly when no paths are given", async () => {
    const okDeps = makeOkDeps();
    const result = await runSource("gov.azpost.roster", [], {}, okDeps);
    expect(result.exitCode).toBe(1);
    expect(okDeps.loadSourceModule).not.toHaveBeenCalled();
  });

  it("returns exit 1 when the module load fails", async () => {
    const deps = {
      ...makeOkDeps(),
      loadSourceModule: vi.fn(async () => {
        throw new Error("Unknown source id");
      }),
    };
    const result = await runSource("nope", ["file.xlsx"], {}, deps);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Unknown source id/);
  });
});
