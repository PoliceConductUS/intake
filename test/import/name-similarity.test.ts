import { describe, it, expect } from "vitest";
import {
  nameSimilarity,
  normalizeName,
  officerNameVariations,
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

describe("officerNameVariations", () => {
  it("produces first-last, first-middle-last, and suffix forms so a middle initial does not hurt matching", () => {
    const variations = officerNameVariations({
      first_name: "Scott",
      middle_name: "D",
      last_name: "Garner",
      suffix: "Jr",
    });
    expect(variations).toContain("Scott Garner");
    expect(variations).toContain("Scott D Garner");
    expect(variations).toContain("Scott D Garner Jr");
    // a first-last variation matches a query without the middle initial exactly
    const best = variations.reduce(
      (max, v) => Math.max(max, nameSimilarity("Scott Garner", v)),
      0,
    );
    expect(best).toBe(1);
  });

  it("omits missing parts without empty tokens", () => {
    expect(
      officerNameVariations({ first_name: "Robert", last_name: "Luna" }),
    ).toEqual(["Robert Luna", "Luna Robert"]);
  });
});
