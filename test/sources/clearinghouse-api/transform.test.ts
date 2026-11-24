import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { transform } from "../../../sources/net/clearinghouse/api/transform.js";
import { readXlsx } from "../../../src/cli/transform/read-xlsx.js";

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

type Envelope = {
  agency: { id?: string; name?: string; state?: string };
  cases: unknown[];
};

async function runFiles(
  files: Record<string, Envelope>,
  data = fakeData(),
  env: Record<string, string> = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), "clearinghouse-"));
  tempDirs.push(dir);
  const logs: string[] = [];
  const paths: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    paths.push(path.join(dir, name));
    await writeFile(path.join(dir, name), JSON.stringify(content));
  }
  const manifest = await transform({
    paths,
    readXlsx,
    state: dir,
    emit: async () => {},
    data,
    logger: { info: (message) => logs.push(message) },
    env,
  });
  return {
    manifest,
    logs,
    byKind: Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    ),
  };
}

async function runWith(data = fakeData(), env: Record<string, string> = {}) {
  return (await runFiles({ "a1.cases.json": envelope }, data, env)).manifest;
}

const austin = { id: "a1", name: "Austin Police Department", state: "TX" };

function austinCase(id: number, fields: Record<string, unknown>) {
  return {
    id,
    court: "Western District of Texas",
    clearinghouse_link: `https://clearinghouse.net/case/${id}`,
    dockets: [
      {
        court: "Western District of Texas",
        is_main_docket: true,
        docket_number_manual: `1:23-cv-${id}`,
      },
    ],
    case_defendants: [
      { name: "City of Austin", institution: "Austin Police Department" },
      { name: "John Smith" },
    ],
    ...fields,
  };
}

