import { expect, test } from "vitest";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import {
  MAX_RANGE_YEARS,
  cleanSourceValues,
} from "../../../src/shared/source-value-types.js";

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

// INS-88: a published profile stated that a named Contract Jailer separated on
// 2109-02-27 from a 2015 start. The value is TCOLE's own -- the hash-verified
// 2025-02-10 production carries it, along with 24 rows whose END_DATE precedes
// its ST_DATE. Ingest has to say so rather than leaving it to be found on a live
// page.
test("reports an end_date that precedes its own start_date", () => {
  const result = cleanSourceValues("AgencyPersonnel", {
    agency_id: "245825",
    personnel_id: "1491092",
    title: "Peace Officer",
    start_date: "2024-10-24",
    end_date: "2023-10-23",
  });
  expect(result.defects).toEqual([
    expect.objectContaining({
      field: "end_date",
      value: "2023-10-23",
      required: false,
      omitted: false,
      reason: expect.stringContaining("precedes start_date"),
    }),
  ]);
  // Kept, not dropped: end_date is null means "currently employed", so dropping
  // an impossible separation date would publish a false present-tense claim.
  expect(result.spec.end_date).toBe("2023-10-23");
});
test("reports an end_date a lifetime after its start_date", () => {
  const result = cleanSourceValues("AgencyPersonnel", {
    agency_id: "245825",
    personnel_id: "1491092",
    title: "Contract Jailer",
    start_date: "2015-04-22",
    end_date: "2109-02-27",
  });
  expect(result.defects).toEqual([
    expect.objectContaining({
      field: "end_date",
      value: "2109-02-27",
      omitted: false,
      reason: expect.stringContaining(`${MAX_RANGE_YEARS}-year limit`),
    }),
  ]);
  expect(result.spec.end_date).toBe("2109-02-27");
});
test.each([
  ["2015-04-22", "2019-02-27"],
  // The longest genuine completed assignment measured in the corpus.
  ["1974-01-15", "2024-11-01"],
  // A one-day appointment is real, not a defect.
  ["2024-06-03", "2024-06-03"],
  // A scheduled separation is the build clock's problem, not the importer's.
  ["2024-01-01", "2030-01-01"],
])("accepts the plausible range %s to %s", (start_date, end_date) => {
  expect(
    cleanSourceValues("AgencyPersonnel", {
      agency_id: "a",
      personnel_id: "p",
      title: "Peace Officer",
      start_date,
      end_date,
    }).defects,
  ).toEqual([]);
});
test.each([
  { start_date: "2015-04-22" },
  { start_date: "2015-04-22", end_date: null },
  { start_date: "2015-04-22", end_date: "" },
  { start_date: "2015-04-22", end_date: "not a date" },
  { end_date: "2019-02-27" },
])("has nothing to compare in %j", (dates) => {
  expect(
    cleanSourceValues("AgencyPersonnel", {
      agency_id: "a",
      personnel_id: "p",
      title: "Peace Officer",
      ...dates,
    }).defects,
  ).toEqual([]);
});
test("logs a retained date defect without omitting the record", () => {
  const logs: string[] = [];
  const context = new DataContext({
    logger: { info: (message) => logs.push(message) },
  });
  const facade = context.facadeFromSource("AgencyPersonnel", {
    ...source,
    spec: {
      agency_id: "245825",
      personnel_id: "1491092",
      title: "Contract Jailer",
      start_date: "2015-04-22",
      end_date: "2109-02-27",
    },
  });
  expect(logs.join("\n")).toMatch(
    /source data defect.*AgencyPersonnel.*end_date.*2109-02-27.*70-year limit.*value kept, not publishable/,
  );
  // Unlike an invalid phone number, this neither strips the value nor drops the
  // assignment: the person did serve, and the start date is sound.
  expect(facade.raw("end_date")).toBe("2109-02-27");
  expect(facade.raw("start_date")).toBe("2015-04-22");
});
