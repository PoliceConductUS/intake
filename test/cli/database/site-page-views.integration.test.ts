import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startIntakeDatabase, type IntakeDatabase } from "./intake-postgres.js";

// Synthetic records for the site page views (20261123000000_site_page_schema,
// 20261123100000_site_location_views, 20261123200000_site_page_views). Every
// date is far in the past or future, so results do not change with the clock.
//
// /zz/ state ZZ
//   /zz/test-county/
//     /zz/test-county/alpha/   agency-a (p1, p2 Current), agency-b (p2 Current)
//     /zz/test-county/beta/    agency-c (p3 Current, federal branch of fa1)
//   /zz/other-county/
//     /zz/other-county/gamma/  agency-d (p1 Former only: no page)
// /yy/ state YY (no agency page)
//   /yy/odd-place/             agency-f (p5 Current, federal branch of fa1;
//                              its place has no area parent: no page)
let database: IntakeDatabase;

beforeAll(async () => {
  database = await startIntakeDatabase();
  await database.query(`
    insert into public.location_path(location_path_id,path,level,display_name,parent_location_path_id,segment,state_code,centroid,bbox)
    values
      ('lp-zz','/zz/','state','Zed State',null,'zz','ZZ','SRID=4326;POINT(-97 31)','SRID=4326;POLYGON((-100 30,-95 30,-95 33,-100 33,-100 30))'),
      ('lp-test','/zz/test-county/','administrative_area','Test County','lp-zz','test-county',null,null,null),
      ('lp-alpha','/zz/test-county/alpha/','place','Alpha','lp-test','alpha',null,null,null),
      ('lp-beta','/zz/test-county/beta/','place','Beta','lp-test','beta',null,null,null),
      ('lp-other','/zz/other-county/','administrative_area','Other County','lp-zz','other-county',null,null,null),
      ('lp-gamma','/zz/other-county/gamma/','place','Gamma','lp-other','gamma',null,null,null),
      ('lp-yy','/yy/','state','Why State',null,'yy','YY',null,null),
      ('lp-odd','/yy/odd-place/','place','Odd Place','lp-yy','odd-place',null,null,null);
    insert into public.federal_agency(id,name,slug) values ('fa1','Federal One','federal-one');
    insert into public.agency(id,name,city,state,address,zip_code,latitude,longitude,slug,location_path_id,parent_federal_agency_id)
    values
      ('agency-a','Agency A','Alpha','ZZ','1 A St','00001',31.1,-97.1,'agency-a','lp-alpha',null),
      ('agency-b','Agency B','Alpha','ZZ','2 B St','00002',31.2,-97.2,'agency-b','lp-alpha',null),
      ('agency-c','Agency C','Beta','ZZ','3 C St','00003',31.3,-97.3,'agency-c','lp-beta','fa1'),
      ('agency-d','Agency D','Gamma','ZZ','4 D St','00004',31.4,-97.4,'agency-d','lp-gamma',null),
      ('agency-f','Agency F','Odd','YY','6 F St','00006',31.6,-97.6,'agency-f','lp-odd','fa1');
    insert into public.personnel(id,first_name,last_name,slug,deceased_on,deceased_source,deceased_message)
    values
      ('p1','Pat','One','pat-one',null,null,null),
      ('p2','Sam','Two','sam-two',null,null,null),
      ('p3','Lee','Three','lee-three','2020-02-01','news','Reported deceased.'),
      ('p5','Kim','Five','kim-five',null,null,null);
    insert into public.agency_personnel(id,agency_id,personnel_id,title,start_date,end_date)
    values
      ('ap-a1','agency-a','p1','Officer','2015-01-01',null),
      ('ap-d1','agency-d','p1','Officer','2005-01-01','2010-01-01'),
      ('ap-a2','agency-a','p2','Officer','2016-01-01',null),
      ('ap-b2','agency-b','p2','Sergeant','2018-01-01',null),
      ('ap-c3','agency-c','p3','Agent','2010-01-01','2019-06-30'),
      ('ap-c3b','agency-c','p3','Agent','2012-01-01',null),
      ('ap-f5','agency-f','p5','Agent','2012-01-01',null);
    insert into public.reviews(id,title,slug,location_path_id,incident_date,address)
    values ('r1','Traffic stop','traffic-stop','lp-alpha','2025-03-04T15:00:00Z','1 Main St');
    insert into public.review_personnel(id,review_id,agency_personnel_id)
    values ('rp1','r1','ap-a1');
    insert into public.civil_cases(id,title,cause_number,filed_date,claims_summary,slug,location_path_id)
    values
      ('cc1','Doe v. Gamma','1:01','2009-01-01','Claims.','doe-v-gamma','lp-zz'),
      ('cc2','Roe v. Federal','1:02','2013-01-01','Claims.','roe-v-federal','lp-yy');
    insert into public.civil_case_personnel(id,civil_case_id,agency_personnel_id)
    values ('ccp1','cc1','ap-d1'), ('ccp2','cc2','ap-c3b'), ('ccp3','cc2','ap-f5');
    insert into public.licensing_authority(id,name,location_path_id)
    values ('la1','Zed Licensing Board','lp-zz');
    insert into public.authority_license(id,licensing_authority_id,name)
    values ('al1','la1','Peace Officer');
    insert into public.license(id,personnel_id,authority_license_id,status)
    values ('l1','p1','al1','Active');
    insert into public.license_action(id,license_id,action,action_date)
    values ('lact1','l1','Suspended','2011-01-01');
    insert into public.discipline(id,action,personnel_id,licensing_authority_id)
    values ('d1','Reprimand','p1','la1');
    insert into public.data_annotation_type(type,label)
    values ('warning','Warning'), ('error','Data error'), ('correction','Correction');
    insert into public.data_annotation(id,subject_kind,subject_id,producer_namespace,producer_record_id,source_namespace,source_record_id,type,field,value,message,status,personnel_id,agency_id,licensing_authority_id,links,display_value)
    values
      ('ann-link','CivilCasePersonnel','ccp1','intake','n1','provider','s1','warning','end_date','"2999-01-01"','Check the end date.','active','p1',null,null,
       '[{"url":"/personnel/pat-one/#agency-assignments","label":"Pat One"},{"url":"/zz/other-county/gamma/agency-d/","label":"Agency D"},{"url":"/civil-cases/doe-v-gamma/","label":"Doe v. Gamma"}]','2999-01-01'),
      ('ann-agency','Agency','agency-d','intake','n2','provider','s2','error','zip_code','"0"','Check the ZIP code.','active',null,'agency-d',null,
       '[{"url":"/zz/other-county/gamma/agency-d/","label":"Agency D"}]',null),
      ('ann-authority','LicensingAuthority','la1','intake','n3','provider','s3','warning','website','null','No website.','active',null,null,'la1',
       '[{"url":"/zz/licensing-authority/","label":"Zed Licensing Board"}]',null),
      ('ann-resolved','Agency','agency-a','intake','n4','provider','s4','warning','name','"A"','Old.','resolved',null,'agency-a',null,
       '[{"url":"/zz/test-county/alpha/agency-a/","label":"Agency A"}]',null);
  `);
  await database.query("select public.refresh_site_projections()");
}, 180_000);