describe("net/clearinghouse/api run", () => {
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

  it("accounts for every case read: one emitted, three not selected, each under its reason", async () => {
    const manifest = await runWith();
    expect(manifest.accounting).toEqual([
      {
        input: "cases",
        read: 4,
        emitted: 1,
        reported: 0,
        notSelected: {
          "filed before the minimum year": 1,
          "no defendant names the agency": 1,
          "names no officer the database knows": 1,
          "agency name has no distinctive word": 0,
        },
      },
    ]);
  });

  it("emits the licensing authority of each state it read agencies for, with no finding when no case was left out", async () => {
    const { byKind } = await runFiles({
      "a1.cases.json": envelope,
      "a2.cases.json": {
        agency: { id: "a2", name: "Duluth Police Department", state: "mn" },
        cases: [],
      },
    });
    expect(byKind.LicensingAuthorities).toEqual({
      tx: {
        metadata: {
          action: "PATCH",
          selector: { location_path: { path: "/tx/" } },
          defects: [],
        },
        spec: {},
      },
      mn: {
        metadata: {
          action: "PATCH",
          selector: { location_path: { path: "/mn/" } },
          defects: [],
        },
        spec: {},
      },
    });
  });

  it("emits no case and reports a finding on the state's licensing authority for a case that names a known officer and has no title or no filing date", async () => {
    const { manifest, byKind } = await runFiles({
      "a1.cases.json": {
        agency: austin,
        cases: [
          austinCase(700, { name: " ", filing_date: "2023-08-01" }),
          austinCase(800, { name: "Roe v. Austin", filing_date: "unknown" }),
          austinCase(900, { clearinghouse_link: "" }),
        ],
      },
    });
    expect(byKind.CivilCases).toEqual({});
    expect(byKind.CivilCasePersonnel).toEqual({});
    expect(byKind.CivilCaseLinks).toEqual({});
    expect(byKind.LicensingAuthorities.tx.metadata?.defects).toEqual([
      {
        code: "civil-case-not-buildable",
        type: "warning",
        field: "civil_cases",
        value: { name: " ", filing_date: "2023-08-01", filing_year: null },
        message:
          "Civil case 700 in the Civil Rights Litigation Clearinghouse names an officer listed here, but the case is not listed because the Clearinghouse gives it no title.",
        evidence: [{ url: "https://clearinghouse.net/case/700" }],
        source_namespace: "net/clearinghouse/api",
        source_record_id: "700",
      },
      {
        code: "civil-case-not-buildable",
        type: "warning",
        field: "civil_cases",
        value: {
          name: "Roe v. Austin",
          filing_date: "unknown",
          filing_year: null,
        },
        message:
          "Civil case 800 (Roe v. Austin) in the Civil Rights Litigation Clearinghouse names an officer listed here, but the case is not listed because the Clearinghouse gives it no filing date.",
        evidence: [{ url: "https://clearinghouse.net/case/800" }],
        source_namespace: "net/clearinghouse/api",
        source_record_id: "800",
      },
      {
        code: "civil-case-not-buildable",
        type: "warning",
        field: "civil_cases",
        value: { name: null, filing_date: null, filing_year: null },
        message:
          "Civil case 900 in the Civil Rights Litigation Clearinghouse names an officer listed here, but the case is not listed because the Clearinghouse gives it no title and no filing date.",
        evidence: [{ file: "a1.cases.json", case: "900" }],
        source_namespace: "net/clearinghouse/api",
        source_record_id: "900",
      },
    ]);
    expect(manifest.accounting).toEqual([
      {
        input: "cases",
        read: 3,
        emitted: 0,
        reported: 3,
        notSelected: {
          "filed before the minimum year": 0,
          "no defendant names the agency": 0,
          "names no officer the database knows": 0,
          "agency name has no distinctive word": 0,
        },
      },
    ]);
  });

  it("reports a case left out of two agencies' files once on the authority and counts it at each file", async () => {
    const untitled = austinCase(700, { name: "", filing_date: "2023-08-01" });
    const { manifest, byKind } = await runFiles({
      "a1.cases.json": { agency: austin, cases: [untitled] },
      "a9.cases.json": {
        agency: { id: "a9", name: "Austin Fire Marshal", state: "TX" },
        cases: [untitled],
      },
    });
    expect(
      byKind.LicensingAuthorities.tx.metadata?.defects?.map(
        (f: { source_record_id: string }) => f.source_record_id,
      ),
    ).toEqual(["700"]);
    expect(manifest.accounting[0]).toMatchObject({ read: 2, reported: 2 });
  });

  it("counts, and does not report, a case with no title that names no officer the database knows", async () => {
    const { manifest, byKind } = await runFiles(
      {
        "a1.cases.json": {
          agency: austin,
          cases: [austinCase(700, { name: "", filing_date: "2023-08-01" })],
        },
      },
      fakeData({}),
    );
    expect(byKind.LicensingAuthorities.tx.metadata?.defects).toEqual([]);
    expect(manifest.accounting[0]).toMatchObject({
      read: 1,
      reported: 0,
      notSelected: { "names no officer the database knows": 1 },
    });
  });

  it("throws naming the setting and its value when CLEARINGHOUSE_MIN_YEAR is not a year", async () => {
    await expect(
      runWith(fakeData(), { CLEARINGHOUSE_MIN_YEAR: "abc" }),
    ).rejects.toThrow(
      'net/clearinghouse/api: CLEARINGHOUSE_MIN_YEAR is not a year: "abc".',
    );
    await expect(
      runWith(fakeData(), { CLEARINGHOUSE_MIN_YEAR: "" }),
    ).rejects.toThrow(
      'net/clearinghouse/api: CLEARINGHOUSE_MIN_YEAR is not a year: "".',
    );
  });

  it.each([
    ["ID", { name: "Austin Police Department", state: "TX" }],
    ["name", { id: "a1", state: "TX" }],
    ["state", { id: "a1", name: "Austin Police Department" }],
  ])("throws naming a file whose agency has no %s", async (_field, agency) => {
    await expect(
      runFiles({ "bad.cases.json": { agency, cases: [] } }),
    ).rejects.toThrow(/bad\.cases\.json has no agency ID, name or state\./);
  });

  it("throws naming a file that has no list of cases", async () => {
    await expect(
      runFiles({
        "bad.cases.json": { agency: austin } as unknown as Envelope,
      }),
    ).rejects.toThrow(/bad\.cases\.json has no list of cases\./);
  });

  it("throws naming a case that has no ID", async () => {
    await expect(
      runFiles({
        "a1.cases.json": {
          agency: austin,
          cases: [
            austinCase(100, {
              name: "Doe v. Austin",
              filing_date: "2023-05-01",
            }),
            { name: "No ID v. Austin", filing_date: "2023-05-01" },
          ],
        },
      }),
    ).rejects.toThrow(/a1\.cases\.json case 2 has no ID\./);
  });

  it("fails when an input folder cannot be read", async () => {
    await expect(
      transform({
        paths: [path.join(tmpdir(), "clearinghouse-no-such-folder")],
        readXlsx,
        state: tmpdir(),
        emit: async () => {},
        data: fakeData(),
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("emits one case for a case found in two agencies' files with the same content", async () => {
    const shared = austinCase(100, {
      name: "Doe v. Austin",
      filing_date: "2023-05-01",
    });
    const { manifest, byKind } = await runFiles({
      "a1.cases.json": { agency: austin, cases: [shared] },
      "a9.cases.json": {
        agency: { id: "a9", name: "Austin Fire Marshal", state: "TX" },
        cases: [shared],
      },
    });
    expect(Object.keys(byKind.CivilCases)).toEqual(["txwd:1:23-cv-100"]);
    expect(manifest.accounting[0]).toMatchObject({ read: 2, emitted: 2 });
  });

  it("throws naming the case and both files when a case is repeated with different content", async () => {
    await expect(
      runFiles({
        "a1.cases.json": {
          agency: austin,
          cases: [
            austinCase(100, {
              name: "Doe v. Austin",
              filing_date: "2023-05-01",
            }),
          ],
        },
        "a9.cases.json": {
          agency: { id: "a9", name: "Austin Fire Marshal", state: "TX" },
          cases: [
            austinCase(100, {
              name: "Doe v. Austin",
              filing_date: "2023-05-02",
            }),
          ],
        },
      }),
    ).rejects.toThrow(
      /net\/clearinghouse\/api: case txwd:1:23-cv-100 in .*a9\.cases\.json differs from the same case in .*a1\.cases\.json\./,
    );
  });

  it("counts every case of an agency whose name has no distinctive word, and names the agency in the log", async () => {
    const data = fakeData();
    const { manifest, byKind, logs } = await runFiles(
      {
        "a5.cases.json": {
          agency: {
            id: "a5",
            name: "Department of Public Safety",
            state: "TX",
          },
          cases: [
            {
              id: 100,
              name: "Doe v. DPS",
              filing_date: "2023-05-01",
              case_defendants: [
                { institution: "Department of Public Safety" },
                { name: "John Smith" },
              ],
            },
          ],
        },
      },
      data,
    );
    expect(byKind.CivilCases).toEqual({});
    expect(data.calls).toEqual([]);
    expect(manifest.accounting[0]).toMatchObject({
      read: 1,
      emitted: 0,
      reported: 0,
      notSelected: { "agency name has no distinctive word": 1 },
    });
    expect(
      logs.some(
        (line) =>
          line.includes("Department of Public Safety (a5)") &&
          line.includes("no distinctive word"),
      ),
    ).toBe(true);
  });
});
