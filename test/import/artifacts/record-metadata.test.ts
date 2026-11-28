import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  Artifacts,
  LicensingAuthorities,
} from "../../../src/shared/io/index.js";
import { Finding } from "../../../src/shared/data-annotations.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import { buildArtifactsEnvelope } from "../../../src/cli/transform/source-transform.js";
import { readImportArtifacts } from "../../../src/cli/import/artifacts/artifacts-reader.js";
import { addSourceFacades } from "../../../src/cli/import/artifacts/config.js";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";

const namespace = "com/courtlistener/www/api";
const defects = [
  {
    code: "docket-not-buildable",
    type: "warning" as const,
    field: "docket",
    value: { docket: 101 },
    message: "Docket 101 could not build a case.",
    evidence: [{ url: "https://www.courtlistener.com/docket/101/" }],
    source_namespace: namespace,
    source_record_id: "101",
  },
  {
    code: "docket-not-buildable",
    type: "warning" as const,
    field: "docket",
    value: null,
    message: "Docket 102 could not build a case.",
    source_namespace: namespace,
    source_record_id: "102",
  },
];
const spec = { name: "Authority", location_path_id: "test" };

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "record-metadata-"));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function writeArtifacts(name: string, metadata: unknown) {
  const target = path.join(directory, name);
  return Artifacts.write(
    target,
    buildArtifactsEnvelope(namespace, name, {
      accounting: [],
      artifacts: [
        {
          kind: "LicensingAuthorities",
          records: { tx: { metadata: metadata as never, spec } },
        },
      ],
    }),
  );
}

test("a finding with no code fails naming the missing field", () => {
  const { code: _code, ...withoutCode } = defects[0];
  const result = Finding.safeParse(withoutCode);
  expect(result.success).toBe(false);
  expect(result.error?.issues.map((issue) => issue.path)).toEqual([["code"]]);
});

test("a finding with no code in a record's metadata fails the artifact naming the field", () => {
  const { code: _code, ...withoutCode } = defects[0];
  expect(() =>
    LicensingAuthorities.new({
      metadata: { namespace, name: "authorities" },
      spec: {
        records: {
          tx: { metadata: { defects: [withoutCode as never] }, spec },
        },
      },
    }),
  ).toThrow("spec.records.tx.metadata.defects.0.code");
});

test("a transform's metadata.defects reach the import as the same list", async () => {
  const written = await writeArtifacts("whole", { defects });
  const { artifacts } = await readImportArtifacts(written.path);
  expect(artifacts.spec.artifacts[0].spec.records.tx).toEqual({
    metadata: { name: "tx", defects },
    spec,
  });
  const dataContext = new DataContext({});
  addSourceFacades(dataContext, artifacts);
  const facade = dataContext.facadeFromSource("LicensingAuthority", {
    apiVersion: INTAKE_API_VERSION,
    namespace,
    name: "tx",
  });
  expect(facade.sourceFindings).toEqual(defects);
});

test("a record with no defects in its metadata reports no source findings", async () => {
  const written = await writeArtifacts("absent", undefined);
  const { artifacts } = await readImportArtifacts(written.path);
  const dataContext = new DataContext({});
  addSourceFacades(dataContext, artifacts);
  const facade = dataContext.facadeFromSource("LicensingAuthority", {
    apiVersion: INTAKE_API_VERSION,
    namespace,
    name: "tx",
  });
  expect(facade.sourceFindings).toBeUndefined();
});

test("metadata.defects survive a record written to its own file and read back", async () => {
  const selector = { location_path_id: "test" };
  const written = await LicensingAuthorities.write(
    path.join(directory, "externalized"),
    {
      metadata: { namespace, name: "authorities" },
      spec: {
        records: {
          tx: { metadata: { action: "PATCH", selector, defects }, spec: {} },
        },
      },
    },
    { externalizeRecords: true },
  );
  const raw = await LicensingAuthorities.read(written.path, { raw: true });
  expect(Object.keys(raw.spec.records.tx)).toEqual(["ref"]);
  const artifact = await LicensingAuthorities.read(written.path);
  expect(artifact.spec.records.tx).toEqual({
    metadata: { name: "tx", action: "PATCH", selector, defects },
    spec: {},
  });
});

test("an unknown metadata key fails reading the artifact naming the key", async () => {
  await expect(
    writeArtifacts("unknown-inline", { defects, severity: "high" }),
  ).rejects.toThrow("severity");
  expect(() =>
    LicensingAuthorities.new({
      metadata: { namespace, name: "authorities" },
      spec: {
        records: { tx: { metadata: { severity: "high" } as never, spec } },
      },
    }),
  ).toThrow("spec.records.tx.metadata.severity");
});
