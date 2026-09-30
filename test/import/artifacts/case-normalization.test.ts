import { describe, it, expect } from "vitest";
import {
  lowerCaseEmail,
  nameCase,
  titleCase,
} from "../../../src/cli/import/artifacts/case-normalization.js";

describe("titleCase", () => {
  it.each([
    ["SMITHVILLE POLICE DEPT.", "Smithville Police Dept."],
    ["TEXAS DEPARTMENT OF PUBLIC SAFETY", "Texas Department of Public Safety"],
    ["FORT WORTH", "Fort Worth"],
    ["SMITHVILLE", "Smithville"],
    // Acronyms: curated set stays upper, wrapping punctuation preserved.
    ["(FBI)", "(FBI)"],
    ["ATF", "ATF"],
    ["U.S. MARSHALS SERVICE", "U.S. Marshals Service"],
    ["DPS", "DPS"],
    // Addresses: dotted initials + ordinal suffixes.
    ["105 N.W. 4TH STREET", "105 N.W. 4th Street"],
    ["1ST AVENUE", "1st Avenue"],
    ["203 2ND ST.", "203 2nd St."],
    ["3RD AND MAIN", "3rd and Main"],
  ])("cases %j -> %j", (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });

  it("lowercases small connectives except as the first word", () => {
    expect(titleCase("OF COUNSEL")).toBe("Of Counsel");
    expect(titleCase("BOARD OF THE CITY")).toBe("Board of the City");
  });

  it("returns empty string for empty/whitespace input", () => {
    expect(titleCase("")).toBe("");
    expect(titleCase("   ")).toBe("");
  });

  it("is idempotent (already-proper input unchanged)", () => {
    for (const value of [
      "Smithville Police Dept.",
      "Texas Department of Public Safety",
      "U.S. Marshals Service",
      "105 N.W. 4th Street",
      "(FBI)",
    ]) {
      expect(titleCase(value)).toBe(value);
    }
  });
});

describe("nameCase", () => {
  // Expected values are the ACTUAL outputs observed from the `namecase` library
  // (person-name casing is delegated to it, not reimplemented here).
  it.each([
    ["JAMES", "James"],
    ["WALTMON", "Waltmon"],
    ["MCDONALD", "McDonald"],
    ["O'BRIEN", "O'Brien"],
    ["D'ANGELO", "D'Angelo"],
    ["JEAN-PIERRE", "Jean-Pierre"],
    // Roman-numeral suffix stays upper.
    ["III", "III"],
    // Single-letter initial.
    ["D", "D"],
    ["ELI L. NUSBAUM", "Eli L. Nusbaum"],
  ])("cases %j -> %j", (input, expected) => {
    expect(nameCase(input)).toBe(expected);
  });

  it("returns empty string for empty/whitespace input", () => {
    expect(nameCase("")).toBe("");
    expect(nameCase("   ")).toBe("");
  });

  it("is idempotent (feeding proper output back is stable)", () => {
    for (const input of [
      "JAMES",
      "MCDONALD",
      "O'BRIEN",
      "JEAN-PIERRE",
      "III",
      "D",
      "ELI L. NUSBAUM",
    ]) {
      const once = nameCase(input);
      expect(nameCase(once)).toBe(once);
    }
  });
});

describe("lowerCaseEmail", () => {
  it("trims and lowercases", () => {
    expect(lowerCaseEmail("DRepka@CI.Smithville.TX.US")).toBe(
      "drepka@ci.smithville.tx.us",
    );
    expect(lowerCaseEmail("  Contact@Example.COM  ")).toBe(
      "contact@example.com",
    );
  });

  it("returns empty string for empty input", () => {
    expect(lowerCaseEmail("")).toBe("");
  });

  it("is idempotent", () => {
    const once = lowerCaseEmail("DRepka@CI.Smithville.TX.US");
    expect(lowerCaseEmail(once)).toBe(once);
  });
});
