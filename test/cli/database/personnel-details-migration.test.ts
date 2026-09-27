import { readFile, readdir } from "node:fs/promises";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import pg from "pg";
import { beforeAll, afterAll, test, expect } from "vitest";

const directory = new URL("../../../supabase/migrations/", import.meta.url);
const filename = "20260927000001_personnel_discipline_education.sql";
let container: StartedPostgreSqlContainer;
let db: pg.Client;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgis/postgis:15-3.4").start();
  db = new pg.Client({ connectionString: container.getConnectionUri() });
  await db.connect();
  await db.query("create extension if not exists postgis");
  for (const name of (await readdir(directory))
    .filter((n) => n.endsWith(".sql") && n < filename)
    .sort())
    await db.query(await readFile(new URL(name, directory), "utf8"));
  await db.query(`
    insert into location_path(location_path_id,path,level,display_name) values ('state','/zz/','state','Test');
    insert into agency(id,name,city,state,address,zip_code,slug,location_path_id,latitude,longitude)
      values ('agency','Agency','City','ZZ','1 Main','12345','agency','state',1,1);
    insert into personnel(id,first_name,slug) values ('person','Person','person'),('other','Other','other');
    insert into licensing_authority(id,name,location_path_id) values ('issuer','Issuer','state'),('other-issuer','Other','state');
    insert into authority_license(id,licensing_authority_id,name) values ('type','issuer','Officer'),('other-type','other-issuer','Officer');
    insert into license(id,personnel_id,authority_license_id) values ('license','person','type'),('other-license','other','other-type');
    insert into agency_personnel(id,agency_id,personnel_id,license_id,title,start_date) values ('assignment','agency','person','license','Officer','2020-01-01'),('other-assignment','agency','other','other-license','Officer','2020-01-01');
    insert into discipline(id,action) values ('old-action','Suspended');
    insert into discipline_agency_personnel(id,discipline_id,agency_personnel_id) values ('old-link','old-action','assignment');
  `);
}, 60000);
afterAll(async () => {
  await db?.end();
  await container?.stop();
});

async function migrate() {
  await db.query(await readFile(new URL(filename, directory), "utf8"));
}

test("backfills unique identities while preserving action and relationship IDs and enforces new contracts", async () => {
  await db.query("begin");
  try {
    await migrate();
    expect(
      (
        await db.query(
          "select id,personnel_id,licensing_authority_id,document_url from discipline",
        )
      ).rows,
    ).toEqual([
      {
        id: "old-action",
        personnel_id: "person",
        licensing_authority_id: "issuer",
        document_url: null,
      },
    ]);
    expect(
      (await db.query("select id from discipline_agency_personnel")).rows,
    ).toEqual([{ id: "old-link" }]);
    await db.query(
      "insert into personnel_education(id,personnel_id,name,credits) values ('education','person','Training',1.5)",
    );
    expect(
      (
        await db.query(
          "select completion_date,credits,sponsor_name,sponsor_instructor from personnel_education",
        )
      ).rows,
    ).toEqual([
      {
        completion_date: null,
        credits: "1.5",
        sponsor_name: null,
        sponsor_instructor: null,
      },
    ]);
    for (const sql of [
      "insert into discipline(id,action) values ('missing','Action')",
      "insert into discipline(id,action,personnel_id,licensing_authority_id) values ('bad','Action','unknown','issuer')",
      "insert into discipline(id,action,personnel_id,licensing_authority_id) values ('bad','Action','person','unknown')",
      "insert into discipline(id,action,personnel_id,licensing_authority_id,document_url) values ('bad','Action','person','issuer',' ')",
      "insert into personnel_education(id,personnel_id,name) values ('bad','unknown','Training')",
      "insert into personnel_education(id,personnel_id,name) values ('bad','person',' ')",
    ]) {
      await db.query("savepoint invalid");
      await expect(db.query(sql)).rejects.toThrow();
      await db.query("rollback to savepoint invalid");
    }
  } finally {
    await db.query("rollback");
  }
});

test.each(["ambiguous", "missing"])(
  "%s historical identity rolls back the migration",
  async (scenario) => {
    await db.query("begin");
    try {
      if (scenario === "ambiguous")
        await db.query(
          "insert into discipline_agency_personnel(id,discipline_id,agency_personnel_id) values ('conflict','old-action','other-assignment')",
        );
      else
        await db.query(
          "insert into discipline(id,action) values ('unlinked','Action')",
        );
      await expect(migrate()).rejects.toThrow(
        /discipline.*(identity|person|issuer)/i,
      );
    } finally {
      await db.query("rollback");
    }
    expect((await db.query("select id from discipline")).rows).toEqual([
      { id: "old-action" },
    ]);
    expect(
      (
        await db.query(
          "select column_name from information_schema.columns where table_name='discipline' and column_name='personnel_id'",
        )
      ).rows,
    ).toEqual([]);
  },
);
