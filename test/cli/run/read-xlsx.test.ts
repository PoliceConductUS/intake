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

  it("is deterministic across repeat reads", async () => {
    expect(await readXlsx(fixture)).toEqual(await readXlsx(fixture));
  });
});
