import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { run } from "../../../sources/courtlistener/run.js";
import { readXlsx } from "../../../src/cli/run/read-xlsx.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

const envelope = {
  agency: { id: "a1", name: "Irving Police Department", state: "TX" },
  dockets: [
    {
      id: 123,
      case_name: "Doe v. City of Irving",
      docket_number: "3:23-cv-001",
      court: "txnd",
      date_filed: "2023-04-01",
      absolute_url: "/docket/123/doe-v-city-of-irving/",
      cause: "28:1983 Civil Rights",
      date_terminated: "2023-11-20",
      defendants: ["City of Irving", "John Smith"],
    },
    // no filing date -> skipped
    {
      id: 124,
      case_name: "NoDate v. Irving",
      docket_number: "x",
      court: "txnd",
      date_filed: null,
      absolute_url: "/docket/124/",
      defendants: ["Jane Roe"],
    },
  ],
};

async function runWith() {
  const dir = await mkdtemp(path.join(tmpdir(), "courtlistener-"));
  tempDirs.push(dir);
  const file = path.join(dir, "irving-police-department.dockets.json");
  await writeFile(file, JSON.stringify(envelope));
  return run({
    paths: [file],
    readXlsx,
    state: dir,
    emit: async () => {},
    logger: { info: () => {} },
  });
}

describe("courtlistener run", () => {
  it("emits a docket as a civil case with its officer defendant and link", async () => {
    const manifest = await runWith();
    const byKind = Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    );

    // docket 124 has no filing date -> skipped.
    expect(Object.keys(byKind.CivilCases)).toEqual(["cl-123"]);
    expect(byKind.CivilCases["cl-123"].spec).toMatchObject({
      title: "Doe v. City of Irving",
      cause_number: "3:23-cv-001",
      filed_date: "2023-04-01",
      claims_summary: "28:1983 Civil Rights",
      date_terminated: "2023-11-20",
      location_path_id: "tx",
      primary_source_url:
        "https://www.courtlistener.com/docket/123/doe-v-city-of-irving/",
    });

    // "City of Irving" is the institution; only "John Smith" is a person.
    expect(Object.keys(byKind.CivilCaseOfficers)).toEqual([
      "cl-123|john-smith",
    ]);
    expect(byKind.CivilCaseOfficers["cl-123|john-smith"].spec).toEqual({
      civil_case_id: "cl-123",
      state: "TX",
      agency_name: "Irving Police Department",
      officer_name: "John Smith",
    });

    expect(Object.keys(byKind.CivilCaseLinks)).toEqual([
      "cl-123|courtlistener",
    ]);
  });
});
