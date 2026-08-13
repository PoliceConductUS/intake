import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSource } from "../../../src/cli/run/index.js";
import { Artifacts } from "../../../src/shared/io/index.js";
import type { ExcludedRecords } from "../../../src/shared/io/index.js";
import { createEmitSink } from "../../../src/cli/run/emit-sink.js";
import { buildArtifactsEnvelope } from "../../../src/cli/run/source-run.js";
import type {
  RunDeps,
  SourceManifest,
} from "../../../src/cli/run/source-run.js";
import type { CommandResult } from "../../../src/shared/cli/types.js";

// Integration test for the streaming `emit` sink: a fake source `run()`
// returns an inline `LocationPaths` record AND streams a
// `LocationPathGeometries` record via `emit`, driven end-to-end through
// `runSource` with only `runImport` stubbed (it requires a live database).
// The written Artifacts envelope is read back with `Artifacts.read` to
// prove the inline records and the streamed ref both resolve correctly.
describe("emit sink integration (via runSource)", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "emit-integration-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("splices a streamed LocationPathGeometries ref alongside inline LocationPaths records", async () => {
    let capturedArtifactsPath: string | undefined;
    let capturedOptions:
      | { dryImport?: boolean; excludedRecords?: ExcludedRecords }
      | undefined;

    const fakeRun = async (deps: RunDeps): Promise<SourceManifest> => {
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
                  state_or_territory_slug: "az",
                  administrative_area_slug: null,
                  place_slug: null,
                  state_or_territory_name: "Arizona",
                  administrative_area_name: null,
                  place_name: null,
                  parent_location_path_id: null,
                },
              },
            },
          },
        ],
      };
    };

    const runImport = async (
      ref: string,
      opts: { dryImport?: boolean; excludedRecords?: ExcludedRecords },
    ): Promise<CommandResult> => {
      capturedArtifactsPath = ref;
      capturedOptions = opts;
      return { exitCode: 0 };
    };

    const result = await runSource(
      "gov.census.gazetteer",
      ["dummy-snapshot.zip"],
      { dryRun: true },
      {
        sourcesRoot: "/unused",
        env: {},
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
        runImport,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(capturedOptions).toEqual({
      dryImport: true,
      excludedRecords: new Map(),
    });
    expect(capturedArtifactsPath).toBeDefined();

    const envelope = await Artifacts.read(capturedArtifactsPath as string);

    expect(envelope.metadata.namespace).toBe("gov.census.gazetteer");
    expect(envelope.spec.artifacts).toHaveLength(2);

    const locationPaths = envelope.spec.artifacts.find(
      (artifact) => artifact.kind === "LocationPaths",
    );
    expect(locationPaths).toBeDefined();
    expect(Object.keys(locationPaths?.spec.records ?? {})).toEqual(["az"]);
    expect(locationPaths?.spec.records["az"]).toMatchObject({
      location_path_id: "az",
      state_or_territory_name: "Arizona",
    });

    const geometries = envelope.spec.artifacts.find(
      (artifact) => artifact.kind === "LocationPathGeometries",
    );
    expect(geometries).toBeDefined();
    expect(Object.keys(geometries?.spec.records ?? {})).toEqual(["az-state"]);
    expect(geometries?.spec.records["az-state"]).toMatchObject({
      location_path_id: "az",
      sourceLocationPathKey: "az",
      geometry: { type: "Point", coordinates: [0, 0] },
    });
  });
});
