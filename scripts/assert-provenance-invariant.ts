/**
 * Fails the build if the provenance invariant has been weakened.
 *
 * A schema invariant that is only checked by the migration that created it
 * decays the moment someone writes the next migration. This runs
 * public.assert_provenance_invariant() against a live database and exits
 * non-zero on any violation -- notably a later migration granting the render
 * role access to a base table, or opening the personnel publication gate.
 *
 *   DATABASE_URL=postgres://... npm run assert:provenance
 */

import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("assert:provenance requires DATABASE_URL");
  process.exit(2);
}

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  const { rows } = await client.query<{ violation: string; detail: string }>(
    "select violation, detail from public.assert_provenance_invariant()",
  );

  if (rows.length === 0) {
    console.log("provenance invariant intact");
    process.exit(0);
  }

  console.error(
    `provenance invariant VIOLATED (${rows.length} finding${rows.length === 1 ? "" : "s"}):`,
  );
  for (const row of rows) {
    console.error(`  ${row.violation}: ${row.detail}`);
  }
  process.exit(1);
} finally {
  await client.end();
}
