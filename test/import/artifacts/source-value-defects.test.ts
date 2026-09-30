import { expect, test } from "vitest";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import { cleanSourceValues } from "../../../src/shared/source-value-types.js";

const source = {
  apiVersion: INTAKE_API_VERSION,
  namespace: "test.source",
  name: "one",
} as const;
test.each(["(000) 000-0000", "0000000000", "0", "N/A", "123"])(
  "omits invalid phone %s",
  (phone_number) => {
    const result = cleanSourceValues("AgencyPhoneNumber", {
      phone_number,
      agency_id: "agency",
    });
    expect(result.spec).toEqual({ agency_id: "agency" });
    expect(result.defects).toEqual([
      expect.objectContaining({
        field: "phone_number",
        value: phone_number,
        required: true,
      }),
    ]);
  },
);
test.each([
  "(512) 555-0123",
  "+44 20 7946 0958",
  "1-800-FLOWERS",
  "(512) 555-0123 ext. 42",
])("retains phone %s", (phone_number) => {
  expect(
    cleanSourceValues("AgencyPhoneNumber", { phone_number }).defects,
  ).toEqual([]);
});
test("removes optional bad email and website without mutating raw input", () => {
  const original = { contact_email: "not an email", name: "Agency" };
  expect(cleanSourceValues("Agency", original).spec).toEqual({
    name: "Agency",
  });
  expect(original.contact_email).toBe("not an email");
  expect(
    cleanSourceValues("LicensingAuthority", {
      website: "https://",
      name: "Authority",
    }).defects,
  ).toEqual([expect.objectContaining({ field: "website", required: false })]);
});
test.each([
  ["CivilCase", "primary_source_url"],
  ["Review", "thumbnail_url"],
  ["Discipline", "document_url"],
  ["CoverageLink", "url"],
  ["CoverageLink", "normalized_url"],
  ["ReviewLink", "url"],
])("validates %s.%s by URL field type", (kind, field) => {
  expect(
    cleanSourceValues(kind, { [field]: "not a URL" }).defects,
  ).toHaveLength(1);
  expect(
    cleanSourceValues(kind, {
      [field]: "https://example.org/evidence?q=1#page",
    }).defects,
  ).toEqual([]);
});
test("accepts valid email, absent fields and null optional values", () => {
  expect(
    cleanSourceValues("Agency", {
      contact_email: "records+request@example.org",
    }).defects,
  ).toEqual([]);
  expect(cleanSourceValues("Agency", { contact_email: null }).defects).toEqual(
    [],
  );
  expect(cleanSourceValues("Review", {}).defects).toEqual([]);
});
test("logs and omits invalid phone records from generation", async () => {
  const logs: string[] = [];
  const context = new DataContext({
    logger: { info: (message) => logs.push(message) },
  });
  context.facadeFromSource("AgencyPhoneNumber", {
    ...source,
    spec: { agency_id: "agency", phone_number: "0000000000" },
  });
  expect(await context.toMutations()).toEqual([]);
  expect(logs.join("\n")).toMatch(
    /source data defect.*test.source.*AgencyPhoneNumber.*one.*phone_number.*0000000000/i,
  );
});
test("cached corrections precede validation", () => {
  const logs: string[] = [];
  const context = new DataContext({
    logger: { info: (message) => logs.push(message) },
    applyPropertyCorrections: (_kind, _id, spec) => ({
      ...spec,
      phone_number: "(703) 697-9603",
    }),
  });
  const facade = context.facadeFromSource("AgencyPhoneNumber", {
    ...source,
    spec: { phone_number: "(000) 000-0000" },
  });
  expect(facade.raw("phone_number")).toBe("(703) 697-9603");
  expect(logs).toEqual([]);
});
test("invalid evidence URL omits dependent links without trying to resolve them", async () => {
  const logs: string[] = [];
  const context = new DataContext({
    logger: { info: (message) => logs.push(message) },
  });
  context.facadeFromSource("CoverageLink", {
    ...source,
    spec: { url: "broken URL", normalized_url: "broken URL" },
  });
  context.facadeFromSource("CoverageLinkAgencyPersonnel", {
    ...source,
    name: "link",
    spec: { coverage_link_id: "one", agency_personnel_id: "assignment" },
  });
  expect(await context.toMutations()).toEqual([]);
  expect(logs.join("\n")).toContain("CoverageLinkAgencyPersonnel");
});

test.each(["", "   "])(
  "canonical source artifacts preserve blank email %j until defect handling",
  async (contact_email) => {
    const { Artifacts, Agencies } =
      await import("../../../src/shared/io/index.js");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const directory = await mkdtemp(join(tmpdir(), "source-defects-"));
    try {
      const written = await Artifacts.write(
        directory,
        Artifacts.new({
          metadata: { name: "contacts", namespace: source.namespace },
          spec: {
            artifacts: [
              {
                kind: "Agencies",
                spec: {
                  records: {
                    one: {
                      spec: {
                        name: "Keep this agency",
                        state: "TX",
                        contact_email,
                      },
                    },
                  },
                },
              },
            ],
          },
        }),
      );
      const loaded = await Artifacts.read(written.path);
      const agency = loaded.spec.artifacts.find(
        (artifact) => artifact.kind === "Agencies",
      )!;
      const record = Agencies.schema.parse({
        apiVersion: INTAKE_API_VERSION,
        kind: "Agencies",
        metadata: { name: "contacts", namespace: source.namespace },
        spec: agency.spec,
      }).spec.records.one;
      if (!("spec" in record)) throw new Error("Expected inline agency");
      const context = new DataContext({});
      const facade = context.facadeFromSource("Agency", {
        ...source,
        spec: record.spec,
      });
      expect(facade.raw("name")).toBe("Keep this agency");
      expect(facade.raw("contact_email")).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
