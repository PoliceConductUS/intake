import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readXlsx } from "../../../src/cli/run/read-xlsx.js";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/azpost/officer-list-sample.xlsx",
);

describe("readXlsx", () => {
  it("reads sheet 1 rows keyed by the header row", async () => {
    const rows = await readXlsx(fixture);
    expect(rows).toHaveLength(4);
    expect(rows[0]["POST ID"]).toBe("1001");
    expect(rows[0]["FIRST"]).toBe("Skip");
    expect(rows[3]["POST ID"]).toBe(""); // blank cell → ""
  });

  it("coerces a numeric cell to a clean digit string", async () => {
    const rows = await readXlsx(fixture);
    // POST ID on row 0 is stored as a numeric cell in the fixture.
    expect(rows[0]["POST ID"]).toBe("1001");
  });

  it("coerces a Date cell to a clean ISO-like string", async () => {
    const rows = await readXlsx(fixture);
    const appointedOn = rows[0]["APPOINTED ON"];
    expect(appointedOn).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(appointedOn).not.toContain("GMT");
    expect(appointedOn).not.toContain("[object");
  });

  it("is deterministic across repeat reads", async () => {
    expect(await readXlsx(fixture)).toEqual(await readXlsx(fixture));
  });

  it("passes when every required column is present", async () => {
    const rows = await readXlsx(fixture, undefined, ["POST ID", "FIRST"]);
    expect(rows).toHaveLength(4);
  });

  it("fails loud when a required column is missing, naming it", async () => {
    await expect(
      readXlsx(fixture, undefined, ["POST ID", "NOPE_NOT_A_COLUMN"]),
    ).rejects.toThrow(/missing required column\(s\): NOPE_NOT_A_COLUMN/);
  });
});
