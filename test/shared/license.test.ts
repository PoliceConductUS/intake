import { describe, it, expect } from "vitest";
import { canonicalLicenseType } from "../../src/shared/license.js";

describe("canonicalLicenseType", () => {
  it.each([
    ["Peace Officer License", "Peace Officer"],
    ["Peace Officer", "Peace Officer"],
    ["PEACE OFFICER LICENSE", "PEACE OFFICER"],
    ["Telecommunications Operator License", "Telecommunications Operator"],
    // The real TCOLE collision: a stray double space and a missing suffix.
    ["Telecommunications  Operator", "Telecommunications Operator"],
    // Distinct types are NOT merged.
    ["Temporary Jailer License", "Temporary Jailer"],
    ["Grand Father Jailer License", "Grand Father Jailer"],
    ["Elected Official", "Elected Official"],
    [
      "Supervision Officer Firearms Certificate",
      "Supervision Officer Firearms Certificate",
    ],
  ])("%j -> %j", (raw, expected) => {
    expect(canonicalLicenseType(raw)).toBe(expected);
  });

  it("collapses variants of one type to a single canonical value", () => {
    const variants = [
      "Telecommunications Operator License",
      "Telecommunications  Operator",
      "  Telecommunications Operator  ",
    ];
    const canonical = new Set(variants.map(canonicalLicenseType));
    expect(canonical).toEqual(new Set(["Telecommunications Operator"]));
  });
});
