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
  ]),
  migrations: { versions: ["20260927000001"], fingerprint: "fixture" },
};

describe("provider data-request document", () => {
  it("retains provider records but excludes internally derived arrest profiles", () => {
    const doc = generateDataRequestDoc(
      schema,
      "## Raw source-data request model\n",
      "## Data checklist\n",
      "## Standard public-data request\n",
    );
    expect(doc).toContain("### Agency\n");
    expect(doc).not.toContain("### ArrestProfile");
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
