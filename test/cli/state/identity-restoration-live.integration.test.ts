import { expect, test } from "vitest";
import {
  defaultDatabaseClientFactory,
  rowsFromResult,
} from "../../../src/cli/database/index.js";
import { restoreDatabaseIdentity } from "../../../src/cli/database/restore-identity.js";
import { IdentityRestoration } from "../../../src/shared/io/IdentityRestoration.js";

// Explicit opt-in: tests never connect to a configured working database implicitly.
test.skipIf(!process.env.IDENTITY_RESTORATION_TEST_DATABASE_URL)(
  "restores a real ReviewLink inside a rollback-only transaction",
  async () => {
    const client = defaultDatabaseClientFactory(
      process.env.IDENTITY_RESTORATION_TEST_DATABASE_URL!,
    );
    await client.connect();
    await client.query("begin");
    try {
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
            evidence: "Existing database row selected inside transaction",
          },
        }),
      );
      expect(
        rowsFromResult(
          await client.query(
            "select id from public.review_links where id = $1",
            [originalId],
          ),
        ),
      ).toEqual([{ id: originalId }]);
    } finally {
      await client.query("rollback");
      await client.end();
    }
  },
);
