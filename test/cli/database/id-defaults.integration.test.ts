import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startIntakeDatabase, type IntakeDatabase } from "./intake-postgres.js";

describe("database-generated IDs (real Postgres)", () => {
  let db: IntakeDatabase;
  beforeAll(async () => {
    db = await startIntakeDatabase();
  }, 60000);
  afterAll(async () => {
    await db?.stop();
  });

  it("defines no value-generating default on any public column", async () => {
    const { rows } = await db.query(
      `select table_name || '.' || column_name as generated_column
         from information_schema.columns
        where table_schema = 'public'
          and (
            column_default ~* 'generate_cuid|gen_random_uuid|uuid_generate|nextval'
            or is_identity = 'YES'
          )
        order by 1`,
    );

    expect(rows.map((row) => row.generated_column)).toEqual([]);
  });

  it.each([
    "agency",
    "agency_personnel",
    "agency_phone_numbers",
    "personnel",
    "review_links",
    "review_personnel",
    "reviews",
  ])("rejects a %s row inserted without an id", async (table) => {
    await expect(
      db.query(`insert into public.${table} default values`),
    ).rejects.toMatchObject({ code: "23502", column: "id" });
  });
});
