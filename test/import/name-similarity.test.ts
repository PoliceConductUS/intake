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
  const officer = (
    first: string,
    last: string,
  ): Record<string, unknown> => ({ first_name: first, last_name: last });

  it("is 1 for an exact first+last match, uncertainty 0", () => {
    expect(
      officerNameConfidence("Steven Nix", officer("Steven", "Nix")),
    ).toEqual({ confidence: 1, uncertainty: 0 });
  });

  it("ignores a middle initial and records it as uncertainty", () => {
    const match = officerNameConfidence("Steven M Nix", officer("Steven", "Nix"));
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
