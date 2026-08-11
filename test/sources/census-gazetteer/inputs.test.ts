import { describe, it, expect } from "vitest";
import { matchInputs } from "../../../sources/census-gazetteer/lib/inputs.js";

const validPaths = [
  "/data/2025_Gaz_state_national.zip",
  "/data/2025_Gaz_counties_national.zip",
  "/data/2025_Gaz_place_national.zip",
  "/data/tl_2025_us_state.zip",
  "/data/tl_2025_us_county.zip",
  "/data/tl_2025_48_place.zip",
  "/data/tl_2025_06_place.zip",
];

describe("matchInputs", () => {
  it("classifies a full valid set into all roles with the extracted year", () => {
    const result = matchInputs(validPaths);
    expect(result).toEqual({
      statesZip: "/data/2025_Gaz_state_national.zip",
      adminAreasZip: "/data/2025_Gaz_counties_national.zip",
      placesZip: "/data/2025_Gaz_place_national.zip",
      stateTigerZip: "/data/tl_2025_us_state.zip",
      countyTigerZip: "/data/tl_2025_us_county.zip",
      placeTigerZips: ["/data/tl_2025_48_place.zip", "/data/tl_2025_06_place.zip"],
      hierarchyFile: undefined,
      year: "2025",
    });
  });

  it("includes an optional hierarchy file when present", () => {
    const result = matchInputs([...validPaths, "/data/us_rel2025.txt"]);
    expect(result.hierarchyFile).toBe("/data/us_rel2025.txt");
  });

  it("throws a clear error naming the missing role when a singleton is missing", () => {
    const missingStateTiger = validPaths.filter(
      (p) => !p.includes("tl_2025_us_state"),
    );
    expect(() => matchInputs(missingStateTiger)).toThrow(/stateTigerZip/i);
  });

  it("throws when a singleton role matches more than one file (duplicate places gazetteer)", () => {
    const duplicatePlaces = [...validPaths, "/data/2025_Gaz_place_national_v2.zip"];
    expect(() => matchInputs(duplicatePlaces)).toThrow(/placesZip/i);
  });

  it("throws when no placeTigerZips match", () => {
    const noPlaceTiger = validPaths.filter((p) => !p.includes("_place.zip"));
    expect(() => matchInputs(noPlaceTiger)).toThrow(/placeTigerZips/i);
  });

  it("throws loudly on a year mismatch across matched files", () => {
    const mismatched = [
      ...validPaths.slice(0, -1),
      "/data/tl_2024_06_place.zip",
    ];
    expect(() => matchInputs(mismatched)).toThrow(/year/i);
  });

  it("ignores paths that match no known role", () => {
    const result = matchInputs([...validPaths, "/data/readme.txt"]);
    expect(result.year).toBe("2025");
  });
});
