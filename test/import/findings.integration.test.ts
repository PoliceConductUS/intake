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
import {
  Resolver,
  type ResolverContext,
} from "../../src/cli/import/artifacts/resolver-kit.js";
import { replayDatabaseMutations } from "../../src/cli/replay/database-mutations/config.js";
import { createSourceNameToCanonicalIdLedger } from "../../src/cli/state/source-name-to-canonical-id/index.js";
import type { Finding } from "../../src/shared/data-annotations.js";
import { INTAKE_API_VERSION } from "../../src/shared/io/import-types.js";

const namespace = "com/courtlistener/www/api";
let db: IntakeDatabase;
let root: string;
beforeAll(async () => {
  db = await startIntakeDatabase();
  root = await mkdtemp(path.join(tmpdir(), "findings-"));
  await db.query(
    "insert into public.location_path (location_path_id,path,level,display_name) values ('test','/test/','state','Test'),('texas','/tx/','state','Texas'),('new-mexico','/nm/','state','New Mexico')",
  );
}, 180000);
afterAll(async () => {
  await db?.stop();
});

function context() {
  return new DataContext({
    client: { connect: async () => {}, end: async () => {}, query: db.query },
    ledger: createSourceNameToCanonicalIdLedger({ rootDir: root }),
    commandName: "findings",
    validationDate: new Date("2026-10-27"),
  });
}

