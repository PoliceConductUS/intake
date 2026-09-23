import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ResolvedProperty } from "../../../src/cli/state/resolved-property/ResolvedProperty.js";
import {
  readResolvedProperty,
  resolvedPropertyCacheName,
} from "../../../src/cli/state/resolved-property/index.js";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { loadExcludedRecords } from "../../../src/shared/io/excluded-records.js";
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
    state: "/ws/state/gov.azpost.roster",
    digest: vi.fn(async () => "testdigest"),
    createEmitSink: vi.fn(() => ({
      emit: vi.fn(async () => {}),
      flush: vi.fn(async () => testRefItems),
    })),
    loadExcludedRecords: vi.fn(async () => new Map()),
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
    expect(okDeps.loadExcludedRecords).toHaveBeenCalledWith(okDeps.state);
    expect(result).toEqual({ artifactsPath: "/ws/artifacts.yaml" });
  });

  it("filters using workspace exclusions and ignores a different list in the checkout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "transform-exclusions-"));
    try {
      const state = path.join(root, "workspace", "state", "gov.azpost.roster");
      const sourcesRoot = path.join(root, "sources");
      const sourceDir = path.join(sourcesRoot, "gov.azpost.roster");
      await mkdir(state, { recursive: true });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        path.join(state, "excluded.yaml"),
        'excluded:\n  - kind: Personnel\n    key: "1001"\n    reason: workspace exclusion\n',
      );
      await writeFile(path.join(sourceDir, "excluded.yaml"), "excluded: []\n");
      const deps = { ...makeOkDeps(), state, sourcesRoot, loadExcludedRecords };
      expect(
        await transformSource("gov.azpost.roster", ["file.xlsx"], {}, deps),
      ).toEqual({ artifactsPath: "/ws/artifacts.yaml" });
      expect(deps.writeEnvelope).toHaveBeenCalledWith(
        "/ws",
        "gov.azpost.roster",
        "testdigest",
        { artifacts: [{ kind: "Personnel", records: {} }] },
        testRefItems,
      );
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
        path.join(sourcesRoot, "gov.azpost.roster", "resolved-property-seed"),
        ResolvedProperty.new({
          metadata: {
            name: resolvedPropertyCacheName(input),
            namespace: "intake",
          },
          spec: { ...input, entries: [{ value: 33.4 }] },
        }),
      );
      const result = await transformSource(
        "gov.azpost.roster",
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
