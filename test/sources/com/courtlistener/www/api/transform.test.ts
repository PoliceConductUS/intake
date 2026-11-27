import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { source } from "../../../../../../sources/com/courtlistener/www/api/intake.source.js";
import { transform } from "../../../../../../sources/com/courtlistener/www/api/transform.js";
import { readXlsx } from "../../../../../../src/cli/transform/read-xlsx.js";

const SOURCE = "com/courtlistener/www/api";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

type Docket = Record<string, unknown>;

function docket(id: number, overrides: Docket = {}): Docket {
  return {
    id: String(id),
    case_name: `Doe ${id} v. City`,
    docket_number: `3:23-cv-${id}`,
    court: "txnd",
    date_filed: "2023-04-01",
    date_terminated: null,
    cause: "42:1983 Civil Rights Act",
    absolute_url: `/docket/${id}/doe-v-city/`,
    parties: ["City of Irving", "John Smith"],
    ...overrides,
  };
}

const irving = { id: "a1", name: "Irving Police Department", state: "TX" };

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

async function run(
  files: Record<string, unknown>,
  data = fakeData(),
  paths?: (dir: string) => string[],
) {
  const dir = await mkdtemp(path.join(tmpdir(), "courtlistener-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(
      path.join(dir, name),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  const lines: string[] = [];
  const manifest = await transform({
    paths: paths?.(dir) ?? [dir],
    readXlsx,
    state: dir,
    emit: async () => {},
    data,
    logger: { info: (line) => lines.push(line) },
  });
  return {
    dir,
    lines,
    manifest,
    byKind: Object.fromEntries(
      manifest.artifacts.map((a) => [a.kind, a.records]),
    ),
  };
}

describe("com/courtlistener/www/api transform", () => {
  it("resolves the person party to an officer source id and emits the case", async () => {
    const data = fakeData();
    const { byKind } = await run(
      {
        "a1.dockets.json": {
          agency: irving,
          dockets: [docket(123, { date_terminated: "2023-11-20" })],
        },
      },
      data,
    );

    const caseId = "txnd:3:23-cv-123";
    expect(byKind.CivilCases).toEqual({
      [caseId]: {
        spec: {
          id: caseId,
          title: "Doe 123 v. City",
          cause_number: "3:23-cv-123",
          court: "txnd",
          filed_date: "2023-04-01",
          claims_summary: "42:1983 Civil Rights Act",
          slug: "doe-123-v-city-txnd-3-23-cv-123",
          outcome: null,
          primary_source_url:
            "https://www.courtlistener.com/docket/123/doe-v-city/",
          date_terminated: "2023-11-20",
          location_path_id: "tx",
        },
      },
    });
    expect(data.calls).toEqual([
      { agencyId: "a1", personnelName: "John Smith" },
    ]);
    expect(byKind.CivilCasePersonnel).toEqual({
      [`${caseId}|ao-1`]: {
        spec: { civil_case_id: caseId, agency_personnel_id: "ao-1" },
      },
    });
    expect(byKind.CivilCaseLinks).toEqual({
      [`${caseId}|courtlistener`]: {
        spec: {
          civil_case_id: caseId,
          url: "https://www.courtlistener.com/docket/123/doe-v-city/",
          title: "CourtListener docket",
        },
      },
    });
  });

  it("does not supply the complaint summary fields, even when a dockets file carries them", async () => {
    const { byKind } = await run({
      "a1.dockets.json": {
        agency: irving,
        dockets: [
          docket(123, {
            ai_complaint_summary: {
              summary: "A summary made during an old acquire.",
              source: { sourcePage: "https://www.courtlistener.com/x/" },
            },
            complaint_summary_unavailability: null,
          }),
        ],
      },
    });

    const spec = byKind.CivilCases["txnd:3:23-cv-123"].spec as object;
    expect(spec).not.toHaveProperty("ai_complaint_summary");
    expect(spec).not.toHaveProperty("complaint_summary_unavailability");
  });

  it("produces LicensingAuthorities", () => {
    expect(source.produces).toEqual([
      "CivilCases",
      "CivilCasePersonnel",
      "CivilCaseLinks",
      "LicensingAuthorities",
    ]);
  });

  it("leaves out a docket with no matching officer, logs the docket, its URL and the reason, and counts it", async () => {
    const { byKind, lines, manifest } = await run({
      "a1.dockets.json": {
        agency: irving,
        dockets: [
          docket(123),
          docket(124, { parties: ["City of Irving", "Jane Roe"] }),
          docket(125, { parties: [] }),
        ],
      },
    });

    expect(Object.keys(byKind.CivilCases)).toEqual(["txnd:3:23-cv-123"]);
    expect(lines).toContain(
      `${SOURCE}: docket 124 (https://www.courtlistener.com/docket/124/doe-v-city/) left out: no matching officer.`,
    );
    expect(lines).toContain(
      `${SOURCE}: docket 125 (https://www.courtlistener.com/docket/125/doe-v-city/) left out: no matching officer.`,
    );
    expect(manifest.accounting).toEqual([
      {
        input: "dockets",
        read: 3,
        emitted: 1,
        reported: 0,
        notSelected: { "no matching officer": 2 },
      },
    ]);
    expect(lines.at(-1)).toBe(
      `${SOURCE}: 1 cases written, 1 case-personnel links, 1 source links; dockets left out: 2 with no matching officer, 0 that cannot build a case.`,
    );
  });

  it("reports two dockets of one state that name an officer but lack a title or a filing date on that state's licensing authority, and writes no case for them", async () => {
    const { byKind, lines, manifest } = await run({
      "a1.dockets.json": {
        agency: irving,
        dockets: [
          docket(123),
          docket(201, { date_filed: null }),
          docket(202, { case_name: "  " }),
          docket(203, { case_name: "", date_filed: "April 2023" }),
          docket(204, { date_filed: null, parties: ["Jane Roe"] }),
        ],
      },
    });

    expect(Object.keys(byKind.CivilCases)).toEqual(["txnd:3:23-cv-123"]);
    expect(Object.keys(byKind.CivilCasePersonnel)).toEqual([
      "txnd:3:23-cv-123|ao-1",
    ]);
    const finding = (
      id: number,
      missing: string,
      value: Record<string, unknown>,
    ) => ({
      code: "docket-not-buildable",
      type: "warning",
      field: "civil_cases",
      value,
      message: `A court case naming an officer of Irving Police Department is not shown on this site because CourtListener, a free website of court records, lists it without ${missing}. You can see the case here: https://www.courtlistener.com/docket/${id}/doe-v-city/`,
      evidence: [
        { url: `https://www.courtlistener.com/docket/${id}/doe-v-city/` },
      ],
      source_namespace: SOURCE,
      source_record_id: String(id),
    });
    expect(byKind.LicensingAuthorities).toEqual({
      tx: {
        metadata: {
          action: "PATCH",
          selector: { location_path: { path: "/tx/" } },
          defects: [
            finding(201, "a filing date", {
              case_name: "Doe 201 v. City",
              date_filed: null,
            }),
            finding(202, "a title", {
              case_name: "  ",
              date_filed: "2023-04-01",
            }),
            finding(203, "a title and a filing date", {
              case_name: "",
              date_filed: "April 2023",
            }),
          ],
        },
        spec: {},
      },
    });
    expect(lines).toContain(
      `${SOURCE}: docket 201 (https://www.courtlistener.com/docket/201/doe-v-city/) left out: names an officer but has no filing date; reported on the licensing authority of TX.`,
    );
    expect(manifest.accounting).toEqual([
      {
        input: "dockets",
        read: 5,
        emitted: 1,
        reported: 3,
        notSelected: { "no matching officer": 1 },
      },
    ]);
  });

  it("emits the licensing authority of every state processed with an empty list when no docket is left out, so an earlier annotation is resolved", async () => {
    const { byKind } = await run({
      "a1.dockets.json": { agency: irving, dockets: [docket(123)] },
      "m1.dockets.json": {
        agency: { id: "m1", name: "Edina Police Department", state: "mn" },
        dockets: [],
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

  it("states zero rows when there is no dockets file", async () => {
    const { manifest } = await run({});
    expect(manifest.accounting).toEqual([
      {
        input: "dockets",
        read: 0,
        emitted: 0,
        reported: 0,
        notSelected: { "no matching officer": 0 },
      },
    ]);
  });

  it("throws on an input path that cannot be read", async () => {
    await expect(
      run({}, fakeData(), (dir) => [path.join(dir, "absent")]),
    ).rejects.toThrow(
      /^com\/courtlistener\/www\/api: cannot read input path .*\/absent: ENOENT/,
    );
  });

  it("throws on a dockets file that cannot be read as JSON", async () => {
    await expect(run({ "a1.dockets.json": "{ not json" })).rejects.toThrow(
      /^com\/courtlistener\/www\/api: cannot read .*\/a1\.dockets\.json: /,
    );
  });

  it("throws on a dockets file that is a directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "courtlistener-"));
    tempDirs.push(dir);
    await mkdir(path.join(dir, "a1.dockets.json"));
    await expect(
      transform({
        paths: [dir],
        readXlsx,
        state: dir,
        emit: async () => {},
        data: fakeData(),
      }),
    ).rejects.toThrow(
      /^com\/courtlistener\/www\/api: cannot read .*\/a1\.dockets\.json: EISDIR/,
    );
  });

  it.each([
    ["ID", { name: "Irving Police Department", state: "TX" }],
    ["name", { id: "a1", name: " ", state: "TX" }],
    ["state", { id: "a1", name: "Irving Police Department" }],
  ])("throws on a file whose agency has no %s", async (_missing, agency) => {
    await expect(
      run({ "a1.dockets.json": { agency, dockets: [docket(123)] } }),
    ).rejects.toThrow(
      /^com\/courtlistener\/www\/api: .*\/a1\.dockets\.json has no agency ID, name or state\.$/,
    );
  });

  it("throws on a file with no agency and on a file with no list of dockets", async () => {
    await expect(run({ "a1.dockets.json": { dockets: [] } })).rejects.toThrow(
      /a1\.dockets\.json has no agency ID, name or state\.$/,
    );
    await expect(
      run({ "a1.dockets.json": { agency: irving } }),
    ).rejects.toThrow(/a1\.dockets\.json has no list of dockets\.$/);
  });

  it.each([
    ["no ID", { id: " " }, /a1\.dockets\.json docket 1 has no ID\.$/],
    [
      "no address",
      { absolute_url: "" },
      /a1\.dockets\.json docket 123 has no address\.$/,
    ],
    [
      "no court",
      { court: "" },
      /a1\.dockets\.json docket 123 names an officer but has no court or no docket number\.$/,
    ],
    [
      "no docket number",
      { docket_number: " " },
      /a1\.dockets\.json docket 123 names an officer but has no court or no docket number\.$/,
    ],
    [
      "a termination date that is not a date",
      { date_terminated: "pending" },
      /a1\.dockets\.json docket 123 has a termination date that is not a date: "pending"\.$/,
    ],
  ])("throws on a docket with %s", async (_problem, overrides, message) => {
    await expect(
      run({
        "a1.dockets.json": {
          agency: irving,
          dockets: [docket(123, overrides)],
        },
      }),
    ).rejects.toThrow(message);
  });

  it("uses the case title as the claims summary when the docket has no cause", async () => {
    const { byKind } = await run({
      "a1.dockets.json": {
        agency: irving,
        dockets: [docket(123, { cause: "" })],
      },
    });
    expect(byKind.CivilCases["txnd:3:23-cv-123"].spec).toMatchObject({
      claims_summary: "Doe 123 v. City",
    });
  });

  it("says so when a later docket replaces a different record of the same case", async () => {
    const { byKind, lines, manifest } = await run({
      "a1.dockets.json": { agency: irving, dockets: [docket(123)] },
      "d1.dockets.json": {
        agency: { id: "d1", name: "Federal Protective Service", state: "DC" },
        dockets: [docket(123)],
      },
    });

    expect(Object.keys(byKind.CivilCases)).toEqual(["txnd:3:23-cv-123"]);
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^com\/courtlistener\/www\/api: case txnd:3:23-cv-123 from docket 123 in .*\/(a1|d1)\.dockets\.json replaces a different record of the same case from docket 123 in .*\/(a1|d1)\.dockets\.json\.$/,
      ),
    );
    expect(manifest.accounting[0]).toMatchObject({ read: 2, emitted: 2 });
  });
});
