import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { transformSource } from "../../../src/cli/transform/index.js";
import { Artifacts } from "../../../src/shared/io/index.js";
import { createEmitSink } from "../../../src/cli/transform/emit-sink.js";
import { buildArtifactsEnvelope } from "../../../src/cli/transform/source-transform.js";
import {
  appendExcludedRecord,
  loadExcludedRecords,
} from "../../../src/shared/io/excluded-records.js";
import type {
  TransformDeps,
  SourceManifest,
} from "../../../src/cli/transform/source-transform.js";

// Integration test for the streaming `emit` sink: a fake source `run()`
// returns an inline `LocationPaths` record AND streams a
// `LocationPathGeometries` record via `emit`, driven end-to-end through
// `transformSource`. The written Artifacts envelope is read back with
// `Artifacts.read` to prove the inline records and the streamed ref both
// resolve correctly.
describe("emit sink integration (via transformSource)", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "emit-integration-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it.each([
    [
      "matching streamed condition",
      "LocationPathGeometry",
      "az-state",
      { location_path_id: "az" },
      true,
      false,
    ],
    [
      "changed streamed condition",
      "LocationPathGeometry",
      "az-state",
      { location_path_id: "changed" },
      false,
      false,
    ],
    [
      "unconditional streamed exclusion",
      "LocationPathGeometry",
      "az-state",
      undefined,
      true,
      false,
    ],
    [
      "inline parent excludes streamed dependent",
      "LocationPath",
      "az",
      { display_name: "Arizona" },
      true,
      true,
    ],
  ] as const)(
    "%s",
    async (_label, kind, key, when, excluded, excludeParent) => {
      await appendExcludedRecord(workspace, {
        kind,
        key,
        reason: "reviewed source issue",
        ...(when === undefined ? {} : { when }),
      });
      const logs: string[] = [];
      const result = await runStreamedSource(workspace, true, logs);
      if ("error" in result) throw new Error(result.error.stderr);
      const output = await Artifacts.read(result.artifactsPath);
      const geometries = output.spec.artifacts.find(
        (artifact) => artifact.kind === "LocationPathGeometries",
      );
      expect(Object.keys(geometries?.spec.records ?? {})).toEqual(
        excluded ? ["keep-state"] : ["az-state", "keep-state"],
      );
      const locations = output.spec.artifacts.find(
        (artifact) => artifact.kind === "LocationPaths",
      );
      expect(Object.keys(locations!.spec.records)).toEqual(
        excludeParent ? ["keep"] : ["az", "keep"],
      );
      const authority = output.spec.artifacts.find(
        (artifact) => artifact.kind === "LicensingAuthorities",
      )!.spec.records.board;
      expect(authority).toMatchObject({
        spec: {
          source_exclusions: {
            "test.stream": excluded
              ? [
                  expect.objectContaining({
                    kind,
                    key,
                    reason: "reviewed source issue",
                  }),
                ]
              : [],
          },
        },
      });
      expect(
        logs.some((message) => message.includes(`excluded ${kind} ${key}:`)),
      ).toBe(excluded);
      if (excluded) expect(logs.join("\n")).toContain("LocationPathGeometry=1");
      const retained = geometries!.spec.records["keep-state"];
      expect(retained).toMatchObject({
        metadata: { name: "keep-state" },
        spec: {
          location_path_id: "keep",
          geometry: { type: "Point", coordinates: [1, 1] },
        },
      });
    },
  );

  it("active streamed exclusions retain the existing evidence-owner error", async () => {
    await appendExcludedRecord(workspace, {
      kind: "LocationPathGeometry",
      key: "az-state",
      reason: "reviewed source issue",
      when: { location_path_id: "az" },
    });
    const result = await runStreamedSource(workspace, false, []);
    expect(result).toMatchObject({
      error: {
        exitCode: 1,
        stderr: expect.stringMatching(
          /exactly one explicitly mapped licensing authority/,
        ),
      },
    });
  });

  it("filtering every streamed record does not hide an undeclared output kind", async () => {
    for (const key of ["az-state", "keep-state"]) {
      await appendExcludedRecord(workspace, {
        kind: "LocationPathGeometry",
        key,
        reason: "reviewed source issue",
      });
    }
    const result = await runStreamedSource(
      workspace,
      true,
      [],
      ["LocationPaths", "LicensingAuthorities"],
    );
    expect(result).toMatchObject({
      error: {
        exitCode: 1,
        stderr: expect.stringMatching(
          /undeclared kind\(s\): LocationPathGeometries/,
        ),
      },
    });
  });

  it("splices a streamed LocationPathGeometries ref alongside inline LocationPaths records", async () => {
    const fakeRun = async (deps: TransformDeps): Promise<SourceManifest> => {
      await deps.emit("LocationPathGeometries", "az-state", {
        location_path_id: "az",
        geometry: { type: "Point", coordinates: [0, 0] },
        sourceLocationPathKey: "az",
      });
      return {
        artifacts: [
          {
            kind: "LocationPaths",
            records: {
              az: {
                spec: {
                  location_path_id: "az",
                  path: "az",
                  level: "state",
                  display_name: "Arizona",
                  parent_location_path_id: null,
                },
              },
            },
          },
        ],
      };
    };

    const result = await transformSource(
      "gov.census.gazetteer",
      ["dummy-snapshot.zip"],
      {},
      {
        beginCompletion: async () => {},
        complete: async () => {},
        sourcesRoot: "/unused",
        env: {},
        produces: ["LocationPaths", "LocationPathGeometries"],
        loadSourceModule: async () => fakeRun,
        readXlsx: async () => [],
        state: "/unused/state",
        digest: async () => "abc123def4567890",
        makeWorkspace: async () => workspace,
        createEmitSink,
        loadExcludedRecords: async () => new Map(),
        writeEnvelope: async (directory, id, digest, manifest, refItems) =>
          Artifacts.write(
            directory,
            buildArtifactsEnvelope(id, digest, manifest, refItems),
          ),
      },
    );

    if ("error" in result) {
      throw new Error(`transformSource failed: ${result.error.stderr}`);
    }
    expect(result.artifactsPath).toBeDefined();

    const envelope = await Artifacts.read(result.artifactsPath);

    expect(envelope.metadata.namespace).toBe("gov.census.gazetteer");
    expect(envelope.spec.artifacts).toHaveLength(2);

    const locationPaths = envelope.spec.artifacts.find(
      (artifact) => artifact.kind === "LocationPaths",
    );
    expect(locationPaths).toBeDefined();
    expect(Object.keys(locationPaths?.spec.records ?? {})).toEqual(["az"]);
    expect(
      (locationPaths?.spec.records["az"] as { spec: Record<string, unknown> })
        .spec,
    ).toMatchObject({
      location_path_id: "az",
      display_name: "Arizona",
    });

    const geometries = envelope.spec.artifacts.find(
      (artifact) => artifact.kind === "LocationPathGeometries",
    );
    expect(geometries).toBeDefined();
    expect(Object.keys(geometries?.spec.records ?? {})).toEqual(["az-state"]);
    expect(
      (
        geometries?.spec.records["az-state"] as {
          spec: Record<string, unknown>;
        }
      ).spec,
    ).toMatchObject({
      location_path_id: "az",
      sourceLocationPathKey: "az",
      geometry: { type: "Point", coordinates: [0, 0] },
    });
  });
});

