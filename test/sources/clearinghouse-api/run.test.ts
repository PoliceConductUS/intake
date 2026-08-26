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

const envelope = {
  agency: { id: "a1", name: "Austin Police Department", state: "TX" },
  cases: [
    {
      id: 100,
      name: "Doe v. Austin PD",
      court: "Western District of Texas",
      filing_date: "2023-05-01",
      filing_year: 2023,
      summary: "Excessive force claim.",
      clearinghouse_link: "https://clearinghouse.net/case/100",
      // The main docket carries the court-assigned number the CivilCase is keyed
      // on. court "Western District of Texas" -> court_id "txwd" (same token CL
      // uses natively), docket "1:23-cv-001" -> id "txwd:1:23-cv-001".
      dockets: [
        {
          court: "Western District of Texas",
          is_main_docket: true,
          docket_number_manual: "1:23-cv-001",
          recap_docket_number: "1:23-cv-001",
        },
      ],
      case_defendants: [
        { name: "City of Austin", institution: "Austin Police Department" },
        { name: "John Smith" },
      ],
    },
    // pre-cutoff year -> filtered
    {
      id: 300,
      name: "Old v. Austin",
      filing_year: 2019,
      case_defendants: [{ institution: "Austin Police Department" }],
    },
    // full-text noise: no defendant names this agency -> guard skips
    {
      id: 500,
      name: "Unrelated v. Dallas",
      filing_date: "2023-06-01",
      filing_year: 2023,
      case_defendants: [
        { institution: "Dallas Police Department" },
        { name: "John Smith" },
      ],
    },
    // names the agency, but the person defendant resolves to no officer -> skipped
    {
      id: 600,
      name: "NoOfficer v. Austin",
      filing_date: "2023-07-01",
      filing_year: 2023,
      case_defendants: [
        { institution: "Austin Police Department" },
        { name: "Mary Jones" },
      ],
    },
  ],
};

function fakeData(resolved: Record<string, string> = { "John Smith": "ao-1" }) {
  const calls: Array<{ agencyId: string; personnelName: string }> = [];
  return {
    calls,
    resolvePersonnel: async ({
      agencyId,
      personnelName,
    }: {
      agencyId: string;
      personnelName: string;
    }) => {
      calls.push({ agencyId, personnelName });
      const id = resolved[personnelName];
      return id === undefined ? null : { agencyPersonnelId: id };
    },
  };
}

async function runWith(data = fakeData(), env: Record<string, string> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "clearinghouse-"));
  tempDirs.push(dir);
  const file = path.join(dir, "austin-police-department.cases.json");
  await writeFile(file, JSON.stringify(envelope));
  return run({
    paths: [file],
    readXlsx,
    state: dir,
    emit: async () => {},
    data,
    logger: { info: () => {} },
    env,
  });
}

describe("clearinghouse-api run", () => {
  it("keeps only cases that name the agency and resolve an officer", async () => {
    const data = fakeData();
    const manifest = await runWith(data);
    const byKind = Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    );

    // 300 (year), 500 (guard), 600 (no officer) all drop; only 100 survives.
    // Its id is the natural docket key (ADR 0028): court_id "txwd" + docket.
    const caseId = "txwd:1:23-cv-001";
    expect(Object.keys(byKind.CivilCases)).toEqual([caseId]);
    expect(byKind.CivilCases[caseId].spec).toMatchObject({
      id: caseId,
      title: "Doe v. Austin PD",
      cause_number: "1:23-cv-001",
      filed_date: "2023-05-01",
      location_path_id: "tx",
      primary_source_url: "https://clearinghouse.net/case/100",
    });

    expect(Object.keys(byKind.CivilCasePersonnel)).toEqual([`${caseId}|ao-1`]);
    expect(byKind.CivilCasePersonnel[`${caseId}|ao-1`].spec).toEqual({
      civil_case_id: caseId,
      agency_personnel_id: "ao-1",
    });
    expect(Object.keys(byKind.CivilCaseLinks)).toEqual([
      `${caseId}|clearinghouse`,
    ]);

    // The guard runs before resolution: case 500 (Dallas) is never resolved, so
    // "John Smith" is only asked for cases 100 and 600 (both name Austin).
    expect(data.calls).toEqual([
      { agencyId: "a1", personnelName: "John Smith" },
      { agencyId: "a1", personnelName: "Mary Jones" },
    ]);
  });

  it("honors the CLEARINGHOUSE_MIN_YEAR override", async () => {
    const manifest = await runWith(fakeData(), {
      CLEARINGHOUSE_MIN_YEAR: "2024",
    });
    const cases = manifest.artifacts.find((a) => a.kind === "CivilCases")!;
    expect(Object.keys(cases.records)).toEqual([]);
  });
});
