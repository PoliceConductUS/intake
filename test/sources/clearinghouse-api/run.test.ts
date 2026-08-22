import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { run } from "../../../sources/clearinghouse-api/run.js";
import { readXlsx } from "../../../src/cli/run/read-xlsx.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

const data = {
  cases: [
    {
      id: 100,
      name: "Doe v. Austin PD",
      state: "Texas",
      court: "W.D. Tex.",
      filing_date: "2023-05-01",
      filing_year: 2023,
      non_docket_case_number: "1:23-cv-001",
      summary: "Excessive force claim.",
      clearinghouse_link: "https://clearinghouse.net/case/100",
      case_defendants: [
        { name: "City of Austin", institution: "Austin Police Department" },
        { name: "John Smith" },
      ],
    },
    // California -> filtered out (no roster)
    { id: 200, name: "Roe v. LAPD", state: "California", filing_year: 2023 },
    // Texas but before the year cutoff -> filtered out
    { id: 300, name: "Old v. TX", state: "Texas", filing_year: 2019 },
    // Minnesota but no filing date -> skipped
    { id: 400, name: "NoDate v. MN", state: "Minnesota", filing_year: null },
  ],
};

async function runWith(env?: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), "clearinghouse-"));
  tempDirs.push(dir);
  const jsonPath = path.join(dir, "clearinghouse-cases.json");
  await writeFile(jsonPath, JSON.stringify(data));
  return run({
    paths: [jsonPath],
    readXlsx,
    state: dir,
    emit: async () => {},
    logger: { info: () => {} },
    env: env ?? {},
  });
}

describe("clearinghouse-api run", () => {
  it("emits TX/MN cases since the cutoff with the officer defendant and link", async () => {
    const manifest = await runWith();
    const byKind = Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    );

    // Only case 100 survives (TX, 2023, has a filing date).
    expect(Object.keys(byKind.CivilCases)).toEqual(["100"]);
    expect(byKind.CivilCases["100"].spec).toMatchObject({
      title: "Doe v. Austin PD",
      cause_number: "1:23-cv-001",
      filed_date: "2023-05-01",
      claims_summary: "Excessive force claim.",
      location_path_id: "tx",
      primary_source_url: "https://clearinghouse.net/case/100",
    });

    // "John Smith" is the only person defendant; "City of Austin" is the agency.
    expect(Object.keys(byKind.CivilCaseOfficers)).toEqual(["100|john-smith"]);
    expect(byKind.CivilCaseOfficers["100|john-smith"].spec).toEqual({
      civil_case_id: "100",
      state: "TX",
      agency_name: "Austin Police Department",
      officer_name: "John Smith",
    });

    expect(Object.keys(byKind.CivilCaseLinks)).toEqual(["100|clearinghouse"]);
  });

  it("honors the CLEARINGHOUSE_MIN_YEAR override", async () => {
    const manifest = await runWith({ CLEARINGHOUSE_MIN_YEAR: "2024" });
    const cases = manifest.artifacts.find((a) => a.kind === "CivilCases")!;
    // 2023 case now falls below the cutoff.
    expect(Object.keys(cases.records)).toEqual([]);
  });
});