afterAll(async () => {
  await database?.stop();
});

async function rows(sql: string): Promise<Record<string, unknown>[]> {
  return (await database.query(sql)).rows;
}

describe("location pages", () => {
  test("only locations that contain an agency page have a row, with counts of distinct people", async () => {
    expect(
      await rows(`
        select path, level, segment, parent_path, state_path, state_code,
               area_path, agency_count, current_personnel_count,
               report_count, civil_case_count, child_count,
               only_child_path, only_child_name, only_child_level
        from public.site_location_page order by path
      `),
    ).toEqual([
      {
        path: "/zz/",
        level: "state",
        segment: "zz",
        parent_path: null,
        state_path: "/zz/",
        state_code: "ZZ",
        area_path: null,
        agency_count: 3,
        current_personnel_count: 3,
        report_count: 1,
        civil_case_count: 2,
        child_count: 1,
        only_child_path: null,
        only_child_name: null,
        only_child_level: null,
      },
      {
        path: "/zz/test-county/",
        level: "administrative_area",
        segment: "test-county",
        parent_path: "/zz/",
        state_path: "/zz/",
        state_code: "ZZ",
        area_path: "/zz/test-county/",
        agency_count: 3,
        current_personnel_count: 3,
        report_count: 1,
        civil_case_count: 1,
        child_count: 2,
        only_child_path: null,
        only_child_name: null,
        only_child_level: null,
      },
      {
        path: "/zz/test-county/alpha/",
        level: "place",
        segment: "alpha",
        parent_path: "/zz/test-county/",
        state_path: "/zz/",
        state_code: "ZZ",
        area_path: "/zz/test-county/",
        agency_count: 2,
        current_personnel_count: 2,
        report_count: 1,
        civil_case_count: 0,
        child_count: 2,
        only_child_path: null,
        only_child_name: null,
        only_child_level: null,
      },
      {
        path: "/zz/test-county/beta/",
        level: "place",
        segment: "beta",
        parent_path: "/zz/test-county/",
        state_path: "/zz/",
        state_code: "ZZ",
        area_path: "/zz/test-county/",
        agency_count: 1,
        current_personnel_count: 1,
        report_count: 0,
        civil_case_count: 1,
        child_count: 1,
        only_child_path: "/zz/test-county/beta/agency-c/",
        only_child_name: "Agency C",
        only_child_level: "agency",
      },
    ]);
  });

  test("map point and bounds come from the stored centroid and bbox", async () => {
    expect(
      await rows(`
        select path, map_latitude, map_longitude, map_min_latitude, map_max_longitude
        from public.site_location_page where path in ('/zz/', '/zz/test-county/alpha/')
        order by path
      `),
    ).toEqual([
      {
        path: "/zz/",
        map_latitude: 31,
        map_longitude: -97,
        map_min_latitude: 30,
        map_max_longitude: -95,
      },
      {
        path: "/zz/test-county/alpha/",
        map_latitude: null,
        map_longitude: null,
        map_min_latitude: null,
        map_max_longitude: null,
      },
    ]);
  });

  test("site_location_state reads the stored state_code through the parent chain", async () => {
    expect(
      await rows(`
        select location_path_id, state_path, state_code
        from public.site_location_state
        where location_path_id in ('lp-gamma', 'lp-odd') order by 1
      `),
    ).toEqual([
      { location_path_id: "lp-gamma", state_path: "/zz/", state_code: "ZZ" },
      { location_path_id: "lp-odd", state_path: "/yy/", state_code: "YY" },
    ]);
  });

  test("the state map has a row only for a state with agency pages", async () => {
    expect(await rows("select * from public.site_state_map")).toEqual([
      {
        state_code: "ZZ",
        path: "/zz/",
        display_name: "Zed State",
        agency_count: 3,
        listed_personnel_count: 3,
      },
    ]);
    expect(
      await rows(
        "select count(*)::int as count from public.site_personnel_listing",
      ),
    ).toEqual([{ count: 3 }]);
  });
});

