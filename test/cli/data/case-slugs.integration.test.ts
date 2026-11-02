import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  startIntakeDatabase,
  type IntakeDatabase,
} from "../database/intake-postgres.js";
import {
  defaultDatabaseClientFactory,
  type DatabaseClient,
} from "../../../src/cli/database/index.js";
import {
  generateCaseSlugMigrationEntry,
  applyPending,
} from "../../../src/cli/data/chain.js";
import { CaseSlugMigration } from "../../../src/shared/io/CaseSlugMigration.js";
import {
  completeCaseSlugState,
  readCaseUrlHistory,
} from "../../../src/cli/database/case-slugs.js";
import { inspectResolvedProperty } from "../../../src/cli/state/resolved-property/index.js";
let db: IntakeDatabase;
let client: DatabaseClient;
let workspace: string;
beforeAll(async () => {
  db = await startIntakeDatabase();
  client = defaultDatabaseClientFactory(db.connectionString);
  await client.connect();
  workspace = await mkdtemp(path.join(tmpdir(), "case-slug-migration-"));
  await mkdir(path.join(workspace, "state/intake/namespaces"), {
    recursive: true,
  });
  await db.query(
    "insert into public.location_path (location_path_id,path,level,display_name) values ('tx','/tx/','state','Texas')",
  );
  await db.query(
    "insert into public.civil_cases (id,title,cause_number,court,filed_date,claims_summary,slug,location_path_id,primary_source_url) values ('stable-case','Example v. City','123','txnd','2025-01-02','Source summary','old-case','tx','https://example.org/docket')",
  );
}, 180000);
afterAll(async () => {
  await client?.end();
  await db?.stop();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});
test("guards source drift, preserves IDs, resumes state, and restores aliases after reset", async () => {
  const root = path.join(workspace, "data");
  const first = await generateCaseSlugMigrationEntry(
    client,
    "test evidence",
    root,
  );
  expect(first?.mutationCount).toBe(1);
  const event = await CaseSlugMigration.read(first!.written);
  const wrongTarget = structuredClone(event);
  wrongTarget.spec.rows[0]!.cacheAfter.spec.subject.name = "another-case";
  expect(CaseSlugMigration.schema.safeParse(wrongTarget).success).toBe(false);

  await db.query(
    "update public.civil_cases set title='Changed title' where id='stable-case'",
  );
  await expect(applyPending(client, { root })).rejects.toThrow(
    /inputs changed/,
  );
  expect(
    (
      await db.query(
        "select count(*)::int as n from public.civil_case_url_alias",
      )
    ).rows[0]?.n,
  ).toBe(0);
  await db.query(
    "update public.civil_cases set title='Example v. City' where id='stable-case'",
  );
  expect(await applyPending(client, { root })).toHaveLength(1);
  expect(
    (await db.query("select id,slug from public.civil_cases")).rows,
  ).toEqual([{ id: "stable-case", slug: event.spec.rows[0]!.newSlug }]);
  // Replaying state completion after database commit is safe and retains history.
  await completeCaseSlugState(event, workspace);
  expect(await applyPending(client, { root })).toEqual([]);
  expect(
    await generateCaseSlugMigrationEntry(client, "test evidence", root),
  ).toBeUndefined();
  const history = await readCaseUrlHistory(workspace);
  expect(history?.spec.aliases).toHaveLength(2);
  const key = {
    rootDir: workspace,
    subject: {
      apiVersion: "policeconduct.org/intake/v1alpha1" as const,
      kind: "CivilCase",
      name: "stable-case",
    },
    targetProperty: "slug",
  };
  expect((await inspectResolvedProperty(key))?.spec.entries.at(-1)?.value).toBe(
    event.spec.rows[0]!.newSlug,
  );
  // A rebuild keeps the new canonical slug from cache; alias projection must be restored.
  await db.query("delete from public.civil_case_url_alias");
  await db.query("delete from public.data_mutation_applied");
  await rm(root, { recursive: true });
  const restored = await generateCaseSlugMigrationEntry(
    client,
    "retained history",
    root,
  );
  expect(restored).toBeDefined();
  await applyPending(client, { root });
  expect(
    (
      await db.query(
        "select count(*)::int as n from public.civil_case_url_alias",
      )
    ).rows[0]?.n,
  ).toBe(2);
  expect(await applyPending(client, { root })).toEqual([]);
  expect(
    await generateCaseSlugMigrationEntry(client, "retained history", root),
  ).toBeUndefined();
  expect(await readFile(restored!.written, "utf8")).toContain(
    "CaseSlugMigration",
  );
  await db.query(
    "update public.civil_cases set full_citation='Example v. City, 123 F.3d 456 (5th Cir. 1999)',citation_source_url='https://example.org/opinion'",
  );
  const later = await generateCaseSlugMigrationEntry(
    client,
    "sourced opinion",
    root,
  );
  expect(later).toBeDefined();
  await applyPending(client, { root });
  expect(await applyPending(client, { root })).toEqual([]);
  expect(
    await generateCaseSlugMigrationEntry(client, "sourced opinion", root),
  ).toBeUndefined();
}, 180000);
