import { afterAll, beforeAll, expect, test } from "vitest";
import { startIntakeDatabase, type IntakeDatabase } from "./intake-postgres.js";

// Synthetic records for site_personnel_headline_assignment
// (20261122200000_site_personnel_headline_assignment.sql). Every date is far in
// the past or future, so results do not change with the clock.
let database: IntakeDatabase;
beforeAll(async () => {
  database = await startIntakeDatabase();
  await database.query(`
    insert into public.location_path(location_path_id,path,level,display_name,parent_location_path_id)
      values ('lp-zz','/zz/','state','Test State',null),
             ('lp-zz-area','/zz/test-county/','administrative_area','Test County','lp-zz'),
             ('lp-zz-place','/zz/test-county/test-city/','place','Test City','lp-zz-area');
    insert into public.agency(id,name,city,state,address,zip_code,latitude,longitude,slug,location_path_id)
      values ('agency-a','Agency A','Test City','ZZ','1 Test St','00001',1,1,'agency-a','lp-zz-place'),
             ('agency-b','Agency B','Test City','ZZ','2 Test St','00002',1,1,'agency-b','lp-zz-place');
    insert into public.personnel(id,first_name,slug)
      select 'p' || n, 'Person' || n, 'person-' || n from generate_series(1, 11) as n;
  `);
  // The comment above each person names the expected row and headline_basis.
  await database.query(`
    insert into public.agency_personnel(id,agency_id,personnel_id,title,badge_number,start_date,end_date,data_source_values)
    values
      -- p1 Current: the latest-started Current row, not the later Former row.
      ('ap1-former','agency-a','p1','Officer',null,'2021-01-01','2022-01-01','{}'),
      ('ap1-old','agency-a','p1','Officer','11','2015-01-01',null,'{}'),
      ('ap1-new','agency-b','p1','Sergeant','12','2018-01-01',null,'{}'),
      -- p2 Recorded: the Unknown row started last.
      ('ap2-former','agency-a','p2','Officer',null,'2010-01-01','2015-01-01','{}'),
      ('ap2-unknown','agency-b','p2','Detective',null,'2016-01-01','2999-01-01','{}'),
      -- p3 Recorded: the latest-started row is Former.
      ('ap3-unknown','agency-a','p3','Officer',null,'2010-01-01','2999-01-01','{}'),
      ('ap3-former','agency-b','p3','Officer',null,'2016-01-01','2017-01-01','{}'),
      -- p4 Most recent: the latest end date, not the latest start date.
      ('ap4-late-end','agency-a','p4','Officer',null,'2000-01-01','2015-01-01','{}'),
      ('ap4-late-start','agency-b','p4','Officer',null,'2010-01-01','2012-01-01','{}'),
      -- p5 Most recent: same end date, so the later start date.
      ('ap5-early','agency-a','p5','Officer',null,'2001-01-01','2015-01-01','{}'),
      ('ap5-late','agency-b','p5','Officer',null,'2005-01-01','2015-01-01','{}'),
      -- p6 Current: same start date, so the greater id.
      ('ap6-a','agency-a','p6','Officer',null,'2020-01-01',null,'{}'),
      ('ap6-b','agency-b','p6','Officer',null,'2020-01-01',null,'{}'),
      -- p7 Current: an absent start date sorts before 1960.
      ('ap7-1960','agency-a','p7','Officer',null,'1960-01-01',null,'{}'),
      ('ap7-none','agency-b','p7','Officer',null,null,null,'{}'),
      -- p8 has no assignment and no row.
      -- p9 Current: a source start date counts when the column is null.
      ('ap9-stored','agency-a','p9','Officer',null,'2020-01-01',null,'{}'),
      ('ap9-source','agency-b','p9','Officer',null,null,null,'{"start_date":{"effective_value":"2022-01-01"}}'),
      -- p10 Most recent: a source end date counts when the column is null.
      ('ap10-stored','agency-a','p10','Officer',null,'2000-01-01','2015-01-01','{}'),
      ('ap10-source','agency-b','p10','Officer',null,'2000-01-01',null,'{"end_date":{"effective_value":"2019-01-01"}}'),
      -- p11 Recorded: a source start date that is not a calendar date counts
      -- as absent and sorts first.
      ('ap11-bad','agency-a','p11','Officer',null,null,null,'{"start_date":{"effective_value":"2024-02-30"}}'),
      ('ap11-good','agency-b','p11','Officer',null,'2010-01-01','2011-01-01','{}');
  `);
}, 180_000);
afterAll(async () => {
  await database?.stop();
});

test("site_personnel_headline_assignment names one assignment per person by the headline rule", async () => {
  expect(
    (
      await database.query(`
        select personnel_id, agency_personnel_id, agency_id, title,
               badge_number, employment_status,
               to_char(end_date, 'YYYY-MM-DD') as end_date, headline_basis
        from public.site_personnel_headline_assignment
        order by personnel_id
      `)
    ).rows,
  ).toEqual([
    {
      personnel_id: "p1",
      agency_personnel_id: "ap1-new",
      agency_id: "agency-b",
      title: "Sergeant",
      badge_number: "12",
      employment_status: "Current",
      end_date: null,
      headline_basis: "Current",
    },
    {
      personnel_id: "p10",
      agency_personnel_id: "ap10-source",
      agency_id: "agency-b",
      title: "Officer",
      badge_number: null,
      employment_status: "Former",
      end_date: "2019-01-01",
      headline_basis: "Most recent",
    },
    {
      personnel_id: "p11",
      agency_personnel_id: "ap11-good",
      agency_id: "agency-b",
      title: "Officer",
      badge_number: null,
      employment_status: "Former",
      end_date: "2011-01-01",
      headline_basis: "Recorded",
    },
    {
      personnel_id: "p2",
      agency_personnel_id: "ap2-unknown",
      agency_id: "agency-b",
      title: "Detective",
      badge_number: null,
      employment_status: "Unknown",
      end_date: "2999-01-01",
      headline_basis: "Recorded",
    },
    {
      personnel_id: "p3",
      agency_personnel_id: "ap3-former",
      agency_id: "agency-b",
      title: "Officer",
      badge_number: null,
      employment_status: "Former",
      end_date: "2017-01-01",
      headline_basis: "Recorded",
    },
    {
      personnel_id: "p4",
      agency_personnel_id: "ap4-late-end",
      agency_id: "agency-a",
      title: "Officer",
      badge_number: null,
      employment_status: "Former",
      end_date: "2015-01-01",
      headline_basis: "Most recent",
    },
    {
      personnel_id: "p5",
      agency_personnel_id: "ap5-late",
      agency_id: "agency-b",
      title: "Officer",
      badge_number: null,
      employment_status: "Former",
      end_date: "2015-01-01",
      headline_basis: "Most recent",
    },
    {
      personnel_id: "p6",
      agency_personnel_id: "ap6-b",
      agency_id: "agency-b",
      title: "Officer",
      badge_number: null,
      employment_status: "Current",
      end_date: null,
      headline_basis: "Current",
    },
    {
      personnel_id: "p7",
      agency_personnel_id: "ap7-1960",
      agency_id: "agency-a",
      title: "Officer",
      badge_number: null,
      employment_status: "Current",
      end_date: null,
      headline_basis: "Current",
    },
    {
      personnel_id: "p9",
      agency_personnel_id: "ap9-source",
      agency_id: "agency-b",
      title: "Officer",
      badge_number: null,
      employment_status: "Current",
      end_date: null,
      headline_basis: "Current",
    },
  ]);
});
