import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defaultDatabaseClientFactory,
  rowsFromResult,
} from "../../../src/cli/database/index.js";
import {
  dockerAvailable,
  startIntakeDatabase,
  type IntakeDatabase,
} from "./intake-postgres.js";

const describeWithDocker = dockerAvailable() ? describe : describe.skip;

// The double behind the first spurious agency update: with the server's default
// 15-digit float output it read back as 46.5180121602224 and diffed as changed.
const COORDINATE = 46.518012160222426;

describeWithDocker("database client float8 precision (real Postgres)", () => {
  let db: IntakeDatabase;
  beforeAll(async () => {
    db = await startIntakeDatabase();
  });
  afterAll(async () => {
    await db.stop();
  });

  it("reads a stored double back as the identical number, whatever the server default", async () => {
    // Mirror the Supabase image, whose postgresql.conf sets extra_float_digits = 0.
    const [{ current_database: database }] = (
      await db.query("select current_database()")
    ).rows;
    await db.query(
      `alter database "${String(database)}" set extra_float_digits = 0`,
    );
    await db.query("create table public.float_probe (v float8 not null)");
    await db.query("insert into public.float_probe (v) values ($1)", [
      COORDINATE,
    ]);

    const client = defaultDatabaseClientFactory(db.connectionString);
    await client.connect();
    try {
      const [row] = rowsFromResult(
        await client.query("select v from public.float_probe"),
      );
      expect(row?.v).toBe(COORDINATE);
    } finally {
      await client.end();
    }
  });
});
