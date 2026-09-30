import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readExistingAgencyGraph } from "../../../src/cli/database/agency-graph.js";
import {
  defaultDatabaseClientFactory,
  type DatabaseClient,
} from "../../../src/cli/database/index.js";
import {
  selectAgencyGraph,
  type AgencyGraphRecord,
} from "../../../src/cli/import/artifacts/agency-graph.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "./intake-postgres.js";

const withDocker = dockerAvailable() ? describe : describe.skip;
withDocker("agency graph context in real Postgres", () => {
  let db: IntakeDatabase;
  let client: DatabaseClient;
  beforeAll(async () => {
    db = await startIntakeDatabase();
    client = defaultDatabaseClientFactory(db.connectionString);
    await client.connect();
    await db.query(`insert into public.location_path(location_path_id,path,level,display_name)
      values ('graph-state','/zz/','place','Test')`);
    await db.query(`insert into public.agency(id,name,city,state,address,zip_code,slug,location_path_id,latitude,longitude) values
      ('agency-a','Agency A','City','ZZ','1 Main St','12345','agency-a','graph-state',1,1),
      ('agency-b','Agency B','City','ZZ','2 Main St','12345','agency-b','graph-state',1,1),
      ('agency-c','Agency C','City','ZZ','4 Main St','12345','agency-c','graph-state',1,1),
      ('agency-unrelated','Unrelated','City','ZZ','3 Main St','12345','agency-unrelated','graph-state',1,1)`);
    await db.query(`insert into public.personnel(id,first_name,slug) values
      ('person-open','Open','person-open'), ('person-ended','Ended','person-ended'),
      ('person-b','Other','person-b'), ('person-unrelated','Unrelated','person-unrelated')`);
    await db.query(`insert into public.agency_personnel(id,agency_id,personnel_id,start_date,end_date,title) values
      ('assignment-open','agency-a','person-open','2020-01-01',null,'Officer'),
      ('assignment-ended','agency-a','person-ended','2020-01-01','2021-01-01','Officer'),
      ('assignment-b','agency-b','person-b','2020-01-01','2021-01-01','Officer'),
      ('assignment-c','agency-c','person-b','2022-01-01','2023-01-01','Officer'),
      ('assignment-unrelated','agency-unrelated','person-unrelated','2020-01-01',null,'Officer')`);
    await db.query(`insert into public.civil_cases(id,title,cause_number,filed_date,claims_summary,slug,location_path_id)
      values ('case-a','Case A','case-a','2020-01-01','Claims','case-a','graph-state'),
      ('case-c','Case C','case-c','2020-01-01','Claims','case-c','graph-state')`);
    await db.query(`insert into public.civil_case_personnel(id,civil_case_id,agency_personnel_id)
      values ('case-assignment','case-a','assignment-ended'),
      ('case-assignment-c','case-c','assignment-c')`);
    await db.query(`insert into public.reviews(id,title,slug,location_path_id,latitude,longitude)
      values ('review-a','Report A','review-a','graph-state',1,1)`);
    await db.query(`insert into public.review_personnel(id,review_id,agency_personnel_id)
      values ('review-assignment','review-a','assignment-ended')`);
  }, 60000);
  afterAll(async () => {
    await client?.end();
    await db?.stop();
  });

  it("connects later case and report evidence to persisted assignment roots", async () => {
    const incoming: AgencyGraphRecord[] = [
      {
        kind: "CivilCaseLink",
        id: "new-case-evidence",
        values: { civil_case_id: "case-a" },
      },
      {
        kind: "ReviewLink",
        id: "new-report-evidence",
        values: { review_id: "review-a" },
      },
    ];
    const existing = await readExistingAgencyGraph(client, incoming);
    expect(existing.map(({ kind, id }) => `${kind}:${id}`).sort()).toEqual([
      "Agency:agency-a",
      "AgencyPersonnel:assignment-ended",
      "AgencyPersonnel:assignment-open",
      "CivilCase:case-a",
      "CivilCasePersonnel:case-assignment",
      "Review:review-a",
      "ReviewPersonnel:review-assignment",
    ]);
    expect(selectAgencyGraph(existing, incoming)).toEqual(
      new Set([
        "Agency:agency-a",
        "AgencyPersonnel:assignment-ended",
        "AgencyPersonnel:assignment-open",
        "CivilCase:case-a",
        "CivilCasePersonnel:case-assignment",
        "Review:review-a",
        "ReviewPersonnel:review-assignment",
        "CivilCaseLink:new-case-evidence",
        "ReviewLink:new-report-evidence",
      ]),
    );
  });

  it("inherits omitted current fields but closes the last open assignment with incoming end_date", async () => {
    const incoming = [
      {
        kind: "AgencyPersonnel",
        id: "assignment-unrelated",
        values: { end_date: "2026-01-01" },
      },
    ];
    const existing = await readExistingAgencyGraph(client, incoming);
    expect(
      existing.find((record) => record.id === "assignment-unrelated")?.values,
    ).toMatchObject({ agency_id: "agency-unrelated", end_date: null });
    expect(selectAgencyGraph(existing, incoming)).toEqual(
      new Set([
        "Agency:agency-unrelated",
        "AgencyPersonnel:assignment-unrelated",
      ]),
    );
  });

  it("preserves an explicit null that reopens a stored ended assignment", async () => {
    const incoming = [
      {
        kind: "AgencyPersonnel",
        id: "assignment-b",
        values: { end_date: null },
      },
    ];
    const existing = await readExistingAgencyGraph(client, incoming);
    expect(selectAgencyGraph(existing, incoming)).toEqual(
      new Set(["Agency:agency-b", "AgencyPersonnel:assignment-b"]),
    );
  });

  it("loads both ancestor snapshots when an incoming parent reference changes", async () => {
    const incoming = [
      {
        kind: "ReviewPersonnel",
        id: "review-assignment",
        values: { agency_personnel_id: "assignment-b" },
      },
    ];
    const existing = await readExistingAgencyGraph(client, incoming);
    expect(existing.map((record) => record.id).sort()).toEqual([
      "agency-a",
      "agency-b",
      "assignment-b",
      "assignment-ended",
      "assignment-open",
      "case-a",
      "case-assignment",
      "review-assignment",
    ]);
    expect(selectAgencyGraph(existing, incoming)).toContain(
      "ReviewPersonnel:review-assignment",
    );
  });

  it("limits every query to candidate or ancestor IDs and never loads independent reference tables", async () => {
    const queries: { text: string; values: readonly unknown[] | undefined }[] =
      [];
    const observedClient: DatabaseClient = {
      ...client,
      query: async (text, values) => {
        queries.push({ text, values });
        return client.query(text, values);
      },
    };
    const existing = await readExistingAgencyGraph(observedClient, [
      {
        kind: "ReviewLink",
        id: "new-report-evidence",
        values: { review_id: "review-a" },
      },
      { kind: "LocationPath", id: "graph-state", values: {} },
    ]);
    expect(existing.map((record) => record.id)).not.toContain(
      "agency-unrelated",
    );
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query.text).toMatch(/\bwhere\b/i);
      expect(query.text).not.toMatch(
        /select\s+\*|public\.(personnel|license|licensing_authority|location_path)\b/i,
      );
      expect(query.values?.length).toBeGreaterThan(0);
    }
    expect(new Set(queries.map((query) => JSON.stringify(query))).size).toBe(
      queries.length,
    );
    const witnessRead = queries.find((query) =>
      /end_date is null/i.test(query.text),
    );
    expect(witnessRead?.values?.[0]).toEqual(["agency-a"]);
  });

  it("combines disjoint incoming fields for aliases of one canonical assignment", async () => {
    const incoming = [
      {
        kind: "AgencyPersonnel",
        id: "assignment-open",
        values: { agency_id: "agency-b" },
      },
      {
        kind: "AgencyPersonnel",
        id: "assignment-open",
        values: { end_date: null },
      },
    ];
    const existing = await readExistingAgencyGraph(client, incoming);
    expect(existing.map((record) => record.id)).toEqual(
      expect.arrayContaining(["agency-a", "agency-b", "assignment-open"]),
    );
    const selected = selectAgencyGraph(existing, incoming);
    expect(selected).toContain("Agency:agency-b");
    expect(selected).toContain("AgencyPersonnel:assignment-open");
  });

  it("loads persisted case witnesses for a candidate agency with only ended assignments", async () => {
    const incoming = [{ kind: "Agency", id: "agency-c", values: {} }];
    const existing = await readExistingAgencyGraph(client, incoming);
    expect(existing.map((record) => record.id).sort()).toEqual([
      "agency-c",
      "assignment-c",
      "case-assignment-c",
      "case-c",
    ]);
  });

  it("finds case witnesses when incoming assignment fields move the agency", async () => {
    const incoming = [
      {
        kind: "AgencyPersonnel",
        id: "assignment-c",
        values: { agency_id: "agency-b" },
      },
    ];
    const existing = await readExistingAgencyGraph(client, incoming);
    expect(existing.map((record) => record.id).sort()).toEqual([
      "agency-b",
      "agency-c",
      "assignment-c",
      "case-assignment-c",
      "case-c",
    ]);
  });

  it("uses incoming case-link fields to replace the stored case and assignment edges", async () => {
    const incoming = [
      { kind: "Agency", id: "agency-c", values: {} },
      {
        kind: "CivilCasePersonnel",
        id: "case-assignment-c",
        values: {
          agency_personnel_id: "assignment-b",
          civil_case_id: "case-a",
        },
      },
    ];
    const existing = await readExistingAgencyGraph(client, incoming);
    expect(existing.map((record) => record.id).sort()).toEqual([
      "agency-b",
      "agency-c",
      "assignment-b",
      "assignment-c",
      "case-a",
      "case-assignment-c",
      "case-c",
    ]);
  });

  it("keeps the former agency root when its last open assignment moves", async () => {
    const incoming = [
      {
        kind: "AgencyPersonnel",
        id: "assignment-unrelated",
        values: { agency_id: "agency-b" },
      },
      {
        kind: "AgencyPhoneNumber",
        id: "old-agency-link",
        values: { agency_id: "agency-unrelated" },
      },
      {
        kind: "AgencyPhoneNumber",
        id: "new-agency-link",
        values: { agency_id: "agency-b" },
      },
    ];
    const existing = await readExistingAgencyGraph(client, incoming);
    const selected = selectAgencyGraph(existing, incoming);
    expect(selected).toContain("AgencyPhoneNumber:old-agency-link");
    expect(selected).toContain("AgencyPhoneNumber:new-agency-link");
  });

  it("keeps a former case root when the incoming link changes case and assignment", async () => {
    const incoming = [
      {
        kind: "CivilCasePersonnel",
        id: "case-assignment-c",
        values: {
          agency_personnel_id: "assignment-b",
          civil_case_id: "case-a",
        },
      },
      {
        kind: "AgencyPhoneNumber",
        id: "former-case-agency-link",
        values: { agency_id: "agency-c" },
      },
      {
        kind: "AgencyPhoneNumber",
        id: "current-case-agency-link",
        values: { agency_id: "agency-b" },
      },
    ];
    const existing = await readExistingAgencyGraph(client, incoming);
    const selected = selectAgencyGraph(existing, incoming);
    expect(selected).toContain("AgencyPhoneNumber:former-case-agency-link");
    expect(selected).toContain("AgencyPhoneNumber:current-case-agency-link");
  });
});
