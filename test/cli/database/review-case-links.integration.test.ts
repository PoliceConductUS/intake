import { afterAll, beforeAll, expect, test } from "vitest";
import { startIntakeDatabase, type IntakeDatabase } from "./intake-postgres.js";

let database: IntakeDatabase;
beforeAll(async () => {
  database = await startIntakeDatabase();
  await database.query(`
    insert into public.location_path(location_path_id,path,level,display_name)
      values ('case-link-location','/zz/','state','Test State');
    insert into public.reviews(id,title,slug,location_path_id,latitude,longitude)
      values ('case-link-report','Test report','case-link-report','case-link-location',1,1),
             ('case-link-other-report','Other report','case-link-other-report','case-link-location',1,1);
    insert into public.civil_cases(id,title,cause_number,filed_date,claims_summary,slug,location_path_id)
      values ('case-link-case','Test case','TEST-001','2020-01-01','Synthetic claims','case-link-case','case-link-location');
  `);
}, 180_000);
afterAll(async () => {
  await database?.stop();
});

test("a stored URL link changes to a case relationship without changing identity", async () => {
  await database.query(
    "insert into public.review_links(id,review_id,url,title) values ('case-link-existing','case-link-report','https://example.invalid/evidence','Evidence')",
  );
  await database.query(
    "update public.review_links set url = null, title = null, civil_case_id = 'case-link-case' where id = 'case-link-existing'",
  );
  expect(
    (
      await database.query(
        "select id, review_id, url, title, civil_case_id from public.review_links where id = 'case-link-existing'",
      )
    ).rows,
  ).toEqual([
    {
      id: "case-link-existing",
      review_id: "case-link-report",
      url: null,
      title: null,
      civil_case_id: "case-link-case",
    },
  ]);
  await database.query(
    "insert into public.review_links(id,review_id,civil_case_id) values ('case-link-other','case-link-other-report','case-link-case')",
  );
  await expect(
    database.query(
      "insert into public.review_links(id,review_id,civil_case_id) values ('case-link-duplicate','case-link-report','case-link-case')",
    ),
  ).rejects.toThrow(/unique/i);
});

test.each([
  ["no target", null, null, null, /check/i],
  ["URL only", "https://example.invalid/partial", null, null, /check/i],
  ["title only", null, "Partial", null, /check/i],
  [
    "mixed targets",
    "https://example.invalid/mixed",
    "Mixed",
    "case-link-case",
    /check/i,
  ],
  [
    "case with URL",
    "https://example.invalid/mixed",
    null,
    "case-link-case",
    /check/i,
  ],
  ["case with title", null, "Mixed", "case-link-case", /check/i],
  ["missing case", null, null, "case-link-missing", /foreign key/i],
])("rejects %s", async (_name, url, title, caseId, error) => {
  await expect(
    database.query(
      "insert into public.review_links(id,review_id,url,title,civil_case_id) values ('case-link-invalid','case-link-report',$1,$2,$3)",
      [url, title, caseId],
    ),
  ).rejects.toThrow(error);
});

test("URL links retain report-target uniqueness", async () => {
  await database.query(
    "insert into public.review_links(id,review_id,url,title) values ('case-link-url','case-link-report','https://example.invalid/retained','Retained evidence')",
  );
  await expect(
    database.query(
      "insert into public.review_links(id,review_id,url,title) values ('case-link-url-duplicate','case-link-report','https://example.invalid/retained','Duplicate evidence')",
    ),
  ).rejects.toThrow(/unique/i);
});