describe("agency pages", () => {
  test("an agency page needs a Current person and a place under an area under a state", async () => {
    expect(
      await rows(`
        select path, slug, place_segment, area_segment, state_segment, state_code,
               personnel_count, current_personnel_count, report_count,
               civil_case_count, federal_agency_path
        from public.site_agency_page order by path
      `),
    ).toEqual([
      {
        path: "/zz/test-county/alpha/agency-a/",
        slug: "agency-a",
        place_segment: "alpha",
        area_segment: "test-county",
        state_segment: "zz",
        state_code: "ZZ",
        personnel_count: 2,
        current_personnel_count: 2,
        report_count: 1,
        civil_case_count: 0,
        federal_agency_path: null,
      },
      {
        path: "/zz/test-county/alpha/agency-b/",
        slug: "agency-b",
        place_segment: "alpha",
        area_segment: "test-county",
        state_segment: "zz",
        state_code: "ZZ",
        personnel_count: 1,
        current_personnel_count: 1,
        report_count: 0,
        civil_case_count: 0,
        federal_agency_path: null,
      },
      {
        path: "/zz/test-county/beta/agency-c/",
        slug: "agency-c",
        place_segment: "beta",
        area_segment: "test-county",
        state_segment: "zz",
        state_code: "ZZ",
        personnel_count: 1,
        current_personnel_count: 1,
        report_count: 0,
        civil_case_count: 1,
        federal_agency_path: "/federal/federal-one/",
      },
    ]);
  });

  test("a case from a person's other job is not listed under the agency", async () => {
    expect(
      await rows(`
        select scope_path, scope_level, civil_case_id
        from public.site_civil_case_scope order by scope_path, civil_case_id
      `),
    ).toEqual([
      {
        scope_path: "/federal/federal-one/",
        scope_level: "federal_agency",
        civil_case_id: "cc2",
      },
      {
        scope_path: "/personnel/kim-five/",
        scope_level: "personnel",
        civil_case_id: "cc2",
      },
      {
        scope_path: "/personnel/lee-three/",
        scope_level: "personnel",
        civil_case_id: "cc2",
      },
      {
        scope_path: "/personnel/pat-one/",
        scope_level: "personnel",
        civil_case_id: "cc1",
      },
      { scope_path: "/zz/", scope_level: "state", civil_case_id: "cc1" },
      { scope_path: "/zz/", scope_level: "state", civil_case_id: "cc2" },
      {
        scope_path: "/zz/test-county/",
        scope_level: "administrative_area",
        civil_case_id: "cc2",
      },
      {
        scope_path: "/zz/test-county/beta/",
        scope_level: "place",
        civil_case_id: "cc2",
      },
      {
        scope_path: "/zz/test-county/beta/agency-c/",
        scope_level: "agency",
        civil_case_id: "cc2",
      },
    ]);
  });

  test("the roster lists every assignment, with a null agency path for an agency without a page", async () => {
    expect(
      await rows(`
        select agency_personnel_id, personnel_path, agency_path, employment_status
        from public.site_assignment where personnel_id = 'p1' order by 1
      `),
    ).toEqual([
      {
        agency_personnel_id: "ap-a1",
        personnel_path: "/personnel/pat-one/",
        agency_path: "/zz/test-county/alpha/agency-a/",
        employment_status: "Current",
      },
      {
        agency_personnel_id: "ap-d1",
        personnel_path: "/personnel/pat-one/",
        agency_path: null,
        employment_status: "Former",
      },
    ]);
  });
});

