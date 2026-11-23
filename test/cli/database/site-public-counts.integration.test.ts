import { afterAll, beforeAll, expect, test } from "vitest";
import { startIntakeDatabase, type IntakeDatabase } from "./intake-postgres.js";

// Synthetic records for the site_* count views
// (20261122000000_site_public_counts.sql and
// 20261122100000_site_agency_personnel_counts.sql). Every date is far in the past or
// future, or computed from the database's UTC date, so results do not change
// with the clock.
let database: IntakeDatabase;
beforeAll(async () => {
  database = await startIntakeDatabase();
  await database.query(`
    insert into public.location_path(location_path_id,path,level,display_name,parent_location_path_id)
      values ('lp-zz','/zz/','state','Test State',null),
             ('lp-zz-area','/zz/test-county/','administrative_area','Test County','lp-zz'),
             ('lp-zz-place','/zz/test-county/test-city/','place','Test City','lp-zz-area'),
             ('lp-yy','/yy/','state','Other State',null),
             ('lp-yy-area','/yy/other-county/','administrative_area','Other County','lp-yy'),
             ('lp-yy-place','/yy/other-county/other-city/','place','Other City','lp-yy-area');
    insert into public.federal_agency(id,name,slug)
      values ('fed','Test Federal Agency','test-federal-agency'),
             ('fed-empty','Empty Federal Agency','empty-federal-agency');
    insert into public.agency(id,name,city,state,address,zip_code,latitude,longitude,slug,location_path_id,parent_federal_agency_id)
      values ('agency-a','Agency A','Test City','ZZ','1 Test St','00001',1,1,'agency-a','lp-zz-place',null),
             ('agency-b','Agency B','Other City','YY','2 Test St','00002',1,1,'agency-b','lp-yy-place','fed'),
             ('agency-c','Agency C','Other City','YY','3 Test St','00003',1,1,'agency-c','lp-yy-place','fed'),
             ('agency-d','Agency D','Test City','ZZ','5 Test St','00005',1,1,'agency-d','lp-zz-place',null),
             ('agency-empty','Agency Empty','Test City','ZZ','4 Test St','00004',1,1,'agency-empty','lp-zz-place',null);
    insert into public.build_page_payload(path,page_type,entity_id,payload,content_hash)
      values ('/zz/test-county/test-city/agency-a/','agency','agency-a','{}','hash-a'),
             ('/yy/other-county/other-city/agency-b/','agency','agency-b','{}','hash-b');
    insert into public.personnel(id,first_name,slug)
      select 'p' || n, 'Person' || n, 'person-' || n from generate_series(1, 12) as n;
  `);
  // One agency-a row per employment rule. The comment names the expected
  // employment_status.
  await database.query(`
    insert into public.agency_personnel(id,agency_id,personnel_id,title,start_date,end_date,data_source_values)
    values
      -- Current: no end date, past start date.
      ('ap1','agency-a','p1','Officer','2020-01-01',null,'{}'),
      -- Current: no dates and no source values.
      ('ap2','agency-a','p2','Officer',null,null,'{}'),
      -- Former: past end date.
      ('ap3','agency-a','p3','Officer','2010-01-01','2015-01-01','{}'),
      -- Unknown: end date today (UTC).
      ('ap4','agency-a','p4','Officer','2010-01-01',(current_timestamp at time zone 'UTC')::date,'{}'),
      -- Unknown: future end date.
      ('ap5','agency-a','p5','Officer','2010-01-01','2999-01-01','{}'),
      -- Unknown: source end date that is not a date.
      ('ap6','agency-a','p6','Officer','2010-01-01',null,'{"end_date":{"effective_value":"unreadable"}}'),
      -- Current: explicit null source end date.
      ('ap7','agency-a','p7','Officer','2010-01-01',null,'{"end_date":{"effective_value":null}}'),
      -- Unknown: end date before start date.
      ('ap8','agency-a','p8','Officer','2024-01-01','2023-01-01','{}'),
      -- Unknown: future start date.
      ('ap9','agency-a','p9','Officer','2999-01-01',null,'{}'),
      -- Unknown: source start date that is not a calendar date.
      ('ap10','agency-a','p10','Officer',null,null,'{"start_date":{"effective_value":"2024-02-30"}}'),
      -- Current: valid past source start date with no stored start date.
      ('ap11','agency-a','p11','Officer',null,null,'{"start_date":{"effective_value":"2020-01-01"}}'),
      -- Former: valid past source end date with no stored end date.
      ('ap12','agency-a','p12','Officer','2010-01-01',null,'{"end_date":{"effective_value":"2015-01-01"}}'),
      -- Current: a second current row for p1 at agency-a.
      ('ap13','agency-a','p1','Sergeant','2019-01-01',null,'{}'),
      -- Federal branch rows.
      ('ap-b1','agency-b','p1','Agent','2021-01-01',null,'{}'),
      ('ap-b2','agency-b','p2','Agent','2021-01-01',null,'{}'),
      ('ap-c1','agency-c','p1','Agent','2022-01-01',null,'{}'),
      ('ap-c3','agency-c','p3','Agent','2010-01-01','2015-01-01','{}'),
      -- agency-d: people with rows of more than one status. The comment
      -- names the person's status at agency-d.
      -- p3 Unknown: a Former row and an Unknown row.
      ('ap-d1','agency-d','p3','Officer','2010-01-01','2015-01-01','{}'),
      ('ap-d2','agency-d','p3','Officer','2016-01-01','2999-01-01','{}'),
      -- p4 Current: a Former row and a Current row.
      ('ap-d3','agency-d','p4','Officer','2010-01-01','2015-01-01','{}'),
      ('ap-d4','agency-d','p4','Officer','2016-01-01',null,'{}'),
      -- p5 Current: a Current row and an Unknown row.
      ('ap-d5','agency-d','p5','Officer','2016-01-01',null,'{}'),
      ('ap-d6','agency-d','p5','Officer','2999-01-01',null,'{}'),
      -- p6 Former: two Former rows.
      ('ap-d7','agency-d','p6','Officer','2000-01-01','2005-01-01','{}'),
      ('ap-d8','agency-d','p6','Officer','2006-01-01','2009-01-01','{}');
    insert into public.civil_cases(id,title,cause_number,filed_date,claims_summary,slug,location_path_id,date_terminated)
      values ('case-open','Open case','TEST-OPEN','2020-01-01','Synthetic claims','case-open','lp-zz-place',null),
             ('case-closed','Closed case','TEST-CLOSED','2020-01-01','Synthetic claims','case-closed','lp-zz-place','2021-01-01');
    insert into public.civil_case_personnel(id,civil_case_id,agency_personnel_id)
      values ('ccp1','case-open','ap1'),
             ('ccp2','case-open','ap13'),
             ('ccp3','case-closed','ap-b1');
  `);
}, 180_000);
afterAll(async () => {
  await database?.stop();
});

