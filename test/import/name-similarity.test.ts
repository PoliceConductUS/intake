import { describe, it, expect } from "vitest";
import {
  nameSimilarity,
  normalizeName,
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
