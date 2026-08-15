import { describe, expect, test } from "vitest";
import { excludeManifestRecords } from "../../../src/cli/run/exclude-records.js";
import { excludedRecordKey } from "../../../src/shared/io/index.js";
import type { SourceManifest } from "../../../src/cli/run/source-run.js";

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
            a: { spec: { agency_id: "1", officer_id: "o1" } },
            b: { spec: { agency_id: "515014", officer_id: "o2" } },
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

    const agencies = filtered.artifacts.find((a) => a.kind === "Agencies")!
      .records;
    const assignments = filtered.artifacts.find(
      (a) => a.kind === "AgencyPersonnel",
    )!.records;
    expect(Object.keys(agencies)).toEqual(["1"]);
    // Assignment "b" referenced the excluded agency and cascaded out.
    expect(Object.keys(assignments)).toEqual(["a"]);
    expect(removed).toEqual({ Agency: 1, AgencyPersonnel: 1 });
  });

  test("is a no-op when nothing is excluded", () => {
    const manifest: SourceManifest = {
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