test("site_agency_personnel_employment classifies each assignment", async () => {
  const rows = (
    await database.query(
      "select agency_personnel_id, employment_status from public.site_agency_personnel_employment where agency_id = 'agency-a'",
    )
  ).rows;
  expect(
    Object.fromEntries(
      rows.map((row) => [row.agency_personnel_id, row.employment_status]),
    ),
  ).toEqual({
    ap1: "Current",
    ap2: "Current",
    ap3: "Former",
    ap4: "Unknown",
    ap5: "Unknown",
    ap6: "Unknown",
    ap7: "Current",
    ap8: "Unknown",
    ap9: "Unknown",
    ap10: "Unknown",
    ap11: "Current",
    ap12: "Former",
    ap13: "Current",
  });
});

test("site_agency_count counts assignments by status and distinct personnel by their status at the agency", async () => {
  // A person's status at an agency is the first of Current, Unknown, Former
  // that any of the person's rows there has.
  expect(
    (
      await database.query(
        "select * from public.site_agency_count where agency_id in ('agency-a','agency-d','agency-empty') order by agency_id",
      )
    ).rows,
  ).toEqual([
    {
      agency_id: "agency-a",
      assignment_count: 13,
      current_assignment_count: 5,
      former_assignment_count: 2,
      unknown_assignment_count: 6,
      current_personnel_count: 4,
      personnel_count: 12,
      former_personnel_count: 2,
      unknown_personnel_count: 6,
    },
    {
      agency_id: "agency-d",
      assignment_count: 8,
      current_assignment_count: 2,
      former_assignment_count: 4,
      unknown_assignment_count: 2,
      current_personnel_count: 2,
      personnel_count: 4,
      former_personnel_count: 1,
      unknown_personnel_count: 1,
    },
    {
      agency_id: "agency-empty",
      assignment_count: 0,
      current_assignment_count: 0,
      former_assignment_count: 0,
      unknown_assignment_count: 0,
      current_personnel_count: 0,
      personnel_count: 0,
      former_personnel_count: 0,
      unknown_personnel_count: 0,
    },
  ]);
});

test("site_federal_agency_count counts each current person once across branches", async () => {
  expect(
    (
      await database.query(
        "select * from public.site_federal_agency_count order by federal_agency_id",
      )
    ).rows,
  ).toEqual([
    { federal_agency_id: "fed", current_personnel_count: 2 },
    { federal_agency_id: "fed-empty", current_personnel_count: 0 },
  ]);
});

test("site_personnel_state_count counts each person once under the state of the latest-started current assignment's agency page", async () => {
  // p1's latest-started current row is at agency-c, which has no page, so p1
  // is not counted. p2's is at agency-b (state /yy/). p7 and p11 are current
  // only at agency-a (state /zz/).
  expect(
    (
      await database.query(
        "select * from public.site_personnel_state_count order by state_path",
      )
    ).rows,
  ).toEqual([
    {
      state_location_path_id: "lp-yy",
      state_path: "/yy/",
      listed_personnel_count: 1,
    },
    {
      state_location_path_id: "lp-zz",
      state_path: "/zz/",
      listed_personnel_count: 2,
    },
  ]);
});

test("site_personnel_count counts distinct civil cases across all of a person's assignments", async () => {
  expect(
    (
      await database.query(
        "select * from public.site_personnel_count where personnel_id in ('p1','p2') order by personnel_id",
      )
    ).rows,
  ).toEqual([
    { personnel_id: "p1", civil_case_count: 2, open_civil_case_count: 1 },
    { personnel_id: "p2", civil_case_count: 0, open_civil_case_count: 0 },
  ]);
});
