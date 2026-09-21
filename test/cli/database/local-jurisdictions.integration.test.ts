import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultDatabaseClientFactory } from "../../../src/cli/database/index.js";
import { readLocationPathsContainingPoint } from "../../../src/cli/database/location-paths.js";
import { LocationPathDataContext } from "../../../src/cli/import/artifacts/location-resolution.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "./intake-postgres.js";

const withDocker = dockerAvailable() ? describe : describe.skip;
withDocker("Census local jurisdictions with real PostGIS", () => {
  let db: IntakeDatabase;
  beforeAll(async () => {
    db = await startIntakeDatabase();
    await db.query(
      "insert into public.location_path(location_path_id,path,level,display_name) values ('test-state','/zz/','state','Test')",
    );
    await db.query(
      "insert into public.location_path(location_path_id,path,level,display_name,parent_location_path_id) values ('test-county','/zz/county/','administrative_area','County','test-state')",
    );
    await db.query(`insert into public.location_path(location_path_id,path,level,display_name,parent_location_path_id,resolution_class) values
      ('test-primary','/zz/county/city/','place','City','test-county','primary'),
      ('test-township','/zz/county/township/','place','Township','test-county','county_subdivision'),
      ('test-consolidated','/zz/county/consolidated/','place','Consolidated','test-county','consolidated_city')`);
    await db.query(`insert into public.location_path_geometry(location_path_id,boundary) values
      ('test-primary',ST_Multi(ST_GeomFromText('POLYGON((0 0,2 0,2 4,0 4,0 0))',4326))),
      ('test-township',ST_Multi(ST_GeomFromText('POLYGON((2 0,4 0,4 4,2 4,2 0))',4326))),
      ('test-consolidated',ST_Multi(ST_GeomFromText('POLYGON((0 0,6 0,6 6,0 6,0 0))',4326)))`);
  }, 60000);
  afterAll(async () => {
    await db?.stop();
  });
  it("preserves existing row semantics with a primary class default", async () => {
    const { rows } = await db.query(
      "select resolution_class,location_path_id,path from public.location_path where location_path_id='test-state'",
    );
    expect(rows).toEqual([
      {
        resolution_class: "primary",
        location_path_id: "test-state",
        path: "/zz/",
      },
    ]);
    await expect(
      db.query(
        "update public.location_path set resolution_class='county_subdivision' where location_path_id='test-state'",
      ),
    ).rejects.toThrow(/location_path_supplemental_place_only/);
  });
  it("selects primary, uncovered township, and consolidated coverage in order, including a shared edge", async () => {
    const client = defaultDatabaseClientFactory(db.connectionString);
    await client.connect();
    try {
      const context = new LocationPathDataContext({
        databaseClient: () => client,
      } as never);
      for (const [longitude, expected] of [
        [1, "test-primary"],
        [2, "test-primary"],
        [3, "test-township"],
        [5, "test-consolidated"],
      ] as const) {
        await expect(
          context.getPlaceContainingPoint({
            latitude: 1,
            longitude,
            subject: "test address",
          }),
        ).resolves.toBe(expected);
      }
      const matches = await readLocationPathsContainingPoint(client, {
        latitude: 1,
        longitude: 3,
        level: "place",
      });
      expect(matches.map((r) => r.resolution_class).sort()).toEqual([
        "consolidated_city",
        "county_subdivision",
      ]);
      await expect(
        context.getPlaceContainingPoint({
          latitude: 20,
          longitude: 20,
          subject: "outside",
        }),
      ).rejects.toThrow(/no place/);
    } finally {
      await client.end();
    }
  });
});
