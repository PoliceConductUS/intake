import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  startIntakeDatabase,
  type IntakeDatabase,
} from "../cli/database/intake-postgres.js";
import { DataContext } from "../../src/cli/import/artifacts/data-context.js";
import { DatabaseMutations } from "../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { replayDatabaseMutations } from "../../src/cli/replay/database-mutations/config.js";
import { createSourceNameToCanonicalIdLedger } from "../../src/cli/state/source-name-to-canonical-id/index.js";
import { INTAKE_API_VERSION } from "../../src/shared/io/import-types.js";
import { DataAnnotation, DataAnnotations } from "../../src/shared/io/index.js";
let db: IntakeDatabase;
let root: string;
beforeAll(async () => {
  db = await startIntakeDatabase();
  root = await mkdtemp(path.join(tmpdir(), "native-annotations-"));
  await db.query(
    "insert into public.location_path (location_path_id,path,level,display_name) values ('test','/test/','state','Test')",
  );
}, 180000);
afterAll(async () => {
  await db?.stop();
});
function context() {
  return new DataContext({
    client: { connect: async () => {}, end: async () => {}, query: db.query },
    ledger: createSourceNameToCanonicalIdLedger({ rootDir: root }),
    commandName: "native",
    validationDate: new Date("2026-10-27"),
  });
}
async function apply(ctx: DataContext) {
  const plan = await ctx.toDatabaseMutations({
    namespace: "test",
    name: "native",
  });
  const { path: file } = await DatabaseMutations.write(
    await mkdtemp(path.join(root, "plan-")),
    plan,
  );
  const result = await replayDatabaseMutations({
    databaseMutationsPath: file,
    env: { DATABASE_URL: db.connectionString },
  });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  return plan;
}
const sourceName = "authority-" + "a".repeat(130);
test("normal generation applies native findings and resolves only its obsolete findings with stable IDs", async () => {
  const run = (website: string) => {
    const ctx = context();
    const facade = ctx.facadeFromSource("LicensingAuthority", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "provider",
      name: sourceName,
      spec: { name: "Authority", location_path_id: "test", website },
    });
    return { ctx, facade };
  };
  const first = run("invalid");
  await apply(first.ctx);
  const subjectId = String(await first.facade.value("id"));
  const firstRows = (await db.query("select * from public.data_annotation"))
    .rows;
  expect(firstRows).toHaveLength(1);
  expect(firstRows[0]).toMatchObject({
    subject_kind: "LicensingAuthority",
    subject_id: subjectId,
    type: "error",
    field: "website",
    value: "invalid",
    status: "active",
    producer_namespace: "intake",
  });
  const add = context();
  for (const namespace of ["manual", "provider"]) {
    const record = DataAnnotation.new({
      metadata: { namespace, name: "independent" },
      spec: {
        subject_kind: "LicensingAuthority",
        subject_id: subjectId,
        producer_namespace: namespace,
        producer_record_id: "independent",
        source_namespace: "provider",
        source_record_id: "authority",
        type: "correction",
        field: "website",
        value: [null, false, { raw: "invalid" }],
        replacement_value: null,
        evidence: [{ url: "https://example.org/evidence" }],
        message: "Accepted correction with explicit null.",
        status: "active",
      },
    });
    const written = await DataAnnotation.write(root, record);
    expect(await DataAnnotation.read(written.path)).toEqual(record);
    const artifact = DataAnnotations.new({
      metadata: { namespace, name: "annotations" },
      spec: { records: { independent: { spec: record.spec } } },
    });
    expect(artifact.kind).toBe("DataAnnotations");
    add.facadeFromSource("DataAnnotation", {
      apiVersion: INTAKE_API_VERSION,
      namespace,
      name: "independent",
      spec: record.spec,
    });
  }
  await apply(add);
  const patch = context();
  patch.facadeFromSource("LicensingAuthority", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "provider",
    name: sourceName,
    action: "PATCH",
    selector: { id: subjectId },
    spec: { name: "Authority Renamed" },
  });
  await apply(patch);
  expect(
    (
      await db.query(
        "select id,status from data_annotation where producer_namespace='intake'",
      )
    ).rows,
  ).toEqual([{ id: firstRows[0].id, status: "active" }]);
  await apply(run("https://example.org/").ctx);
  const rows = (
    await db.query(
      "select * from public.data_annotation order by producer_namespace",
    )
  ).rows;
  expect(rows).toHaveLength(3);
  expect(rows.find((row) => row.producer_namespace === "intake")).toMatchObject(
    { id: firstRows[0].id, status: "resolved" },
  );
  for (const row of rows.filter((row) => row.producer_namespace !== "intake"))
    expect(row).toMatchObject({
      status: "active",
      value: [null, false, { raw: "invalid" }],
      replacement_value: null,
      evidence: [{ url: "https://example.org/evidence" }],
    });
  await apply(run("invalid").ctx);
  expect(
    (
      await db.query(
        "select id,status from public.data_annotation where producer_namespace='intake'",
      )
    ).rows,
  ).toEqual([{ id: firstRows[0].id, status: "active" }]);
  const manualCorrection = context();
  manualCorrection.facadeFromSource("LicensingAuthority", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "manual",
    name: "authority-fix",
    action: "PATCH",
    selector: { id: subjectId },
    spec: { website: "https://example.org/fixed" },
  });
  await apply(manualCorrection);
  expect(
    (
      await db.query(
        "select id,status from data_annotation where producer_namespace='intake'",
      )
    ).rows,
  ).toEqual([{ id: firstRows[0].id, status: "resolved" }]);
  expect(
    (
      await db.query(
        "select status from data_annotation where producer_namespace <> 'intake'",
      )
    ).rows,
  ).toEqual([{ status: "active" }, { status: "active" }]);
});
test("native annotation references reject unknown kinds and missing subjects", async () => {
  for (const [subject_kind, subject_id] of [
    ["Unknown", "bad"],
    ["FederalAgency", "missing"],
  ]) {
    const ctx = context();
    ctx.facadeFromSource("DataAnnotation", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "manual",
      name: "bad",
      spec: {
        subject_kind,
        subject_id,
        producer_namespace: "manual",
        producer_record_id: "bad",
        source_namespace: "provider",
        source_record_id: "record",
        type: "warning",
        field: "name",
        value: null,
        message: "Unresolved subject",
        status: "active",
      },
    });
    await expect(ctx.toMutations()).rejects.toThrow();
  }
});

