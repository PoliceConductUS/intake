import { EmptyDatabaseClient } from "../../cli/database/empty-database-client.js";
import { expect, test } from "vitest";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";

test("manual native annotations use normal facade and mutation registry", async () => {
  const context = new DataContext({
    commandName: "native-test",
    client: new EmptyDatabaseClient(),
  });
  context.facadeFromSource("FederalAgency", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "manual",
    name: "target",
    spec: { name: "Federal", slug: "federal" },
  });
  context.facadeFromSource("DataAnnotation", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "manual",
    name: "finding",
    spec: {
      subject_kind: "FederalAgency",
      subject_id: "target",
      producer_namespace: "manual",
      producer_record_id: "finding",
      source_namespace: "provider",
      source_record_id: "record",
      type: "warning",
      field: "name",
      value: "raw",
      message: "Check supplied name",
      status: "active",
    },
  });
  const result = await context.toMutations();
  expect(result).toHaveLength(2);
  expect(
    result.find((item) => item.kind === "DataAnnotationCreate"),
  ).toMatchObject({
    kind: "DataAnnotationCreate",
    spec: {
      subject_kind: "FederalAgency",
      producer_namespace: "manual",
      status: "active",
    },
  });
});

test("generation retains distinct same-field warnings and inspects current end dates on a partial update", async () => {
  const row = {
    id: "assignment",
    agency_id: "agency",
    personnel_id: "person",
    title: "Officer",
    start_date: "1900-01-01",
    end_date: "2100-01-01",
    data_source_values: {
      end_date: {
        value: "2100-01-01",
        effective_value: "2100-01-01",
        source_namespace: "provider",
        source_record_id: "assignment",
      },
    },
  };
  class SubjectClient extends EmptyDatabaseClient {
    async query(text = "") {
      return {
        rows: text.includes("from public.agency_personnel") ? [row] : [],
      };
    }
  }
  const ctx = new DataContext({
    commandName: "test",
    client: new SubjectClient(),
    validationDate: new Date("2026-10-27"),
  });
  ctx.facadeFromSource("AgencyPersonnel", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "provider",
    name: "assignment",
    action: "PATCH",
    selector: { id: "assignment" },
    spec: { start_date: "1901-01-01" },
  });
  const findings = (await ctx.toMutations()).filter(
    (item) => item.kind === "DataAnnotationCreate",
  );
  expect(findings).toHaveLength(2);
  expect(new Set(findings.map((item) => item.metadata.name)).size).toBe(2);
  for (const finding of findings)
    expect(finding.spec).toMatchObject({
      type: "warning",
      field: "end_date",
      subject_kind: "AgencyPersonnel",
      subject_id: "assignment",
    });
});

test("singular and externalized native annotation records support ordinary PATCH", async () => {
  const { DataAnnotation, DataAnnotations } =
    await import("../../../src/shared/io/index.js");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "annotation-patch-"));
  const record = DataAnnotation.new({
    metadata: {
      namespace: "manual",
      name: "finding",
      action: "PATCH",
      selector: { id: "existing" },
    },
    spec: { status: "resolved" },
  });
  const result = await DataAnnotation.write(directory, record);
  expect(await DataAnnotation.read(result.path)).toEqual(record);
  const artifact = await DataAnnotations.write(
    directory,
    {
      metadata: { namespace: "manual", name: "patches" },
      spec: {
        records: {
          finding: {
            metadata: { action: "PATCH", selector: { id: "existing" } },
            spec: { status: "resolved" },
          },
        },
      },
    },
    { externalizeRecords: true },
  );
  expect(
    (await DataAnnotations.read(artifact.path)).spec.records.finding.spec,
  ).toEqual({ status: "resolved" });
});

test("native corrections distinguish omitted replacements from explicit null", async () => {
  const { DataAnnotationSpec } =
    await import("../../../src/shared/io/index.js");
  const spec = {
    subject_kind: "FederalAgency",
    subject_id: "target",
    producer_namespace: "manual",
    producer_record_id: "finding",
    source_namespace: "provider",
    source_record_id: "record",
    type: "correction",
    field: "name",
    value: "raw",
    message: "Accepted correction",
    status: "active",
  };
  expect(DataAnnotationSpec.safeParse(spec).success).toBe(false);
  expect(
    DataAnnotationSpec.safeParse({ ...spec, replacement_value: null }).success,
  ).toBe(true);
});