async function runStreamedSource(
  workspace: string,
  authority: boolean,
  logs: string[],
  produces: readonly (
    | "LocationPaths"
    | "LocationPathGeometries"
    | "LicensingAuthorities"
  )[] = ["LocationPaths", "LocationPathGeometries", "LicensingAuthorities"],
) {
  return transformSource(
    "test.stream",
    ["synthetic-input"],
    {},
    {
      beginCompletion: async () => {},
      complete: async () => {},
      sourcesRoot: workspace,
      env: {},
      produces,
      loadSourceModule: async () => async (deps) => {
        for (const [key, location, coordinates] of [
          ["az-state", "az", [0, 0]],
          ["keep-state", "keep", [1, 1]],
        ] as const) {
          await deps.emit("LocationPathGeometries", key, {
            location_path_id: location,
            geometry: { type: "Point", coordinates },
            sourceLocationPathKey: location,
          });
        }
        const manifest: SourceManifest = {
          artifacts: [
            {
              kind: "LocationPaths",
              records: {
                az: {
                  spec: {
                    location_path_id: "az",
                    path: "az",
                    level: "state",
                    display_name: "Arizona",
                    parent_location_path_id: null,
                  },
                },
                keep: {
                  spec: {
                    location_path_id: "keep",
                    path: "keep",
                    level: "state",
                    display_name: "Keep",
                    parent_location_path_id: null,
                  },
                },
              },
            },
          ],
        };
        if (authority)
          manifest.artifacts.push({
            kind: "LicensingAuthorities",
            records: {
              board: {
                spec: {
                  name: "Test board",
                  location_path_id: "test",
                  source_namespaces: ["test.stream"],
                  source_exclusions: {
                    "test.stream": [
                      {
                        kind: "LocationPathGeometry",
                        key: "az-state",
                        reason: "previous issue",
                      },
                    ],
                  },
                },
              },
            },
          });
        return manifest;
      },
      readXlsx: async () => [],
      state: workspace,
      digest: async () => "stream-test",
      makeWorkspace: async () => workspace,
      createEmitSink,
      loadExcludedRecords,
      writeEnvelope: async (directory, namespace, digest, manifest, refItems) =>
        Artifacts.write(
          directory,
          buildArtifactsEnvelope(namespace, digest, manifest, refItems),
        ),
      logger: { info: (message) => logs.push(message) },
    },
  );
}