describe("personnel pages", () => {
  test("one row holds the headline assignment, worksFor, counts, title and description", async () => {
    expect(
      await rows(`
        select path, full_name, headline_agency_name, headline_agency_path,
               headline_basis, works_for_agency_name, state_code,
               agency_count, report_count, civil_case_count, discipline_count,
               page_title, page_description
        from public.site_personnel_page where personnel_id in ('p1', 'p3')
        order by path
      `),
    ).toEqual([
      {
        path: "/personnel/lee-three/",
        full_name: "Lee Three",
        headline_agency_name: "Agency C",
        headline_agency_path: "/zz/test-county/beta/agency-c/",
        headline_basis: "Current",
        works_for_agency_name: "Agency C",
        state_code: "ZZ",
        agency_count: 1,
        report_count: 0,
        civil_case_count: 1,
        discipline_count: 0,
        page_title:
          "Deceased: Personnel Lee Three | Agency C | PoliceConduct.org",
        page_description:
          "Lee Three personnel profile with agency assignments, public reports, and civil litigation records; reported deceased on Feb 1, 2020.",
      },
      {
        path: "/personnel/pat-one/",
        full_name: "Pat One",
        headline_agency_name: "Agency A",
        headline_agency_path: "/zz/test-county/alpha/agency-a/",
        headline_basis: "Current",
        works_for_agency_name: "Agency A",
        state_code: "ZZ",
        agency_count: 2,
        report_count: 1,
        civil_case_count: 1,
        discipline_count: 1,
        page_title: "Personnel Pat One | Agency A | PoliceConduct.org",
        page_description:
          "Pat One personnel profile with current agency Agency A, agency assignments, public reports, coverage, and civil litigation records.",
      },
    ]);
  });

  test("topic pages exist only where the count is above zero", async () => {
    expect(
      await rows(
        "select path, scope_kind, record_count from public.site_topic_page order by path",
      ),
    ).toEqual([
      {
        path: "/personnel/kim-five/civil-cases/",
        scope_kind: "personnel",
        record_count: 1,
      },
      {
        path: "/personnel/lee-three/civil-cases/",
        scope_kind: "personnel",
        record_count: 1,
      },
      {
        path: "/personnel/pat-one/civil-cases/",
        scope_kind: "personnel",
        record_count: 1,
      },
      {
        path: "/personnel/pat-one/reports/",
        scope_kind: "personnel",
        record_count: 1,
      },
      { path: "/zz/civil-cases/", scope_kind: "state", record_count: 2 },
      { path: "/zz/reports/", scope_kind: "state", record_count: 1 },
      {
        path: "/zz/test-county/alpha/agency-a/personnel/",
        scope_kind: "agency",
        record_count: 2,
      },
      {
        path: "/zz/test-county/alpha/agency-a/reports/",
        scope_kind: "agency",
        record_count: 1,
      },
      {
        path: "/zz/test-county/alpha/agency-b/personnel/",
        scope_kind: "agency",
        record_count: 1,
      },
      {
        path: "/zz/test-county/alpha/reports/",
        scope_kind: "place",
        record_count: 1,
      },
      {
        path: "/zz/test-county/beta/agency-c/civil-cases/",
        scope_kind: "agency",
        record_count: 1,
      },
      {
        path: "/zz/test-county/beta/agency-c/personnel/",
        scope_kind: "agency",
        record_count: 1,
      },
      {
        path: "/zz/test-county/beta/civil-cases/",
        scope_kind: "place",
        record_count: 1,
      },
      {
        path: "/zz/test-county/civil-cases/",
        scope_kind: "administrative_area",
        record_count: 1,
      },
      {
        path: "/zz/test-county/reports/",
        scope_kind: "administrative_area",
        record_count: 1,
      },
    ]);
  });
});

