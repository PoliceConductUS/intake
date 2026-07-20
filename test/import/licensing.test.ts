import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  parseLicensingFile,
  planStateImport,
} from "../../src/cli/import/licensing/plan.js";

const dataDir = path.join(process.cwd(), "data", "licensing");

async function readStateFile(state: string): Promise<string> {
  return readFile(path.join(dataDir, state, "licensing.json"), "utf8");
}

describe("licensing file validation", () => {
  test("every committed state file validates", async () => {
    const entries = await readdir(dataDir, { withFileTypes: true });
    const states = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(states.length).toBeGreaterThanOrEqual(51);

    for (const state of states) {
      const parsed = parseLicensingFile(await readStateFile(state));
      expect(
        "file" in parsed,
        `${state}: ${"error" in parsed ? parsed.error : ""}`,
      ).toBe(true);
      if ("file" in parsed) {
        expect(parsed.file.state).toBe(state);
      }
    }
  });

  test("texas is verified with complete provenance", async () => {
    const parsed = parseLicensingFile(await readStateFile("tx"));
    if (!("file" in parsed)) {
      throw new Error(parsed.error);
    }
    expect(parsed.file.status).toBe("verified");
    if (parsed.file.status !== "verified") {
      return;
    }
    expect(parsed.file.organization.abbreviation).toBe("TCOLE");
    expect(parsed.file.facts.length).toBeGreaterThanOrEqual(4);
    const sourceKeys = new Set(parsed.file.sources.map((s) => s.key));
    for (const fact of parsed.file.facts) {
      for (const key of fact.sourceKeys) {
        expect(sourceKeys.has(key), `dangling sourceKey ${key}`).toBe(true);
      }
    }
  });

  test("malformed JSON fails loudly", () => {
    const parsed = parseLicensingFile("{not json");
    expect("error" in parsed).toBe(true);
  });

  test("verified file with dangling sourceKeys fails", async () => {
    const raw = await readStateFile("tx");
    const mutated = JSON.parse(raw) as {
      facts: { sourceKeys: string[] }[];
    };
    mutated.facts[0]!.sourceKeys = ["does_not_exist"];
    const parsed = parseLicensingFile(JSON.stringify(mutated));
    expect("error" in parsed).toBe(true);
    if ("error" in parsed) {
      expect(parsed.error).toContain("does_not_exist");
    }
  });

  test("verified file without sources fails", async () => {
    const raw = JSON.parse(await readStateFile("tx")) as {
      sources: unknown[];
    };
    raw.sources = [];
    const parsed = parseLicensingFile(JSON.stringify(raw));
    expect("error" in parsed).toBe(true);
  });
});

describe("licensing import planning", () => {
  test("plans deterministic rows from the texas file", async () => {
    const parsed = parseLicensingFile(await readStateFile("tx"));
    if (!("file" in parsed) || parsed.file.status !== "verified") {
      throw new Error("expected verified texas file");
    }
    const plan = planStateImport(parsed.file);
    expect(plan.report.id).toBe("locrep_tx_licensing_summary");
    expect(plan.report.reportType).toBe("licensing_summary");
    expect(plan.report.reportKey).toBe("licensing-summary");
    expect(plan.report.status).toBe("published");
    expect(plan.report.payload.organization.name).toBe(
      "Texas Commission on Law Enforcement",
    );
    expect(plan.report.payload.facts).toHaveLength(4);
    expect(plan.sources).toHaveLength(5);
    expect(new Set(plan.sources.map((s) => s.id)).size).toBe(5);
  });
});
