import { describe, it, expect } from "vitest";
import {
  isFixtureAgencyName,
  isFixtureGivenName,
  isNonNameValue,
  normalizeNameSuffix,
} from "../../../sources/lib/person-name-quality.js";

describe("normalizeNameSuffix", () => {
  it("keeps a generational suffix", () => {
    expect(normalizeNameSuffix("Jr")).toEqual({ suffix: "Jr", rejected: null });
    expect(normalizeNameSuffix("III")).toEqual({
      suffix: "III",
      rejected: null,
    });
    expect(normalizeNameSuffix("sr.")).toEqual({
      suffix: "sr.",
      rejected: null,
    });
  });

  it("treats a blank or missing suffix as absent", () => {
    for (const value of ["", "   ", null, undefined]) {
      expect(normalizeNameSuffix(value)).toEqual({
        suffix: null,
        rejected: null,
      });
    }
  });

  // The defect this exists for: TCOLE's SFX column carries these, and they were
  // published as part of real officers' names.
  it("rejects an in-band placeholder instead of storing it", () => {
    for (const value of ["N/A", "n/a", "N/a"]) {
      expect(normalizeNameSuffix(value)).toEqual({
        suffix: null,
        rejected: value,
      });
    }
  });

  it("rejects a badge number parked in the suffix column", () => {
    for (const value of ["155", "1", "5", "6"]) {
      expect(normalizeNameSuffix(value)).toEqual({
        suffix: null,
        rejected: value,
      });
    }
  });

  // "111" is almost certainly a mis-keyed "III", but inferring that would put
  // our guess where a public record belongs.
  it("does not silently convert 111 into III", () => {
    expect(normalizeNameSuffix("111")).toEqual({
      suffix: null,
      rejected: "111",
    });
  });
});

describe("isFixtureGivenName", () => {
  it("identifies a fixture given name", () => {
    for (const value of ["Test", "test", "User", "Demo", "qwerty", "XXX"]) {
      expect(isFixtureGivenName(value)).toBe(true);
    }
  });

  // Matching on these would unpublish real officers, which is the failure this
  // rule is shaped to avoid — so the rule only ever looks at the given name,
  // and only at values that are not plausible given names.
  it("does not treat real given names as fixtures", () => {
    for (const value of [
      "Chester",
      "Jessica",
      "Roger",
      "Benjamin",
      "Linnea",
      "Lysander",
      "",
      null,
      undefined,
    ]) {
      expect(isFixtureGivenName(value)).toBe(false);
    }
  });
});

describe("isFixtureAgencyName", () => {
  it("matches the fixture department regardless of punctuation", () => {
    for (const value of [
      "Central Texas Police Dept.",
      "Central Texas Police Dept",
      "central texas police dept.",
      "  Central  Texas   Police Dept.  ",
    ]) {
      expect(isFixtureAgencyName(value)).toBe(true);
    }
  });

  it("does not match real departments", () => {
    for (const value of [
      "Central Texas College Police Department",
      "Austin Police Department",
      "Texas Department of Public Safety",
      "",
      null,
      undefined,
    ]) {
      expect(isFixtureAgencyName(value)).toBe(false);
    }
  });
});

describe("isNonNameValue", () => {
  it("flags a value with no letters", () => {
    for (const value of ["9", "111", "-", "'", "."]) {
      expect(isNonNameValue(value)).toBe(true);
    }
  });

  it("accepts anything containing a letter, including non-Latin scripts", () => {
    for (const value of ["Ruben", "O'Hara", "Ng", "Åke", "李", "", null]) {
      expect(isNonNameValue(value)).toBe(false);
    }
  });
});
