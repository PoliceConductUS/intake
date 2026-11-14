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

test.each([
  [
    "original value",
    { first_name: "9", last_name: "Townsend" },
    { first_name: "9" },
    true,
  ],
  [
    "changed value",
    { first_name: "Pat", last_name: "Townsend" },
    { first_name: "9" },
    false,
  ],
  [
    "explicit null",
    { first_name: "Pat", last_name: null },
    { last_name: null },
    true,
  ],
  ["absent field", { first_name: "Pat" }, { last_name: null }, false],
  [
    "all conditions match",
    { first_name: "9", last_name: "Townsend" },
    { first_name: "9", last_name: "Townsend" },
    true,
  ],
  [
    "one condition differs",
    { first_name: "9", last_name: "Smith" },
    { first_name: "9", last_name: "Townsend" },
    false,
  ],
  ["typed values differ", { first_name: "9" }, { first_name: 9 }, false],
])("conditional exclusions: %s", async (_label, spec, when, active) => {
  const root = await mkdtemp(path.join(tmpdir(), "conditional-exclusion-"));
  try {
    await appendExcludedRecord(root, {
      kind: "Personnel",
      key: "person",
      reason: "incomplete source name",
      when,
    });
    await appendExcludedRecord(root, {
      kind: "Personnel",
      key: "administrative",
      reason: "administrative entry",
    });
    const input: SourceManifest = {
      artifacts: [
        {
          kind: "Personnel",
          records: {
            person: { spec },
            administrative: { spec: { first_name: "Office" } },
          },
        },
        {
          kind: "AgencyPersonnel",
          records: {
            assignment: {
              spec: {
                personnel_id: "person",
                agency_id: "agency",
                start_date: "2000-01-01",
                title: "Officer",
              },
            },
            administrative: {
              spec: {
                personnel_id: "administrative",
                agency_id: "agency",
                start_date: "2000-01-01",
                title: "Officer",
              },
            },
          },
        },
        {
          kind: "LicensingAuthorities",
          records: {
            board: {
              spec: {
                name: "Test board",
                location_path_id: "test",
                source_namespaces: ["test.provider"],
                source_exclusions: {
                  "test.provider": [
                    {
                      kind: "Personnel",
                      key: "person",
                      reason: "earlier exclusion",
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    };
    const before = structuredClone(input);
    const logs: string[] = [];
    const result = await run(root, "test.provider", input, logs);
    expect(result, JSON.stringify(result)).toHaveProperty("artifactsPath");
    if (!("artifactsPath" in result)) throw new Error(JSON.stringify(result));
    const output = await Artifacts.read(result.artifactsPath);
    const personnel = output.spec.artifacts.find(
      (item) => item.kind === "Personnel",
    )!.spec.records;
    const assignments = output.spec.artifacts.find(
      (item) => item.kind === "AgencyPersonnel",
    )!.spec.records;
    expect(Object.keys(personnel)).toEqual(active ? [] : ["person"]);
    expect(Object.keys(assignments)).toEqual(active ? [] : ["assignment"]);
    const authority = output.spec.artifacts.find(
      (item) => item.kind === "LicensingAuthorities",
    )!.spec.records.board;
    const evidence = [
      {
        kind: "Personnel",
        key: "administrative",
        reason: "administrative entry",
      },
    ];
    expect(authority).toMatchObject({
      spec: {
        source_exclusions: {
          "test.provider": active
            ? [
                {
                  kind: "Personnel",
                  key: "person",
                  reason: "incomplete source name",
                },
                ...evidence,
              ]
            : evidence,
        },
      },
    });
    expect(
      logs.some((line) => line.includes("excluded Personnel person:")),
    ).toBe(active);
    expect(
      logs.some((line) => line.includes("excluded Personnel administrative:")),
    ).toBe(true);
    expect(input).toEqual(before);
    if (!active) expect(personnel.person).toMatchObject({ spec });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changed invalid source values still fail normal required-name validation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "conditional-validation-"));
  try {
    await appendExcludedRecord(root, {
      kind: "Personnel",
      key: "person",
      reason: "bad source name",
      when: { first_name: "9" },
    });
    const result = await run(root, "test.provider", {
      artifacts: [
        {
          kind: "Personnel",
          records: { person: { spec: { first_name: "" } } },
        },
        {
          kind: "LicensingAuthorities",
          records: {
            board: {
              spec: {
                name: "Test board",
                location_path_id: "test",
                source_namespaces: ["test.provider"],
              },
            },
          },
        },
      ],
    });
    expect(result).toMatchObject({
      error: {
        exitCode: 1,
        stderr: expect.stringMatching(
          /records.person.spec.first_name.*Too small/,
        ),
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const namespace of ["gov.tx.tcole", "gov.or.dpsst", "example.future"]) {
  test(`${namespace}: shared transform preserves source name and suffix for generation corrections`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "name-quality-"));
    try {
      const manifest: SourceManifest = {
        artifacts: [
          {
            kind: "Personnel",
            records: {
              bad: {
                spec: { first_name: "9", last_name: "Townsend", suffix: "N/A" },
              },
            },
          },
        ],
      };
      manifest.artifacts.push({
        kind: "LicensingAuthorities",
        records: {
          board: {
            spec: {
              name: "Test board",
              location_path_id: "test",
              source_namespaces: [namespace],
            },
          },
        },
      });
      const before = structuredClone(manifest);
      const result = await run(root, namespace, manifest);
      expect(result).toHaveProperty("artifactsPath");
      if (!("artifactsPath" in result)) throw new Error(JSON.stringify(result));
      const artifacts = await Artifacts.read(result.artifactsPath);
      expect(
        artifacts.spec.artifacts.find((item) => item.kind === "Personnel")!.spec
          .records.bad,
      ).toEqual({
        metadata: { name: "bad" },
        spec: { first_name: "9", last_name: "Townsend", suffix: "N/A" },
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
      manifest.artifacts.push({
        kind: "LicensingAuthorities",
        records: {
          board: {
            spec: {
              name: "Test board",
              location_path_id: "test",
              source_namespaces: [namespace],
            },
          },
        },
      });
      const before = structuredClone(manifest);
      const logs: string[] = [];
      const result = await run(root, namespace, manifest, logs);
      expect(result, JSON.stringify(result)).toHaveProperty("artifactsPath");
      if (!("artifactsPath" in result)) throw new Error(JSON.stringify(result));
      const artifacts = await Artifacts.read(result.artifactsPath);
      expect(
        Object.keys(
          artifacts.spec.artifacts.find((item) => item.kind === "Personnel")!
            .spec.records,
        ),
      ).toEqual(["real"]);
      expect(
        Object.keys(
          artifacts.spec.artifacts.find(
            (item) => item.kind === "AgencyPersonnel",
          )!.spec.records,
        ),
      ).toEqual(["retained"]);
      expect(
        artifacts.spec.artifacts.find(
          (item) => item.kind === "LicensingAuthorities",
        )!.spec.records.board,
      ).toMatchObject({
        spec: {
          source_exclusions: {
            [namespace]: [expect.objectContaining({ key: "fixture", reason })],
          },
        },
      });
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
      produces: ["Personnel", "AgencyPersonnel", "LicensingAuthorities"],
      beginCompletion: async () => {},
      complete: async () => {},
      loadSourceModule: async () => async () => manifest,
      readXlsx: async () => [],
      digest: async () => "source-digest",
      makeWorkspace: async () => root,
      createEmitSink: () => ({
        emit: async () => {},
        records: async function* () {},
        flush: async () => [],
      }),
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
