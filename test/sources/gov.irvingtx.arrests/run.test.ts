import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { run } from "../../../sources/gov.irvingtx.arrests/run.js";
import type { NormalizedArrest } from "../../../sources/gov.irvingtx.arrests/arrest.js";
import type {
  RunDataContext,
  SourceManifest,
} from "../../../src/cli/run/source-run.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

// Roster knows Matthew Jones and Brendon Fowler at Irving PD; anyone else is
// unresolved (resolve-or-fail).
const data: RunDataContext = {
  async resolveAgency({ agencyName }) {
    return agencyName === "Irving Police Department"
      ? { agencyId: "irving" }
      : null;
  },
  async resolvePersonnel({ agencyId, personnelName }) {
    if (agencyId !== "irving") return null;
    const officer = {
      "MATTHEW JONES": "ap-jones",
      "BRENDON FOWLER": "ap-fowler",
    }[personnelName];
    return officer === undefined ? null : { agencyPersonnelId: officer };
  },
};

function arrest(overrides: Partial<NormalizedArrest>): NormalizedArrest {
  return {
    officerNames: ["MATTHEW JONES"],
    year: "2020",
    month: "2020-01",
    isoWeek: "2020-W01",
    dayOfWeek: "Wed",
    hour: "00",
    district: "3",
    offense: "PUBLIC INTOXICATION",
    chargeLevel: "MC",
    ...overrides,
  };
}

function records(
  manifest: SourceManifest,
  kind: string,
): Record<string, { spec: unknown }> {
  const artifact = manifest.artifacts.find((a) => a.kind === kind);
  expect(artifact, `missing artifact ${kind}`).toBeDefined();
  return artifact!.records;
}

describe("arrests run", () => {
  it("emits one profile per resolved officer and reports unresolved names", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arrests-"));
    tempDirs.push(dir);
    const state = path.join(dir, "state");
    await mkdir(state, { recursive: true });
    const jsonl = path.join(dir, "arrests-normalized.jsonl");
    const arrests = [
      arrest({
        officerNames: ["MATTHEW JONES"],
        year: "2020",
        offense: "PUBLIC INTOXICATION",
      }),
      arrest({
        officerNames: ["MATTHEW JONES"],
        year: "2021",
        offense: "THEFT",
      }),
      arrest({
        officerNames: ["BRENDON FOWLER"],
        year: "2021",
        offense: "DWI",
      }),
      arrest({ officerNames: ["NOBODY KNOWN"], year: "2021", offense: "DWI" }),
    ];
    await writeFile(
      jsonl,
      arrests.map((a) => JSON.stringify(a)).join("\n"),
      "utf8",
    );

    const manifest = await run({
      paths: [jsonl],
      readXlsx: (() => {
        throw new Error("unused");
      }) as never,
      state,
      emit: async () => {},
      env: {},
      data,
    });

    const profiles = records(manifest, "ArrestProfiles");
    expect(Object.keys(profiles).sort()).toEqual(["ap-fowler", "ap-jones"]);

    const jones = profiles["ap-jones"]!.spec as {
      agency_personnel_id: string;
      coverage: { totalArrests: number };
      breakdowns: Record<string, Record<string, number>>;
    };
    expect(jones.agency_personnel_id).toBe("ap-jones");
    expect(jones.coverage.totalArrests).toBe(2);
    expect(jones.breakdowns.by_year).toEqual({ "2020": 1, "2021": 1 });
    expect(jones.breakdowns.by_offense).toEqual({
      "PUBLIC INTOXICATION": 1,
      THEFT: 1,
    });

    const report = JSON.parse(
      await readFile(path.join(state, "arrest-report.json"), "utf8"),
    ) as {
      totalArrests: number;
      officersProfiled: number;
      unresolvedNameCount: number;
      arrestsWithNoResolvedOfficer: number;
    };
    expect(report.totalArrests).toBe(4);
    expect(report.officersProfiled).toBe(2);
    expect(report.unresolvedNameCount).toBe(1);
    expect(report.arrestsWithNoResolvedOfficer).toBe(1);
  });

  it("fails loud when the agency does not resolve", async () => {
    const noAgency: RunDataContext = {
      ...data,
      async resolveAgency() {
        return null;
      },
    };
    const dir = await mkdtemp(path.join(tmpdir(), "arrests-"));
    tempDirs.push(dir);
    const jsonl = path.join(dir, "arrests-normalized.jsonl");
    await writeFile(jsonl, JSON.stringify(arrest({})), "utf8");
    await expect(
      run({
        paths: [jsonl],
        readXlsx: (() => {
          throw new Error("unused");
        }) as never,
        state: dir,
        emit: async () => {},
        env: {},
        data: noAgency,
      }),
    ).rejects.toThrow(/does not resolve to an agency/);
  });
});
