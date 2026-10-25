import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { transformSource } from "../../../src/cli/transform/index.js";
import {
  buildArtifactsEnvelope,
  type SourceManifest,
} from "../../../src/cli/transform/source-transform.js";
import { Artifacts } from "../../../src/shared/io/index.js";
import {
  appendExcludedRecord,
  loadExcludedRecords,
} from "../../../src/shared/io/excluded-records.js";

for (const namespace of ["gov.tx.tcole", "gov.or.dpsst", "example.future"]) {
  test(`${namespace}: shared transform rejects numeric identity and preserves evidence`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "name-quality-"));
    try {
      const manifest: SourceManifest = {
        artifacts: [
          {
            kind: "Personnel",
            records: {
              bad: { spec: { first_name: "9", last_name: "Townsend" } },
            },
          },
        ],
      };
      const before = structuredClone(manifest);
      const result = await run(root, namespace, manifest);
      expect(result).toMatchObject({
        error: { exitCode: 1, stderr: expect.stringContaining("first_name") },
      });
      expect(manifest).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test(`${namespace}: fixture exclusion data cascades while same-named person survives`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "name-exclusion-"));
    try {
      const reason =
        "Confirmed synthetic fixture from reviewed source evidence; test audit reference";
      await appendExcludedRecord(root, {
        kind: "Personnel",
        key: "fixture",
        reason,
      });
      const spec = { first_name: "Chester", last_name: "Test" };
      const manifest: SourceManifest = {
        artifacts: [
          { kind: "Personnel", records: { fixture: { spec }, real: { spec } } },
          {
            kind: "AgencyPersonnel",
            records: {
              excluded: {
                spec: {
                  personnel_id: "fixture",
                  agency_id: "agency",
                  start_date: "2000-01-01",
                  title: "Officer",
                },
              },
              retained: {
                spec: {
                  personnel_id: "real",
                  agency_id: "agency",
                  start_date: "2000-01-01",
                  title: "Officer",
                },
              },
            },
          },
        ],
      };
      const before = structuredClone(manifest);
      const logs: string[] = [];
      const result = await run(root, namespace, manifest, logs);
      expect(result, JSON.stringify(result)).toHaveProperty("artifactsPath");
      if (!("artifactsPath" in result)) throw new Error(JSON.stringify(result));
      const artifacts = await Artifacts.read(result.artifactsPath);
      expect(Object.keys(artifacts.spec.artifacts[0]!.spec.records)).toEqual([
        "real",
      ]);
      expect(Object.keys(artifacts.spec.artifacts[1]!.spec.records)).toEqual([
        "retained",
      ]);
      expect(artifacts.metadata.namespace).toBe(namespace);
      expect(logs.join("\n")).toContain(
        `${namespace}: excluded Personnel fixture: ${reason}`,
      );
      expect(logs.join("\n")).toContain("Personnel=1, AgencyPersonnel=1");
      expect(
        (await loadExcludedRecords(root)).get("Personnel:fixture")?.reason,
      ).toBe(reason);
      expect(manifest).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
async function run(
  root: string,
  namespace: string,
  manifest: SourceManifest,
  logs: string[] = [],
) {
  return transformSource(
    namespace,
    ["retained-input.json"],
    {},
    {
      sourcesRoot: root,
      state: root,
      env: {},
      produces: ["Personnel", "AgencyPersonnel"],
      beginCompletion: async () => {},
      complete: async () => {},
      loadSourceModule: async () => async () => manifest,
      readXlsx: async () => [],
      digest: async () => "source-digest",
      makeWorkspace: async () => root,
      createEmitSink: () => ({ emit: async () => {}, flush: async () => [] }),
      loadExcludedRecords,
      writeEnvelope: async (directory, source, digest, filtered) =>
        Artifacts.write(
          directory,
          buildArtifactsEnvelope(source, digest, filtered),
        ),
      logger: { info: (message) => logs.push(message) },
    },
  );
}
