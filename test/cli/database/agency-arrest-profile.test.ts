import { afterAll, beforeAll, expect, test } from "vitest";
import { startIntakeDatabase, type IntakeDatabase } from "./intake-postgres.js";
import { introspectSchema } from "../../../scripts/lib/schema-introspection.js";
import { ENTITY_TABLES } from "../../../scripts/lib/entity-spec-generator.js";
import {
  AgencyArrestProfileSpec,
  BUSINESS_KEYS,
  FK_REFERENCES,
} from "../../../src/shared/io/generated/entity-specs.js";
let db: IntakeDatabase;
beforeAll(async () => {
  db = await startIntakeDatabase();
}, 60000);
afterAll(async () => {
  await db?.stop();
});
test("agency aggregate requires explicit identity, unique agency, JSON summaries, and cascades", async () => {
  await db.query(`insert into location_path(location_path_id,path,level,display_name) values ('profile-place','/zz/profile/','place','Test');
    insert into agency(id,name,city,state,address,zip_code,slug,location_path_id,latitude,longitude) values ('profile-agency','Agency','City','ZZ','1 Main','12345','profile-agency','profile-place',1,1)`);
  await expect(
    db.query(
      "insert into agency_arrest_profile(agency_id) values ('profile-agency')",
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      "insert into agency_arrest_profile(id,agency_id) values ('missing-agency','missing')",
    ),
  ).rejects.toThrow();
  await db.query(
    "insert into agency_arrest_profile(id,agency_id) values ('profile','profile-agency')",
  );
  expect(
    (
      await db.query(
        "select id,agency_id,coverage,breakdowns,created_at is not null as created,updated_at is not null as updated from agency_arrest_profile",
      )
    ).rows,
  ).toEqual([
    {
      id: "profile",
      agency_id: "profile-agency",
      coverage: {},
      breakdowns: {},
      created: true,
      updated: true,
    },
  ]);
  await expect(
    db.query(
      "insert into agency_arrest_profile(id,agency_id) values ('duplicate','profile-agency')",
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      "update agency_arrest_profile set coverage=null where id='profile'",
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      "update agency_arrest_profile set breakdowns=null where id='profile'",
    ),
  ).rejects.toThrow();
  await db.query("delete from agency where id='profile-agency'");
  expect((await db.query("select id from agency_arrest_profile")).rows).toEqual(
    [],
  );
});

test("generated agency profile columns and identity match the migrated isolated database", async () => {
  const schema = await introspectSchema(db.connectionString, ENTITY_TABLES);
  const table = schema.tables.get("agency_arrest_profile")!;
  expect(
    table.columns
      .map((column) => column.name)
      .filter((name) => !["created_at", "updated_at"].includes(name))
      .sort(),
  ).toEqual(Object.keys(AgencyArrestProfileSpec.shape).sort());
  expect(table.primaryKeyColumn).toBe("id");
  expect(table.uniqueKeys).toEqual([BUSINESS_KEYS.AgencyArrestProfile]);
  expect(table.foreignKeys).toEqual([
    { column: "agency_id", targetTable: "agency" },
  ]);
  expect(FK_REFERENCES.AgencyArrestProfile).toEqual([
    { field: "agency_id", targetKind: "Agency" },
  ]);
});
