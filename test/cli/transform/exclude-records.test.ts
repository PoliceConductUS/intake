import { describe, expect, test } from "vitest";
import {
  excludeManifestRecords,
  selectActiveExcludedRecords,
} from "../../../src/cli/transform/exclude-records.js";
import { excludedRecordKey } from "../../../src/shared/io/index.js";
import type { SourceManifest } from "../../../src/cli/transform/source-transform.js";
import type { ExcludedRecord } from "../../../src/shared/io/excluded-records.js";

test("source conditions use exact deep equality and own fields only", () => {
  const spec = Object.assign(Object.create({ inherited: "bad" }), {
    details: { labels: ["9", "Townsend"], enabled: false, count: 0 },
  });
  const input: SourceManifest = {
    artifacts: [{ kind: "Personnel", records: { person: { spec } } }],
  };
  const exclusion = (when: NonNullable<ExcludedRecord["when"]>) =>
    new Map([
      [
        "Personnel:person",
        {
          kind: "Personnel",
          key: "person",
          reason: "source data defect",
          when,
        },
      ],
    ]);
  expect([
    ...selectActiveExcludedRecords(
      input,
      exclusion({
        details: { count: 0, enabled: false, labels: ["9", "Townsend"] },
      }),
    ).keys(),
  ]).toEqual(["Personnel:person"]);
  expect(
    selectActiveExcludedRecords(
      input,
      exclusion({
        details: { labels: ["Townsend", "9"], enabled: false, count: 0 },
      }),
    ).size,
  ).toBe(0);
  expect(
    selectActiveExcludedRecords(
      input,
      exclusion({
        details: { labels: ["9", "Townsend"], enabled: "false", count: 0 },
      }),
    ).size,
  ).toBe(0);
  expect(
    selectActiveExcludedRecords(input, exclusion({ inherited: "bad" })).size,
  ).toBe(0);
  expect(
    selectActiveExcludedRecords({ artifacts: [] }, exclusion({ details: null }))
      .size,
  ).toBe(0);
});

describe("excludeManifestRecords", () => {
  test("removes an excluded agency and cascades to its assignments", () => {
    const manifest: SourceManifest = {
      artifacts: [
        {
          kind: "Agencies",
          records: {
            "1": { spec: { name: "Keep PD", state: "TX" } },
            "515014": { spec: { name: "STATE OF INDIANA", state: "IN" } },
          },
        },
        {
          kind: "AgencyPersonnel",
          records: {
            a: { spec: { agency_id: "1", personnel_id: "o1" } },
            b: { spec: { agency_id: "515014", personnel_id: "o2" } },
          },
        },
      ],
    };
    const excluded = new Map([
      [
        excludedRecordKey("Agency", "515014"),
        { kind: "Agency", key: "515014", reason: "out-of-jurisdiction" },
      ],
    ]);

    const { manifest: filtered, removed } = excludeManifestRecords(
      manifest,
      excluded,
    );

    const agencies = filtered.artifacts.find(
      (a) => a.kind === "Agencies",
    )!.records;
    const assignments = filtered.artifacts.find(
      (a) => a.kind === "AgencyPersonnel",
    )!.records;
    expect(Object.keys(agencies)).toEqual(["1"]);
    // Assignment "b" referenced the excluded agency and cascaded out.
    expect(Object.keys(assignments)).toEqual(["a"]);
    expect(removed).toEqual({ Agency: 1, AgencyPersonnel: 1 });
  });

  test("is a no-op when nothing is excluded, preserving explicit personnel roots", () => {
    const manifest: SourceManifest = {
      personnelSourceNames: ["person"],
      artifacts: [
        { kind: "Agencies", records: { "1": { spec: { name: "PD" } } } },
      ],
    };
    const { manifest: filtered, removed } = excludeManifestRecords(
      manifest,
      new Map(),
    );
    expect(filtered).toEqual(manifest);
    expect(removed).toEqual({});
  });
});
