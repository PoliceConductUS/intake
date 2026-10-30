import { expect, test } from "vitest";
import { startIntakeDatabase } from "../database/intake-postgres.js";
import {
  defaultDatabaseClientFactory,
  rowsFromResult,
} from "../../../src/cli/database/index.js";
import { restoreDatabaseIdentity } from "../../../src/cli/database/restore-identity.js";
import { IdentityRestoration } from "../../../src/shared/io/IdentityRestoration.js";

test("restores a real ReviewLink inside a rollback-only transaction", async () => {
  const database = await startIntakeDatabase();
  const client = defaultDatabaseClientFactory(database.connectionString);
  try {
    await client.connect();
    await client.query("begin");
    await client.query(
      "insert into location_path (location_path_id,path,level,display_name) values ('identity-fixture','/identity-fixture/','state','Synthetic fixture')",
    );
    await client.query(
      "insert into reviews (id,title,slug,location_path_id,latitude,longitude) values ('identity-fixture','Synthetic identity test','identity-fixture','identity-fixture',0,0)",
    );
    await client.query(
      "insert into review_links (id,review_id,url,title) values ('identity-fixture','identity-fixture','https://example.invalid/fixture','Synthetic fixture')",
    );
    const row = rowsFromResult(
      await client.query(
        "select id from public.review_links order by id limit 1",
      ),
    )[0];
    if (!row)
      throw new Error(
        "ReviewLink integration fixture requires an existing source row",
      );
    const originalId = "identityrestorationrollbackfixture";
    await restoreDatabaseIdentity(
      client,
      IdentityRestoration.new({
        metadata: { name: "rollback-only", namespace: "test" },
        spec: {
          entityKind: "ReviewLink",
          sourceName: "rollback-fixture",
          expectedCurrentId: String(row.id),
          originalId,
          reason: "Rollback-only restoration validation",
          evidence: "Synthetic fixture inserted inside transaction",
        },
      }),
    );
    expect(
      rowsFromResult(
        await client.query("select id from public.review_links where id = $1", [
          originalId,
        ]),
      ),
    ).toEqual([{ id: originalId }]);
  } finally {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
      await database.stop();
    }
  }
}, 120_000);