async function apply(ctx: DataContext) {
  const plan = await ctx.toDatabaseMutations({
    namespace: "test",
    name: "findings",
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

function docketFinding(docket: string): Finding {
  return {
    code: "docket-not-buildable",
    type: "warning",
    field: "docket",
    value: { docket },
    message: `Docket ${docket} could not build a case.`,
    evidence: [{ url: `https://www.courtlistener.com/docket/${docket}/` }],
    source_namespace: namespace,
    source_record_id: docket,
  };
}

function authority(
  ctx: DataContext,
  name: string,
  defects?: readonly Finding[],
  spec: Record<string, unknown> = {},
) {
  return ctx.facadeFromSource("LicensingAuthority", {
    apiVersion: INTAKE_API_VERSION,
    namespace,
    name,
    spec: { name: `Authority ${name}`, location_path_id: "test", ...spec },
    defects,
  });
}

async function annotations(subjectId: string) {
  return (
    await db.query(
      "select * from public.data_annotation where subject_id=$1 order by source_record_id, producer_record_id",
      [subjectId],
    )
  ).rows;
}

function annotationMutations(plan: Awaited<ReturnType<typeof apply>>) {
  return plan.spec.mutations.filter((mutation) =>
    JSON.stringify(mutation).includes("DataAnnotation"),
  );
}

test("two findings with one code about two dockets on one record are two annotations with stable IDs", async () => {
  const first = context();
  const facade = authority(first, "two-dockets", [
    docketFinding("101"),
    docketFinding("102"),
  ]);
  await apply(first);
  const subjectId = String(await facade.value("id"));
  const written = await annotations(subjectId);
  expect(written).toHaveLength(2);
  expect(written[0]).toMatchObject({
    subject_kind: "LicensingAuthority",
    subject_id: subjectId,
    producer_namespace: "intake",
    type: "warning",
    field: "docket",
    value: { docket: "101" },
    replacement_value: null,
    message: "Docket 101 could not build a case.",
    evidence: [{ url: "https://www.courtlistener.com/docket/101/" }],
    source_namespace: namespace,
    source_record_id: "101",
    status: "active",
  });
  expect(written[1]).toMatchObject({
    source_record_id: "102",
    message: "Docket 102 could not build a case.",
    status: "active",
  });
  expect(written[0]).not.toHaveProperty("code");
  expect(written[0].id).not.toBe(written[1].id);

  const second = context();
  authority(second, "two-dockets", [
    docketFinding("101"),
    docketFinding("102"),
  ]);
  expect(annotationMutations(await apply(second))).toEqual([]);
  expect(await annotations(subjectId)).toEqual(written);
});

test("a finding that is no longer reported is resolved and keeps its ID", async () => {
  const first = context();
  const facade = authority(first, "fixed", [
    docketFinding("201"),
    docketFinding("202"),
  ]);
  await apply(first);
  const subjectId = String(await facade.value("id"));
  const [first201, first202] = await annotations(subjectId);

  const oneFixed = context();
  authority(oneFixed, "fixed", [docketFinding("201")]);
  await apply(oneFixed);
  expect(
    (await annotations(subjectId)).map(({ id, status }) => ({ id, status })),
  ).toEqual([
    { id: first201.id, status: "active" },
    { id: first202.id, status: "resolved" },
  ]);

  const allFixed = context();
  authority(allFixed, "fixed", []);
  await apply(allFixed);
  expect(
    (await annotations(subjectId)).map(({ id, status }) => ({ id, status })),
  ).toEqual([
    { id: first201.id, status: "resolved" },
    { id: first202.id, status: "resolved" },
  ]);

  const reported = context();
  authority(reported, "fixed", [docketFinding("201")]);
  await apply(reported);
  expect(
    (await annotations(subjectId)).map(({ id, status }) => ({ id, status })),
  ).toEqual([
    { id: first201.id, status: "active" },
    { id: first202.id, status: "resolved" },
  ]);
});

test("a record emitted with no defects list leaves earlier source findings active", async () => {
  const first = context();
  const facade = authority(first, "not-a-reporter", [docketFinding("301")]);
  await apply(first);
  const subjectId = String(await facade.value("id"));
  const [written] = await annotations(subjectId);

  const withoutList = context();
  authority(withoutList, "not-a-reporter");
  await apply(withoutList);
  expect(await annotations(subjectId)).toEqual([written]);
});

function reportingWebsite(
  facade: ReturnType<DataContext["facadeFromSource"]>,
  finding: Finding | undefined,
  keepEarlier = false,
) {
  const configured = facade as unknown as {
    resolvers: Record<string, unknown>;
  };
  configured.resolvers = {
    ...configured.resolvers,
    website: new Resolver<
      unknown,
      ResolverContext<Record<string, unknown>, unknown>
    >(
      async (resolverContext) => {
        if (finding !== undefined) resolverContext.report(finding);
        if (keepEarlier) resolverContext.keepFindings();
        return undefined;
      },
      { defaultValue: undefined },
    ),
  };
}

const websiteFinding: Finding = {
  code: "website-unreachable",
  type: "warning",
  field: "website",
  value: null,
  message: "The website could not be read.",
  source_namespace: namespace,
  source_record_id: "resolver-reports",
};

test("a resolver that reports a warning and returns no value leaves the field unset and the command continues", async () => {
  const ctx = context();
  const reporting = authority(ctx, "resolver-reports", undefined, {
    website: "https://example.org/unreachable",
  });
  reportingWebsite(reporting, websiteFinding);
  const next = authority(ctx, "resolver-next", undefined, {
    website: "https://example.org/next",
  });
  await apply(ctx);
  const subjectId = String(await reporting.value("id"));
  const nextId = String(await next.value("id"));
  expect(
    (
      await db.query(
        "select id, website from public.licensing_authority where id = any($1) order by name",
        [[subjectId, nextId]],
      )
    ).rows,
  ).toEqual([
    { id: nextId, website: "https://example.org/next" },
    { id: subjectId, website: null },
  ]);
  const written = await annotations(subjectId);
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({
    subject_kind: "LicensingAuthority",
    type: "warning",
    field: "website",
    value: null,
    message: "The website could not be read.",
    evidence: null,
    source_record_id: "resolver-reports",
    status: "active",
  });
  expect(await annotations(nextId)).toEqual([]);

  const again = context();
  reportingWebsite(
    authority(again, "resolver-reports", undefined, {
      website: "https://example.org/unreachable",
    }),
    websiteFinding,
  );
  expect(annotationMutations(await apply(again))).toEqual([]);
  expect(await annotations(subjectId)).toEqual(written);

  const fixed = context();
  reportingWebsite(
    authority(fixed, "resolver-reports", undefined, {
      website: "https://example.org/unreachable",
    }),
    undefined,
  );
  await apply(fixed);
  expect(await annotations(subjectId)).toEqual([
    { ...written[0], status: "resolved" },
  ]);
});

test("a resolver that could not decide keeps its earlier findings active, and one that decides again resolves them", async () => {
  const finding = { ...websiteFinding, source_record_id: "resolver-keeps" };
  const spec = { website: "https://example.org/unreachable" };
  const first = context();
  const facade = authority(first, "resolver-keeps", undefined, spec);
  reportingWebsite(facade, finding);
  await apply(first);
  const subjectId = String(await facade.value("id"));
  const written = await annotations(subjectId);
  expect(written.map((row) => row.status)).toEqual(["active"]);

  const undecided = context();
  reportingWebsite(
    authority(undecided, "resolver-keeps", undefined, spec),
    undefined,
    true,
  );
  expect(annotationMutations(await apply(undecided))).toEqual([]);
  expect(await annotations(subjectId)).toEqual(written);

  const decided = context();
  reportingWebsite(
    authority(decided, "resolver-keeps", undefined, spec),
    undefined,
  );
  await apply(decided);
  expect(await annotations(subjectId)).toEqual([
    { ...written[0], status: "resolved" },
  ]);
});

test("the same finding reported by a source and by a resolver is two annotations", async () => {
  const finding = { ...websiteFinding, source_record_id: "both-report" };
  const ctx = context();
  const facade = authority(ctx, "both-report", [finding], {
    website: "https://example.org/unreachable",
  });
  reportingWebsite(facade, finding);
  await apply(ctx);
  const written = await annotations(String(await facade.value("id")));
  expect(written.map((row) => row.message)).toEqual([
    "The website could not be read.",
    "The website could not be read.",
  ]);
  expect(new Set(written.map((row) => row.id)).size).toBe(2);
});

test("a finding on a kind with no source evidence fails naming the kind", async () => {
  const first = context();
  const subject = authority(first, "annotated");
  await apply(first);
  const ctx = context();
  ctx.facadeFromSource("DataAnnotation", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "manual",
    name: "carries-a-finding",
    spec: {
      subject_kind: "LicensingAuthority",
      subject_id: String(await subject.value("id")),
      producer_namespace: "manual",
      producer_record_id: "carries-a-finding",
      source_namespace: namespace,
      source_record_id: "annotated",
      type: "warning",
      field: "name",
      value: "Authority annotated",
      message: "A manual annotation.",
      status: "active",
    },
    defects: [docketFinding("401")],
  });
  await expect(
    ctx.toDatabaseMutations({ namespace: "test", name: "findings" }),
  ).rejects.toThrow(
    "A finding was reported for DataAnnotation manual/carries-a-finding, which cannot hold annotations.",
  );
});

function stateAuthorityFindings(
  ctx: DataContext,
  source: string,
  state: string,
  defects: readonly Finding[],
) {
  return ctx.facadeFromSource("LicensingAuthority", {
    apiVersion: INTAKE_API_VERSION,
    namespace: source,
    name: state,
    action: "PATCH",
    selector: { location_path: { path: `/${state}/` } },
    spec: {},
    defects,
  });
}

test("sources that did not create a state's licensing authority report findings on it and resolve only their own", async () => {
  const licensing = context();
  const texas = licensing.facadeFromSource("LicensingAuthority", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "gov/texas/tcole",
    name: "tcole",
    spec: {
      name: "Texas Commission on Law Enforcement",
      abbreviation: "TCOLE",
      website: "https://www.tcole.texas.gov/",
      location_path_id: "tx",
    },
  });
  await apply(licensing);
  const texasId = String(await texas.value("id"));
  const authorityRow = async () =>
    (
      await db.query(
        "select id, name, abbreviation, website, location_path_id from public.licensing_authority where id=$1",
        [texasId],
      )
    ).rows;
  expect(await authorityRow()).toEqual([
    {
      id: texasId,
      name: "Texas Commission on Law Enforcement",
      abbreviation: "TCOLE",
      website: "https://www.tcole.texas.gov/",
      location_path_id: "texas",
    },
  ]);

  const clearinghouse = "net/clearinghouse/api";
  const fromCourtListener = context();
  stateAuthorityFindings(fromCourtListener, namespace, "tx", [
    docketFinding("501"),
  ]);
  await apply(fromCourtListener);
  const fromClearinghouse = context();
  stateAuthorityFindings(fromClearinghouse, clearinghouse, "tx", [
    {
      ...docketFinding("601"),
      source_namespace: clearinghouse,
    },
  ]);
  await apply(fromClearinghouse);

  const written = await annotations(texasId);
  expect(
    written.map(({ source_namespace, source_record_id, status }) => ({
      source_namespace,
      source_record_id,
      status,
    })),
  ).toEqual([
    { source_namespace: namespace, source_record_id: "501", status: "active" },
    {
      source_namespace: clearinghouse,
      source_record_id: "601",
      status: "active",
    },
  ]);
  expect(await authorityRow()).toEqual([
    {
      id: texasId,
      name: "Texas Commission on Law Enforcement",
      abbreviation: "TCOLE",
      website: "https://www.tcole.texas.gov/",
      location_path_id: "texas",
    },
  ]);

  const courtListenerAgain = context();
  stateAuthorityFindings(courtListenerAgain, namespace, "tx", []);
  await apply(courtListenerAgain);
  expect(
    (await annotations(texasId)).map(({ id, status }) => ({ id, status })),
  ).toEqual([
    { id: written[0].id, status: "resolved" },
    { id: written[1].id, status: "active" },
  ]);
});

test("a finding for a state with no licensing authority fails naming the state", async () => {
  const ctx = context();
  stateAuthorityFindings(ctx, namespace, "nm", [docketFinding("701")]);
  await expect(
    ctx.toDatabaseMutations({ namespace: "test", name: "findings" }),
  ).rejects.toThrow(
    'no LicensingAuthority matches selector {"location_path":{"path":"/nm/"}}',
  );
});
