import { afterAll, beforeAll, expect, test } from "vitest";
import { startIntakeDatabase, type IntakeDatabase } from "./intake-postgres.js";
import { recalculateDataAnnotations } from "../../../src/cli/database/recalculate-data-annotations.js";
let db: IntakeDatabase;
beforeAll(async () => {
  db = await startIntakeDatabase();
}, 180000);
afterAll(async () => {
  await db?.stop();
});
const source = {
  source_namespace: "test.provider",
  source_record_id: "authority",
};
const correction = {
  ...source,
  field: "name",
  value: "OLD",
  replacement_value: "Authority",
  type: "correction",
  message: "Applied a conditional correction.",
};
test("refreshes final values atomically and preserves corrections", async () => {
  await db.query(
    "insert into public.location_path (location_path_id,path,level,display_name) values ('test','/test/','state','Test')",
  );
  await db.query(
    "insert into public.licensing_authority (id,name,location_path_id,website,data_source_values,data_annotations) values ('authority','Authority','test','invalid',$1,$2)",
    [
      JSON.stringify({
        website: { ...source, value: "invalid", effective_value: "invalid" },
      }),
      JSON.stringify([correction]),
    ],
  );
  await recalculateDataAnnotations(db, new Date("2026-10-27"));
  const findings = (
    await db.query(
      "select data_annotations from public.licensing_authority where id='authority'",
    )
  ).rows[0].data_annotations;
  expect(findings).toEqual([
    correction,
    expect.objectContaining({
      type: "error",
      field: "website",
      value: "invalid",
      ...source,
    }),
  ]);
  await db.query(
    "update public.licensing_authority set website='https://example.org' where id='authority'",
  );
  await db.query("update public.federal_agency set name=name");
  // This later table fails inspection after the authority's findings were refreshed.
  await db.query(
    "insert into public.federal_agency (id,name,slug,data_source_values) values ('broken','Agency','broken',$1)",
    [JSON.stringify({ name: { value: "broken" } })],
  );
  await expect(
    recalculateDataAnnotations(db, new Date("2026-10-27")),
  ).rejects.toThrow();
  expect(
    (
      await db.query(
        "select data_annotations from public.licensing_authority where id='authority'",
      )
    ).rows[0].data_annotations,
  ).toEqual(findings);
  await db.query("delete from public.federal_agency where id='broken'");
  await recalculateDataAnnotations(db, new Date("2026-10-27"));
  expect(
    (
      await db.query(
        "select data_annotations from public.licensing_authority where id='authority'",
      )
    ).rows[0].data_annotations,
  ).toEqual([correction]);
});
