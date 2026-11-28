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
import type { ServiceClients } from "../../src/shared/services/index.js";
import {
  harness,
  unusedServiceClients,
  type FakeAnswer,
} from "../shared/services/harness.js";
import {
  COMPLAINT_PAGE,
  complaintEntry,
  DOCKET_URL,
  FILE_URL,
  json,
  NAMESPACE,
  outside,
  PDF,
  PDF_SHA1,
  PDF_SHA256,
} from "./artifacts/complaint-summary-fixture.js";

const DAY_MS = 86_400_000;
const entries = (...results: unknown[]): FakeAnswer =>
  json({ results, next: null });

let db: IntakeDatabase;
let root: string;
beforeAll(async () => {
  db = await startIntakeDatabase();
  root = await mkdtemp(path.join(tmpdir(), "complaint-summary-"));
  await db.query(
    "insert into public.location_path (location_path_id,path,level,display_name) values ('texas','/tx/','state','Texas')",
  );
}, 180000);
afterAll(async () => {
  await db?.stop();
});

async function generateAndApply(
  caseId: string,
  serviceClients: ServiceClients,
  primarySourceUrl: string = DOCKET_URL,
  extra: Record<string, unknown> = {},
) {
  const ctx = new DataContext({
    client: { connect: async () => {}, end: async () => {}, query: db.query },
    ledger: createSourceNameToCanonicalIdLedger({ rootDir: root }),
    commandName: "complaint-summary",
    validationDate: new Date("2026-10-27"),
    serviceClients,
  });
  ctx.facadeFromSource("CivilCase", {
    apiVersion: INTAKE_API_VERSION,
    namespace: NAMESPACE,
    name: caseId,
    spec: {
      id: caseId,
      title: "Doe v. City",
      cause_number: caseId.split(":").slice(1).join(":"),
      court: "txnd",
      filed_date: "2025-01-01",
      claims_summary: "42:1983 Civil Rights Act",
      slug: `doe-v-city-${caseId.replaceAll(":", "-")}`,
      outcome: null,
      primary_source_url: primarySourceUrl,
      date_terminated: null,
      location_path_id: "tx",
      ...extra,
    },
  });
  const plan = await ctx.toDatabaseMutations({
    namespace: "test",
    name: "complaint-summary",
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
}

async function civilCase(caseId: string) {
  return (
    await db.query(
      "select ai_complaint_summary, complaint_summary_unavailability from public.civil_cases where id=$1",
      [caseId],
    )
  ).rows[0];
}

async function annotations(caseId: string) {
  return (
    await db.query(
      "select id, subject_kind, type, field, value, message, evidence, source_namespace, source_record_id, status from public.data_annotation where subject_id=$1 order by message",
      [caseId],
    )
  ).rows;
}

test("a case whose complaint file does not match its recorded SHA-1 reaches the database with sha1Verified false and one error annotation", async () => {
  const caseId = "txnd:3:25-cv-0001";
  const recorded = "0".repeat(40);
  const h = await harness();
  const world = outside(h.deps, {
    entries: entries(complaintEntry({ sha1: recorded })),
  });
  await generateAndApply(caseId, world.clients);

  const row = await civilCase(caseId);
  expect(row.complaint_summary_unavailability).toBeNull();
  expect(row.ai_complaint_summary).toMatchObject({
    summary: "The plaintiff alleges an unlawful arrest.\n\nHe seeks damages.",
    source: {
      url: FILE_URL,
      sourcePage: COMPLAINT_PAGE,
      sha1: recorded,
      sha256: PDF_SHA256,
      sha1Verified: false,
    },
  });
  expect(await h.binaryFileNames()).toContain(`${PDF_SHA256}.pdf`);
  expect(world.work()).toMatchObject({ model: 1 });
  const written = await annotations(caseId);
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({
    subject_kind: "CivilCase",
    type: "error",
    field: "ai_complaint_summary",
    value: {
      recordedSha1: recorded,
      servedSha1: PDF_SHA1,
      servedSha256: PDF_SHA256,
      bytes: PDF.length,
    },
    message: `The summary of the complaint in this case was made from a copy that is not the file CourtListener has on record. Do not trust the summary, or anything else on this page that was worked out from that copy. The complaint: ${COMPLAINT_PAGE}`,
    source_namespace: NAMESPACE,
    source_record_id: "12",
    status: "active",
  });
  expect(written[0].evidence).toHaveLength(3);
});

test("a problem that goes away gives the case its summary and resolves the annotation, which keeps its ID; an outage in between changes nothing", async () => {
  const caseId = "txnd:3:25-cv-0002";
  const h = await harness();
  await generateAndApply(
    caseId,
    outside(h.deps, { entries: entries() }).clients,
  );

  const notFound = `We could not summarize the complaint in this case because we could not find it among the documents filed. The case on CourtListener: ${DOCKET_URL}`;
  const before = await civilCase(caseId);
  expect(before.ai_complaint_summary).toBeNull();
  expect(before.complaint_summary_unavailability).toMatchObject({
    reason: "pending",
    detail: notFound,
    sourceUrl: DOCKET_URL,
  });
  const [reported] = await annotations(caseId);
  expect(reported).toMatchObject({
    type: "warning",
    message: notFound,
    status: "active",
  });

  h.advance(121 * DAY_MS);
  const down = outside(h.nextCommand(), { entries: { status: 503 } });
  await generateAndApply(caseId, down.clients);
  expect(down.clients.skips()).toHaveLength(1);
  expect(await civilCase(caseId)).toEqual(before);
  expect(await annotations(caseId)).toEqual([reported]);

  h.advance(DAY_MS);
  await generateAndApply(caseId, outside(h.nextCommand()).clients);
  const after = await civilCase(caseId);
  expect(after.complaint_summary_unavailability).toBeNull();
  expect(after.ai_complaint_summary).toMatchObject({
    summary: "The plaintiff alleges an unlawful arrest.\n\nHe seeks damages.",
    source: { sha1Verified: true },
  });
  expect(await annotations(caseId)).toEqual([
    { ...reported, status: "resolved" },
  ]);
});

test("a case whose primary source is not a CourtListener docket keeps what its source supplied, and no service is called", async () => {
  const caseId = "txnd:3:25-cv-0003";
  const supplied = {
    summary: "A summary its source supplied.",
    source: { sourcePage: "https://clearinghouse.net/case/3/" },
  };
  await generateAndApply(
    caseId,
    unusedServiceClients(),
    "https://clearinghouse.net/case/3/",
    { ai_complaint_summary: supplied },
  );

  expect(await civilCase(caseId)).toEqual({
    ai_complaint_summary: supplied,
    complaint_summary_unavailability: null,
  });
  expect(await annotations(caseId)).toEqual([]);
});
