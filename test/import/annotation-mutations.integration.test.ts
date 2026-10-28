import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  startIntakeDatabase,
  type IntakeDatabase,
} from "../cli/database/intake-postgres.js";
import { DatabaseMutations } from "../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { replayDatabaseMutations } from "../../src/cli/replay/database-mutations/config.js";
let db: IntakeDatabase;
beforeAll(async () => {
  db = await startIntakeDatabase();
}, 180000);
afterAll(async () => {
  await db?.stop();
});
const contribution = (namespace: string, id: string) => ({
  source_namespace: namespace,
  source_record_id: id,
  values: {
    name: {
      value: "Original",
      effective_value: "Agency",
      source_namespace: namespace,
      source_record_id: id,
    },
  },
  corrections: [
    {
      field: "name",
      value: "Original",
      replacement_value: "Agency",
      message: "Applied a source-backed correction.",
      type: "correction",
      source_namespace: namespace,
      source_record_id: id,
    },
  ],
});
async function apply(
  mutations: { kind: string; name: string; spec: Record<string, unknown> }[],
) {
  const root = await mkdtemp(path.join(tmpdir(), "annotation-mutations-"));
  const { path: file } = await DatabaseMutations.write(
    root,
    DatabaseMutations.new({
      metadata: { name: "run", namespace: "test" },
      spec: { mutations },
    }),
  );
  const result = await replayDatabaseMutations({
    databaseMutationsPath: file,
    env: { DATABASE_URL: db.connectionString },
  });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
}
test("applies corrections against current row state and retains other contributions", async () => {
  const a1 = contribution("a", "one"),
    a2 = contribution("a", "two"),
    b1 = contribution("b", "one");
  await apply([
    {
      kind: "FederalAgencyCreate",
      name: "agency",
      spec: {
        id: "agency",
        name: "Agency",
        slug: "agency",
        source_contribution: a1,
      },
    },
  ]);
  const update = (source_contribution: ReturnType<typeof contribution>) => ({
    kind: "FederalAgencyUpdate",
    name: "agency",
    spec: {
      source_contribution,
      operations: [
        {
          action: "check",
          path: "name",
          value: "Agency",
          reason: "Compare source value.",
          source: {
            namespace: "test",
            name: "one",
            kind: "FederalAgency",
            command: { name: "run" },
          },
        },
      ],
    },
  });
  await apply([update(a2), update(b1)]);
  expect(
    (
      await db.query(
        "select data_annotations from public.federal_agency where id = 'agency'",
      )
    ).rows[0].data_annotations,
  ).toEqual([...a1.corrections, ...a2.corrections, ...b1.corrections]);
  await apply([update({ ...a1, corrections: [] })]);
  expect(
    (
      await db.query(
        "select data_annotations from public.federal_agency where id = 'agency'",
      )
    ).rows[0].data_annotations,
  ).toEqual([...a2.corrections, ...b1.corrections]);
});

test("authority exclusions are source-scoped at apply time and regenerate annotations", async () => {
  await db.query(
    "insert into location_path (location_path_id,path,level,display_name) values ('exclusion-state','/exclusion-state/','state','Test')",
  );
  const exclusion = (key: string) => ({
    kind: "Agency",
    key,
    reason: "Unresolvable geography",
  });
  await apply([
    {
      kind: "LicensingAuthorityCreate",
      name: "board",
      spec: {
        id: "board",
        name: "Board",
        location_path_id: "exclusion-state",
        source_exclusions: { a: [exclusion("one")] },
        source_contribution: { ...contribution("a", "board"), corrections: [] },
      },
    },
  ]);
  const update = (value: unknown) => ({
    kind: "LicensingAuthorityUpdate",
    name: "board",
    spec: {
      operations: [
        {
          action: "set",
          path: "source_exclusions",
          from: {},
          to: value,
          reason: "Refresh explicit exclusions",
          source: {
            namespace: "test",
            name: "board",
            kind: "LicensingAuthority",
            command: { name: "run" },
          },
        },
      ],
    },
  });
  await apply([update({ b: [exclusion("two")] })]);
  await apply([update({ a: [] })]);
  const row = (
    await db.query(
      "select source_exclusions,data_annotations from licensing_authority where id='board'",
    )
  ).rows[0];
  expect(row.source_exclusions).toEqual({ a: [], b: [exclusion("two")] });
  expect(row.data_annotations).toEqual([
    expect.objectContaining({
      source_namespace: "b",
      source_record_id: "two",
      field: "excluded_records",
      message: "Explicitly excluded Agency: Unresolvable geography",
    }),
  ]);
});
