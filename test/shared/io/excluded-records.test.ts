import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  excludedRecordKey,
  loadExcludedRecords,
} from "../../../src/shared/io/excluded-records.js";

let sourceDir: string;

beforeEach(async () => {
  sourceDir = await mkdtemp(path.join(tmpdir(), "excluded-records-"));
});

afterEach(async () => {
  await rm(sourceDir, { recursive: true, force: true });
});

describe("loadExcludedRecords", () => {
  it("returns an empty set when the source has no excluded.yaml", async () => {
    const excluded = await loadExcludedRecords(sourceDir);
    expect(excluded.size).toBe(0);
  });

  it("reads excluded.yaml keyed by kind:key, carrying the reason and optional name", async () => {
    await writeFile(
      path.join(sourceDir, "excluded.yaml"),
      [
        "excluded:",
        "  - kind: Agency",
        '    key: "41105"',
        '    name: "BRAZOS CO. CONST. PCT. 5"',
        '    reason: "addressless county agency (no location in TCOLE export)"',
        "  - kind: Agency",
        "    key: '45101'",
        '    reason: "addressless county agency"',
      ].join("\n"),
      "utf8",
    );

    const excluded = await loadExcludedRecords(sourceDir);
    expect(excluded.size).toBe(2);

    const first = excluded.get(excludedRecordKey("Agency", "41105"));
    expect(first).toEqual({
      kind: "Agency",
      key: "41105",
      name: "BRAZOS CO. CONST. PCT. 5",
      reason: "addressless county agency (no location in TCOLE export)",
    });

    // an entry without a `name` still round-trips, with `name` left undefined
    const second = excluded.get(excludedRecordKey("Agency", "45101"));
    expect(second).toEqual({
      kind: "Agency",
      key: "45101",
      name: undefined,
      reason: "addressless county agency",
    });
  });

  it("rejects an entry missing a required field", async () => {
    await writeFile(
      path.join(sourceDir, "excluded.yaml"),
      ["excluded:", "  - kind: Agency", '    key: "41105"'].join("\n"),
      "utf8",
    );

    await expect(loadExcludedRecords(sourceDir)).rejects.toThrow(
      /requires a non-empty reason/,
    );
  });

  it("propagates malformed YAML as an error", async () => {
    await writeFile(
      path.join(sourceDir, "excluded.yaml"),
      "excluded: [this is not: valid: yaml",
      "utf8",
    );

    await expect(loadExcludedRecords(sourceDir)).rejects.toThrow(
      /is malformed/,
    );
  });
});
