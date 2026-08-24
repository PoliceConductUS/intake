/**
 * Fails the build if the corrections/takedown invariant has been weakened.
 *
 * The counterpart to assert-provenance-invariant.ts. This runs
 * public.assert_suppression_invariant() against a live database and exits
 * non-zero on any violation. The findings it exists to catch:
 *
 *   - a later migration re-granting the ingestion role write access to the
 *     suppression tables, typically via a convenient
 *     `grant all on all tables in schema public`;
 *   - an actively-suppressed subject that is reachable through a render view,
 *     which is a takedown that is not actually in effect;
 *   - requester identity leaking into the public corrections log;
 *   - a legal demand resolved without escalation.
 *
 * Run this after `supabase db reset` and after every migration in CI. A
 * suppression invariant that is only checked by the migration that created it
 * decays the moment someone writes the next migration.
 *
 *   DATABASE_URL=postgres://... npm run assert:suppression
 */

import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("assert:suppression requires DATABASE_URL");
  process.exit(2);
}

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  const { rows } = await client.query<{ violation: string; detail: string }>(
    "select violation, detail from public.assert_suppression_invariant()",
  );

  if (rows.length === 0) {
    console.log("suppression invariant intact");
    process.exit(0);
  }

  console.error(
    `suppression invariant VIOLATED (${rows.length} finding${rows.length === 1 ? "" : "s"}):`,
  );
  for (const row of rows) {
    console.error(`  ${row.violation}: ${row.detail}`);
  }
  process.exit(1);
} finally {
  await client.end();
}