describe("report pages and archives", () => {
  test("the report path comes from the stored location path, the UTC date and the slug", async () => {
    expect(
      await rows(
        "select path, year, month, day, place_segment, area_segment, state_code from public.site_report_page",
      ),
    ).toEqual([
      {
        path: "/zz/test-county/alpha/reports/2025/03/04/traffic-stop/",
        year: "2025",
        month: "03",
        day: "04",
        place_segment: "alpha",
        area_segment: "test-county",
        state_code: "ZZ",
      },
    ]);
  });

  test("a place report is in its state, area and place archives for its year, month and day", async () => {
    expect(
      (
        await rows(
          "select path from public.site_report_archive_page order by path",
        )
      ).map((row) => row.path),
    ).toEqual([
      "/zz/reports/2025/",
      "/zz/reports/2025/03/",
      "/zz/reports/2025/03/04/",
      "/zz/test-county/alpha/reports/2025/",
      "/zz/test-county/alpha/reports/2025/03/",
      "/zz/test-county/alpha/reports/2025/03/04/",
      "/zz/test-county/reports/2025/",
      "/zz/test-county/reports/2025/03/",
      "/zz/test-county/reports/2025/03/04/",
    ]);
  });
});

describe("federal and licensing authority pages", () => {
  test("a branch without an agency page has a null agency path and each case counts once", async () => {
    expect(
      await rows(
        "select agency_id, agency_path, civil_case_count from public.site_federal_branch order by 1",
      ),
    ).toEqual([
      {
        agency_id: "agency-c",
        agency_path: "/zz/test-county/beta/agency-c/",
        civil_case_count: 1,
      },
      { agency_id: "agency-f", agency_path: null, civil_case_count: 1 },
    ]);
    expect(
      await rows(
        "select path, branch_count, current_personnel_count, civil_case_count from public.site_federal_agency_page",
      ),
    ).toEqual([
      {
        path: "/federal/federal-one/",
        branch_count: 2,
        current_personnel_count: 2,
        civil_case_count: 1,
      },
    ]);
  });

  test("the licensing authority page and its counts", async () => {
    expect(
      await rows(
        "select path, state_code, license_count, license_action_count, discipline_count, annotation_count from public.site_licensing_authority_page",
      ),
    ).toEqual([
      {
        path: "/zz/licensing-authority/",
        state_code: "ZZ",
        license_count: 1,
        license_action_count: 1,
        discipline_count: 1,
        annotation_count: 1,
      },
    ]);
    expect(
      await rows(
        "select row_kind, type_name, status, record_count from public.site_licensing_authority_count order by row_kind",
      ),
    ).toEqual([
      {
        row_kind: "license",
        type_name: "Peace Officer",
        status: "Active",
        record_count: 1,
      },
      {
        row_kind: "license_action",
        type_name: "Suspended",
        status: null,
        record_count: 1,
      },
    ]);
  });
});