test("changing a native warning to correction requires an explicit replacement", async () => {
  const current = {
    id: "finding",
    subject_kind: "FederalAgency",
    subject_id: "target",
    producer_namespace: "manual",
    producer_record_id: "finding",
    source_namespace: "provider",
    source_record_id: "record",
    type: "warning",
    field: "name",
    value: "raw",
    replacement_value: null,
    message: "Check name",
    status: "active",
  };
  class AnnotationClient extends EmptyDatabaseClient {
    async query() {
      return { rows: [current] };
    }
  }
  const make = (spec: Record<string, unknown>) => {
    const ctx = new DataContext({
      commandName: "test",
      client: new AnnotationClient(),
    });
    ctx.facadeFromSource("DataAnnotation", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "manual",
      name: "finding",
      action: "PATCH",
      selector: { id: "finding" },
      current,
      spec,
    });
    return ctx;
  };
  await expect(make({ type: "correction" }).toMutations()).rejects.toThrow(
    /replacement_value/,
  );
  expect(
    (
      await make({ type: "correction", replacement_value: null }).toMutations()
    )[0].kind,
  ).toBe("DataAnnotationUpdate");
});

test("native PATCH validates the effective subject pair when either half changes", async () => {
  const current = {
    id: "finding",
    subject_kind: "FederalAgency",
    subject_id: "target",
    producer_namespace: "manual",
    producer_record_id: "finding",
    source_namespace: "provider",
    source_record_id: "record",
    type: "warning",
    field: "name",
    value: "raw",
    replacement_value: null,
    message: "Check name",
    status: "active",
  };
  class ReferenceClient extends EmptyDatabaseClient {
    async query(
      text = "",
      values: readonly unknown[] = [],
    ): Promise<{ rows: Record<string, unknown>[] }> {
      if (text.includes("from public.data_annotation"))
        return { rows: [current] };
      if (text.includes("from public.federal_agency"))
        return {
          rows: ["target", "new-target"]
            .filter((id) => values.flat().includes(id))
            .map((id) => ({ id })),
        };
      return { rows: [] };
    }
  }
  const make = (spec: Record<string, unknown>) => {
    const ctx = new DataContext({
      commandName: "test",
      client: new ReferenceClient(),
    });
    ctx.facadeFromSource("DataAnnotation", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "manual",
      name: "finding",
      action: "PATCH",
      selector: { id: "finding" },
      current,
      spec,
    });
    return ctx;
  };
  await expect(
    make({ subject_kind: "Personnel" }).toMutations(),
  ).rejects.toThrow();
  await expect(
    make({ subject_kind: "Unknown" }).toMutations(),
  ).rejects.toThrow();
  const mutations = await make({ subject_id: "new-target" }).toMutations();
  expect(mutations[0].spec).toMatchObject({
    operations: [
      expect.objectContaining({ path: "subject_id", to: "new-target" }),
    ],
  });
});

test("a later converging source can clear a finding created earlier in the same generation", async () => {
  class AuthorityClient extends EmptyDatabaseClient {
    async query(text = "") {
      return {
        rows: text.includes("from public.licensing_authority")
          ? [
              {
                id: "authority",
                name: "Authority",
                location_path_id: "test",
                website: "https://example.org/",
              },
            ]
          : [],
      };
    }
  }
  const ctx = new DataContext({
    client: new AuthorityClient(),
    commandName: "convergence",
  });
  for (const [namespace, website] of [
    ["first", "invalid"],
    ["second", "https://example.org/"],
  ]) {
    ctx.facadeFromSource("LicensingAuthority", {
      apiVersion: INTAKE_API_VERSION,
      namespace,
      name: "authority",
      action: "PATCH",
      selector: { id: "authority" },
      spec: { website },
    });
  }
  const mutations = await ctx.toDatabaseMutationItems();
  expect(
    mutations.some(
      (item) => "kind" in item && item.kind === "LicensingAuthorityUpdate",
    ),
  ).toBe(true);
  expect(
    mutations.filter(
      (item) => "kind" in item && item.kind.startsWith("DataAnnotation"),
    ),
  ).toEqual([]);
});
