import { describe, expect, it } from "vitest";
import { generateDataRequestDoc } from "../scripts/lib/data-request-doc-generator.js";
import type {
  IntrospectedSchema,
  IntrospectedTable,
} from "../scripts/lib/schema-introspection.js";

function table(name: string): IntrospectedTable {
  return {
    table: name,
    columns: [{ name: "id", udtName: "text", nullable: false }],
    nonBlankColumns: new Set(),
    enums: new Map(),
    references: new Set(),
    foreignKeys: [],
    primaryKeyColumn: "id",
    uniqueKeys: [],
  };
}
const schema: IntrospectedSchema = {
  tables: new Map([
    ["agency", table("agency")],
    ["arrest_profile", table("arrest_profile")],
    ["agency_arrest_profile", table("agency_arrest_profile")],
    ["personnel_photo", table("personnel_photo")],
    ["data_annotation", table("data_annotation")],
  ]),
  migrations: { versions: ["20260927000001"], fingerprint: "fixture" },
};

describe("provider data-request document", () => {
  it("retains provider records but excludes arrest profiles and personnel photos", () => {
    const doc = generateDataRequestDoc(
      schema,
      "## Raw source-data request model\n",
      "## Data checklist\n",
      "## Standard public-data request\n",
    );
    expect(doc).toContain("### Agency\n");
    expect(doc).not.toContain("### ArrestProfile");
    expect(doc).not.toContain("### AgencyArrestProfile");
    expect(doc).not.toContain("### PersonnelPhoto");
    expect(doc).not.toContain("### DataAnnotation");
  });
  it("does not ask a provider for fields intake records itself", () => {
    const agency = table("agency");
    agency.columns.push(
      { name: "name", udtName: "text", nullable: false },
      { name: "data_source_values", udtName: "jsonb", nullable: false },
      { name: "source_exclusions", udtName: "jsonb", nullable: false },
      { name: "source_namespaces", udtName: "_text", nullable: false },
      { name: "ai_complaint_summary", udtName: "jsonb", nullable: true },
      {
        name: "complaint_summary_unavailability",
        udtName: "jsonb",
        nullable: true,
      },
      { name: "normalized_url", udtName: "text", nullable: false },
      { name: "created_by", udtName: "text", nullable: true },
      { name: "updated_by", udtName: "text", nullable: true },
      { name: "confidence", udtName: "text", nullable: false },
    );
    const doc = generateDataRequestDoc(
      { ...schema, tables: new Map([["agency", agency]]) },
      "## Raw source-data request model\n",
      "## Data checklist\n",
      "## Standard public-data request\n",
    );
    expect(doc).toContain("`name`");
    expect(doc).not.toContain("data_source_values");
    expect(doc).not.toContain("source_exclusions");
    expect(doc).not.toContain("source_namespaces");
    expect(doc).not.toContain("ai_complaint_summary");
    expect(doc).not.toContain("complaint_summary_unavailability");
    expect(doc).not.toContain("normalized_url");
    expect(doc).not.toContain("created_by");
    expect(doc).not.toContain("updated_by");
    expect(doc).not.toContain("confidence");
  });
  it("includes the maintained raw model separately from supported import records", () => {
    const model =
      "## Raw source-data request model\n\nSource model revision: 1\n";
    const checklist = "## Data checklist\n\nIACP categories\n";
    const request = "## Standard public-data request\n\nRecords Custodian:\n";
    const doc = generateDataRequestDoc(schema, model, checklist, request);
    expect(doc).toContain("# Public Data Request\n\n" + request);
    expect(doc.indexOf(request)).toBeLessThan(doc.indexOf(checklist));
    expect(doc).toContain(checklist);
    expect(doc.indexOf(checklist)).toBeLessThan(
      doc.indexOf("## File naming and layout"),
    );
    expect(doc).toContain(model);
    expect(doc.indexOf(model)).toBeLessThan(
      doc.indexOf("## Appendix: Simplified Export Format"),
    );
    expect(doc.lastIndexOf("### Agency")).toBeGreaterThan(
      doc.indexOf("## Appendix: Simplified Export Format"),
    );
    expect(doc).toContain("## Simplified record types");
    expect(doc).toContain("need additional preparation\nbefore import");
    expect(doc).toContain("20260927000001");
  });
});
