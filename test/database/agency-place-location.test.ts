import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

const migrationPath =
  "supabase/migrations/20260929190000_enforce_agency_place_location.sql";
let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgis/postgis:15-3.4").start();
}, 180000);
afterAll(async () => {
  await container?.stop();
});
const run = test;

run(
  "database rejects non-place agency references and referenced place reclassification",
  async () => {
    const client = new pg.Client({
      connectionString: container.getConnectionUri(),
    });
    await client.connect();
    try {
      await client.query("begin");
      await client.query(`
      create temporary table location_path (location_path_id text primary key, level text not null);
      create temporary table agency (id text primary key, location_path_id text not null references location_path(location_path_id));
      insert into location_path values ('place-id','place'), ('county-id','administrative_area'), ('state-id','state');
    `);
      const migration = (await readFile(migrationPath, "utf8")).replaceAll(
        "public.",
        "pg_temp.",
      );
      await client.query(migration);
      await client.query(
        "insert into agency (id,location_path_id) values ('agency-id','place-id')",
      );
      await client.query("savepoint generated_value");
      await expect(
        client.query(
          "update agency set location_path_level='administrative_area' where id='agency-id'",
        ),
      ).rejects.toMatchObject({ code: "428C9" });
      await client.query("rollback to savepoint generated_value");
      expect(
        (await client.query("select location_path_level from agency")).rows,
      ).toEqual([{ location_path_level: "place" }]);
      for (const sql of [
        "insert into agency (id,location_path_id) values ('bad-agency','county-id')",
        "insert into agency (id,location_path_id) values ('bad-agency','state-id')",
        "update agency set location_path_id='county-id' where id='agency-id'",
        "update agency set location_path_id='state-id' where id='agency-id'",
        "update location_path set level='administrative_area' where location_path_id='place-id'",
        "update location_path set level='state' where location_path_id='place-id'",
      ]) {
        await client.query("savepoint invalid_write");
        await expect(client.query(sql)).rejects.toMatchObject({
          code: "23503",
        });
        await client.query("rollback to savepoint invalid_write");
      }
      expect(
        (await client.query("select location_path_id from agency")).rows,
      ).toEqual([{ location_path_id: "place-id" }]);
    } finally {
      await client.query("rollback");
      await client.end();
    }
  },
);

run("migration refuses an existing non-place agency reference", async () => {
  const client = new pg.Client({
    connectionString: container.getConnectionUri(),
  });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(`
      create temporary table location_path (location_path_id text primary key, level text not null);
      create temporary table agency (id text primary key, location_path_id text not null references location_path(location_path_id));
      insert into location_path values ('county-id','administrative_area');
      insert into agency values ('agency-id','county-id');
    `);
    const migration = (await readFile(migrationPath, "utf8")).replaceAll(
      "public.",
      "pg_temp.",
    );
    await expect(client.query(migration)).rejects.toMatchObject({
      code: "23503",
    });
  } finally {
    await client.query("rollback");
    await client.end();
  }
});
