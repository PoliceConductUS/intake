import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHierarchyRelationshipFile } from "../../../sources/us-census-gazetteer/lib/hierarchy-parser.js";

/**
 * The original repo (`intake.us-census-gazetteer`) has no
 * `test/hierarchy-parser.test.js` — `parseHierarchyRelationshipFile` was
 * validated only indirectly, via `run.test.js`'s coverage of `loadHierarchy`
 * for the relationship-file path. This is new fixture-based coverage of the
 * ported module, exercising the header-aliasing (`firstPresent` candidate
 * lists), pipe-delimited parsing, default sourceKey minting, and error
 * paths carried over verbatim from the original.
 *
 * The original signature read the file itself
 * (`parseHierarchyRelationshipFile({ filePath, selectedYear })`, via
 * `readFile(filePath, "utf8")`). The rewired signature takes the file text
 * directly (`parseHierarchyRelationshipFile(text, selectedYear)`) — the
 * caller reads it — so each fixture/inline case is read up front and its
 * text is passed in.
 */

function fixtureText(name: string): string {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

describe("parseHierarchyRelationshipFile", () => {
  it("parses a relationship file using the canonical column names", () => {
    const text = fixtureText("hierarchy-relationship.psv");

    const records = parseHierarchyRelationshipFile(text, "2025");

    expect(records).toEqual([
      {
        stateGeoid: "27",
        administrativeAreaGeoid: "27053",
        placeGeoid: "2743000",
        overlapTotalArea: 16000000000000,
        placeName: "Minneapolis",
        placeLabel: "Minneapolis city",
        sourceKey: "us-census-relationship:2025:27:27053:2743000",
      },
      {
        stateGeoid: "27",
        administrativeAreaGeoid: "27053",
        placeGeoid: "2701000",
        overlapTotalArea: 4000000000000,
        placeName: "Anytown",
        placeLabel: "Anytown city",
        sourceKey: "us-census-relationship:2025:27:27053:2701000",
      },
    ]);
  });

  it("aliases Census relationship-file column names and mints a default sourceKey", () => {
    const text = [
      "STATEFP|COUNTYGEOID|PLACEGEOID|AREALAND|PLACE_NAME|NAMELSAD",
      "27|27053|2743000|16000000000000|Minneapolis|Minneapolis city",
    ].join("\n");

    const records = parseHierarchyRelationshipFile(text, 2025);

    expect(records).toEqual([
      {
        stateGeoid: "27",
        administrativeAreaGeoid: "27053",
        placeGeoid: "2743000",
        overlapTotalArea: 16000000000000,
        placeName: "Minneapolis",
        placeLabel: "Minneapolis city",
        sourceKey: "us-census-relationship:2025:27:27053:2743000",
      },
    ]);
  });

  it("falls through to the last candidate in an alias list when earlier candidates are absent", () => {
    // GEOID_COUNTY / GEOID_PLACE are the last candidates in their
    // respective alias lists (after administrativeAreaGeoid, COUNTYGEOID,
    // COUNTY_GEOID / placeGeoid, PLACEGEOID, PLACE_GEOID); AREA is the last
    // candidate for overlapTotalArea (after overlapTotalArea, AREALAND,
    // AREAPT). None of the higher-priority columns are present here.
    const text = [
      "STATE|GEOID_COUNTY|GEOID_PLACE|AREA|NAME_PLACE",
      "27|27053|2743000|500|Minneapolis",
    ].join("\n");

    const records = parseHierarchyRelationshipFile(text, "2025");

    expect(records).toEqual([
      {
        stateGeoid: "27",
        administrativeAreaGeoid: "27053",
        placeGeoid: "2743000",
        overlapTotalArea: 500,
        placeName: "Minneapolis",
        sourceKey: "us-census-relationship:2025:27:27053:2743000",
      },
    ]);
  });

  it("defaults overlapTotalArea to 1 when no area column is present", () => {
    const text = [
      "stateGeoid|administrativeAreaGeoid|placeGeoid",
      "27|27053|2743000",
    ].join("\n");

    const records = parseHierarchyRelationshipFile(text, "2025");

    expect(records[0]?.overlapTotalArea).toBe(1);
  });

  it("throws when the file is empty", () => {
    expect(() => parseHierarchyRelationshipFile("", "2025")).toThrow(
      "Hierarchy relationship file is empty",
    );
    expect(() => parseHierarchyRelationshipFile("   \n", "2025")).toThrow(
      "Hierarchy relationship file is empty",
    );
  });

  it("throws when the header has no data rows", () => {
    expect(() =>
      parseHierarchyRelationshipFile(
        "stateGeoid|administrativeAreaGeoid|placeGeoid\n",
        "2025",
      ),
    ).toThrow("No authoritative Census hierarchy source was acquired");
  });

  it("reports invalid record values with record context", () => {
    const text = [
      "stateGeoid|administrativeAreaGeoid|placeGeoid",
      "bad|27053|2743000",
    ].join("\n");

    expect(() => parseHierarchyRelationshipFile(text, "2025")).toThrow(
      /Invalid hierarchy relationship record at record 1: stateGeoid:/,
    );
  });
});
