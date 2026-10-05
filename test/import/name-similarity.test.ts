import { describe, it, expect } from "vitest";
import {
  nameSimilarity,
  normalizeName,
  officerNameConfidence,
} from "../../src/cli/import/artifacts/name-similarity.js";

describe("normalizeName", () => {
  it("lowercases, drops punctuation and generational suffixes", () => {
    expect(normalizeName("Ángel Moreno, Jr.")).toBe("ngel moreno");
    expect(normalizeName("Robert  LUNA")).toBe("robert luna");
  });
});

describe("nameSimilarity", () => {
  it("is 1 for identical normalized names and 0 for empty", () => {
    expect(nameSimilarity("Robert Luna", "robert luna")).toBe(1);
    expect(nameSimilarity("", "x")).toBe(0);
  });

  it("rates a close match high and an unrelated name low", () => {
    expect(nameSimilarity("Robert Luna", "Robert Luná")).toBeGreaterThan(0.8);
    expect(nameSimilarity("Robert Luna", "Michael Rabbitt")).toBeLessThan(0.4);
  });

  it("orders a better match above a worse one", () => {
    const better = nameSimilarity("Angel Moreno", "Angel Moreno Jr");
    const worse = nameSimilarity("Angel Moreno", "Andre Martin");
    expect(better).toBeGreaterThan(worse);
  });
});

describe("officerNameConfidence", () => {
  const officer = (first: string, last: string): Record<string, unknown> => ({
    first_name: first,
    last_name: last,
  });

  it("is 1 for an exact first+last match, uncertainty 0", () => {
    expect(
      officerNameConfidence("Steven Nix", officer("Steven", "Nix")),
    ).toEqual({ confidence: 1, uncertainty: 0 });
  });

  it("ignores a middle initial and records it as uncertainty", () => {
    const match = officerNameConfidence(
      "Steven M Nix",
      officer("Steven", "Nix"),
    );
    expect(match.confidence).toBe(1);
    expect(match.uncertainty).toBe(1);
  });

  it("rejects a wrong first name even when the last name matches exactly", () => {
    // "Ana Ramirez" must not resolve to "Juan Ramirez": first names differ.
    const match = officerNameConfidence(
      "Ana Ramirez",
      officer("Juan", "Ramirez"),
    );
    expect(match.confidence).toBeLessThan(0.85);
  });

  it("rejects a wrong last name even when the first name matches exactly", () => {
    const match = officerNameConfidence(
      "Steven Nix",
      officer("Steven", "Nixon"),
    );
    expect(match.confidence).toBeLessThan(1);
  });

  it("matches a reversed 'last first' caption", () => {
    const match = officerNameConfidence("Nix Steven", officer("Steven", "Nix"));
    expect(match.confidence).toBe(1);
  });
});

describe("titled civil-party names", () => {
  it.each([
    ["Officer  Bryan Pham", "Bryan", "Pham"],
    ["Chief\t Mike Gudgel", "Mike", "Gudgel"],
  ])("matches %s using the person's name", (party, first, last) => {
    expect(
      officerNameConfidence(party, { first_name: first, last_name: last }),
    ).toEqual({ confidence: 1, uncertainty: 0 });
  });
});

describe("initial-based personnel matching", () => {
  it.each([
    ["Officer B. M. Bullin", "Blake", "M", "Bullin"],
    ["Officer C. C. Flores", "Christian", "C", "Flores"],
    ["C. Flores", "Christian", "C", "Flores"],
    ["Bullin M. B.", "Blake", "M", "Bullin"],
    ["Blake M Bullin", "B", "M", "Bullin"],
  ])("accepts compatible initials in %s", (party, first, middle, last) => {
    expect(
      officerNameConfidence(party, {
        first_name: first,
        middle_name: middle,
        last_name: last,
      }).confidence,
    ).toBeGreaterThanOrEqual(0.85);
  });
  it("distinguishes matching middle initials from conflicting ones", () => {
    const party = "Officer C. C. Flores";
    expect(
      officerNameConfidence(party, {
        first_name: "Christian",
        middle_name: "C",
        last_name: "Flores",
      }).confidence,
    ).toBeGreaterThanOrEqual(0.85);
    expect(
      officerNameConfidence(party, {
        first_name: "Christopher",
        middle_name: "J",
        last_name: "Flores",
      }).confidence,
    ).toBeLessThan(0.85);
  });
  it("prefers corroborated middle initials over absent middle names", () => {
    const party = "B. M. Bullin";
    const confirmed = officerNameConfidence(party, {
      first_name: "Blake",
      middle_name: "M",
      last_name: "Bullin",
    });
    const missing = officerNameConfidence(party, {
      first_name: "Brett",
      middle_name: null,
      last_name: "Bullin",
    });
    expect(confirmed.uncertainty).toBeLessThan(missing.uncertainty);
  });
  it("does not match conflicting first initials", () => {
    expect(
      officerNameConfidence("C. Flores", {
        first_name: "Michael",
        last_name: "Flores",
      }).confidence,
    ).toBeLessThan(0.85);
  });
});
