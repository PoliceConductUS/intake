import type { IdentityRestorationEnvelope } from "../../shared/io/IdentityRestoration.js";
import {
  TABLE_BY_KIND,
  PRIMARY_KEY_BY_KIND,
} from "../../shared/io/generated/entity-specs.js";
import { rowsFromResult, type DatabaseClient } from "./index.js";

export async function assertDatabaseIdentityRestorationReady(
  client: DatabaseClient,
  event: IdentityRestorationEnvelope,
): Promise<{ table: string; key: string }> {
  const table = TABLE_BY_KIND[event.spec.entityKind];
  const key = PRIMARY_KEY_BY_KIND[event.spec.entityKind];
  if (table === undefined || key === undefined)
    throw new Error("Unsupported restoration entity kind.");
  const incoming = rowsFromResult(
    await client.query(
      `select conname from pg_constraint where contype = 'f' and confrelid = $1::regclass and confupdtype <> 'c'`,
      [table],
    ),
  );
  if (incoming.length > 0)
    throw new Error(
      `Identity restoration requires ON UPDATE CASCADE on incoming references: ${incoming.map((row) => row.conname).join(", ")}.`,
    );
  const rows = rowsFromResult(
    await client.query(
      `select "${key}" from ${table} where "${key}" = any($1::text[]) for update`,
      [[event.spec.expectedCurrentId, event.spec.originalId]],
    ),
  );
  if (rows.some((row) => row[key] === event.spec.originalId))
    throw new Error("Identity restoration target collision.");
  if (rows.length !== 1 || rows[0]![key] !== event.spec.expectedCurrentId)
    throw new Error("Identity restoration current database row is missing.");
  return { table, key };
}

// Caller owns the transaction and records the immutable chain receipt in it.
export async function restoreDatabaseIdentity(
  client: DatabaseClient,
  event: IdentityRestorationEnvelope,
): Promise<void> {
  const { table, key } = await assertDatabaseIdentityRestorationReady(
    client,
    event,
  );
  const changed = rowsFromResult(
    await client.query(
      `update ${table} set "${key}" = $1 where "${key}" = $2 returning "${key}"`,
      [event.spec.originalId, event.spec.expectedCurrentId],
    ),
  );
  if (changed.length !== 1 || changed[0]![key] !== event.spec.originalId)
    throw new Error("Identity restoration must update exactly one row.");
}