describe("annotations", () => {
  test("each active annotation has its page, type label, message and links", async () => {
    expect(
      await rows(`
        select data_annotation_id, page_path, page_type, type_label, message,
               links, display_value
        from public.site_annotation order by data_annotation_id
      `),
    ).toEqual([
      {
        data_annotation_id: "ann-agency",
        page_path: null,
        page_type: "agency",
        type_label: "Data error",
        message: "Check the ZIP code.",
        links: [{ url: null, label: "Agency D" }],
        display_value: null,
      },
      {
        data_annotation_id: "ann-authority",
        page_path: "/zz/licensing-authority/",
        page_type: "licensing_authority",
        type_label: "Warning",
        message: "No website.",
        links: [
          { url: "/zz/licensing-authority/", label: "Zed Licensing Board" },
        ],
        display_value: null,
      },
      {
        data_annotation_id: "ann-link",
        page_path: "/personnel/pat-one/",
        page_type: "personnel",
        type_label: "Warning",
        message: "Check the end date.",
        links: [
          { url: "/personnel/pat-one/#agency-assignments", label: "Pat One" },
          { url: null, label: "Agency D" },
          { url: "/civil-cases/doe-v-gamma/", label: "Doe v. Gamma" },
        ],
        display_value: "2999-01-01",
      },
    ]);
  });

  test("the database rejects links that are not a list of url and label", async () => {
    await expect(
      database.query(
        `update public.data_annotation set links = '[{"url":"/x/","label":"X","id":"a"}]' where id = 'ann-agency'`,
      ),
    ).rejects.toThrow(/data_annotation_links_check/);
    await expect(
      database.query(
        `update public.data_annotation set links = '[{"url":"https://example.com/","label":"X"}]' where id = 'ann-agency'`,
      ),
    ).rejects.toThrow(/data_annotation_links_check/);
    await expect(
      database.query(
        `update public.data_annotation set agency_id = 'agency-a', personnel_id = 'p1' where id = 'ann-agency'`,
      ),
    ).rejects.toThrow(/data_annotation_one_attachment/);
  });
});

