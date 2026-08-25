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
      parties: ["City of Irving", "John Smith"],
    },
    // no filing date -> skipped
    {
      id: 124,
      case_name: "NoDate v. Irving",
      docket_number: "x",
      court: "txnd",
      date_filed: null,
      absolute_url: "/docket/124/",
      parties: ["Jane Roe"],
    },
  ],
};

// Fake run-phase resolver: "John Smith" @ agency "a1" resolves to a fixed
// officer source id; every other name is unresolved (null).
function fakeData(resolved: Record<string, string> = { "John Smith": "ao-1" }) {
  const calls: Array<{ agencyId: string; officerName: string }> = [];
  return {
    calls,
    resolveOfficer: async ({
      agencyId,
      officerName,
    }: {
      agencyId: string;
      officerName: string;
    }) => {
      calls.push({ agencyId, officerName });
      const id = resolved[officerName];
      return id === undefined ? null : { agencyOfficerId: id };
    },
  };
}

async function runWith(data = fakeData()) {
  const dir = await mkdtemp(path.join(tmpdir(), "courtlistener-"));
  tempDirs.push(dir);
  const file = path.join(dir, "irving-police-department.dockets.json");
  await writeFile(file, JSON.stringify(envelope));
  return run({
    paths: [file],
    readXlsx,
    state: dir,
    emit: async () => {},
    data,
    logger: { info: () => {} },
  });
}

describe("courtlistener run", () => {
  it("resolves the person party to an officer source id and emits the case", async () => {
    const data = fakeData();
    const manifest = await runWith(data);
    const byKind = Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    );

    // docket 124 has no filing date -> skipped.
    expect(Object.keys(byKind.CivilCases)).toEqual(["cl-123"]);
    expect(byKind.CivilCases["cl-123"].spec).toMatchObject({
      title: "Doe v. City of Irving",
      filed_date: "2023-04-01",
      location_path_id: "tx",
    });

    // The agency source id from the envelope scopes the resolve; only the person
    // party is resolved, and the returned source id is stamped verbatim.
    expect(data.calls).toEqual([{ agencyId: "a1", officerName: "John Smith" }]);
    expect(Object.keys(byKind.CivilCasePersonnel)).toEqual(["cl-123|ao-1"]);
    expect(byKind.CivilCasePersonnel["cl-123|ao-1"].spec).toEqual({
      civil_case_id: "cl-123",
      agency_personnel_id: "ao-1",
    });

    expect(Object.keys(byKind.CivilCaseLinks)).toEqual([
      "cl-123|courtlistener",
    ]);
  });

  it("skips a case whose only person party resolves to no officer", async () => {
    const manifest = await runWith(fakeData({}));
    const byKind = Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    );
    expect(Object.keys(byKind.CivilCases)).toEqual([]);
    expect(Object.keys(byKind.CivilCasePersonnel)).toEqual([]);
    expect(Object.keys(byKind.CivilCaseLinks)).toEqual([]);
  });
});