test("generation publishes auditable corrections as ordinary native records", async () => {
  const ctx = context();
  const facade = ctx.facadeFromSource("LicensingAuthority", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "provider",
    name: sourceName,
    spec: {
      name: "Authority",
      location_path_id: "test",
      website: "https://example.org/",
    },
  });
  facade.recordSourceContribution({ website: "invalid" }, [
    {
      type: "correction",
      field: "website",
      value: "invalid",
      replacement_value: "https://example.org/",
      message: "Accepted source evidence.",
      source_namespace: "provider",
      source_record_id: sourceName,
      evidence: [{ url: "https://example.org/evidence" }],
    },
  ]);
  await apply(ctx);
  const rows = (
    await db.query(
      "select * from data_annotation where producer_namespace='intake' and status='active'",
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    type: "correction",
    value: "invalid",
    replacement_value: "https://example.org/",
    evidence: [{ url: "https://example.org/evidence" }],
  });
  const unrelatedPatch = context();
  unrelatedPatch.facadeFromSource("LicensingAuthority", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "provider",
    name: sourceName,
    action: "PATCH",
    selector: { id: rows[0].subject_id },
    spec: { name: "New Display Name" },
  });
  await apply(unrelatedPatch);
  expect(
    (
      await db.query("select status from data_annotation where id=$1", [
        rows[0].id,
      ])
    ).rows,
  ).toEqual([{ status: "active" }]);

  const processedField = context();
  processedField.facadeFromSource("LicensingAuthority", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "provider",
    name: sourceName,
    action: "PATCH",
    selector: { id: rows[0].subject_id },
    spec: { website: "https://example.org/" },
  });
  await apply(processedField);
  expect(
    (
      await db.query("select status from data_annotation where id=$1", [
        rows[0].id,
      ])
    ).rows,
  ).toEqual([{ status: "resolved" }]);
});