describe("site_page and the refresh checks", () => {
  test("every page of the page views has one site_page row", async () => {
    expect(
      await rows(`
        select page_type, count(*)::int as count from public.site_page
        group by page_type order by page_type
      `),
    ).toEqual([
      { page_type: "agency", count: 3 },
      { page_type: "civil_case", count: 2 },
      { page_type: "federal_agency", count: 1 },
      { page_type: "licensing_authority", count: 1 },
      { page_type: "location", count: 4 },
      { page_type: "personnel", count: 4 },
      { page_type: "report", count: 1 },
      { page_type: "report_archive", count: 9 },
      { page_type: "topic", count: 15 },
    ]);
  });

  test("each page names the record it is about", async () => {
    expect(
      await rows(`
        select path, page_type, entity_kind, entity_id from public.site_page
        where path in (
          '/zz/test-county/alpha/agency-a/',
          '/zz/test-county/alpha/agency-a/reports/',
          '/zz/reports/2025/',
          '/personnel/pat-one/reports/'
        )
        order by path
      `),
    ).toEqual([
      {
        path: "/personnel/pat-one/reports/",
        page_type: "topic",
        entity_kind: "Personnel",
        entity_id: "p1",
      },
      {
        path: "/zz/reports/2025/",
        page_type: "report_archive",
        entity_kind: "LocationPath",
        entity_id: "lp-zz",
      },
      {
        path: "/zz/test-county/alpha/agency-a/",
        page_type: "agency",
        entity_kind: "Agency",
        entity_id: "agency-a",
      },
      {
        path: "/zz/test-county/alpha/agency-a/reports/",
        page_type: "topic",
        entity_kind: "Agency",
        entity_id: "agency-a",
      },
    ]);
  });

  test("one personnel page lookup by path uses the path index", async () => {
    await database.query("set enable_seqscan = off");
    const plan = (
      await rows(
        "explain select * from public.site_personnel_page where path = '/personnel/pat-one/'",
      )
    )
      .map((row) => String(row["QUERY PLAN"]))
      .join("\n");
    await database.query("reset enable_seqscan");
    expect(plan).toMatch(/site_personnel_page_path_idx/);
  });

  test("a segment that does not match the path fails the refresh and names the row", async () => {
    await database.query("begin");
    try {
      await database.query(
        "update public.location_path set segment = 'alpha-city' where location_path_id = 'lp-alpha'",
      );
      await expect(
        database.query("select public.refresh_site_projections()"),
      ).rejects.toThrow(/\/zz\/test-county\/alpha\//);
    } finally {
      await database.query("rollback");
    }
  });

  test("two pages claiming one path fail the refresh and name the path", async () => {
    await database.query("begin");
    try {
      // A place page whose path equals Agency A's reports topic page.
      await database.query(`
        insert into public.location_path(location_path_id,path,level,display_name,parent_location_path_id,segment)
        values ('lp-dup','/zz/test-county/alpha/agency-a/reports/','place','Dup','lp-test','reports');
      `);
      await database.query(
        "update public.agency set location_path_id = 'lp-dup' where id = 'agency-b'",
      );
      await expect(
        database.query("select public.refresh_site_projections()"),
      ).rejects.toThrow(/\/zz\/test-county\/alpha\/agency-a\/reports\//);
    } finally {
      await database.query("rollback");
    }
  });

  test("an active annotation without links or an attachment fails the refresh", async () => {
    await database.query("begin");
    try {
      await database.query(
        "update public.data_annotation set links = null where id = 'ann-agency'",
      );
      await expect(
        database.query("select public.refresh_site_projections()"),
      ).rejects.toThrow(/ann-agency/);
    } finally {
      await database.query("rollback");
    }
  });
});
