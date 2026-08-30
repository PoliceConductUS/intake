import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGazetteerFile } from "../../../sources/us-census-gazetteer/lib/gazetteer-parser.js";

/**
 * Ported from `intake.us-census-gazetteer/test/gazetteer-parser.test.js`.
 * The original called `parseGazetteerFile({ filePath, type })`, which read
 * the file itself; here the rewired signature takes text directly, so each
 * fixture is read up front and its text is passed in.
 */

function fixtureText(name: string): string {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

const statesText = fixtureText("states.psv");
const adminAreasText = fixtureText("admin-areas.psv");
const placesText = fixtureText("places.psv");

describe("parseGazetteerFile", () => {
  it("parses valid Gazetteer state, administrative-area, and place files", () => {
    const states = parseGazetteerFile(statesText, "state");
    const administrativeAreas = parseGazetteerFile(
      adminAreasText,
      "administrative_area",
    );
    const places = parseGazetteerFile(placesText, "place");

    expect(states[0].GEOID).toBe("27");
    expect(administrativeAreas[0].NAME).toBe("Hennepin County");
    expect(places[0].NAME).toBe("Minneapolis city");
  });

  it("reports malformed header context", () => {
    const malformedText =
      "USPS|GEOID|ALAND|AWATER|INTPTLAT|INTPTLONG\nMN|27|1|2|+1|-1\n";

    expect(() => parseGazetteerFile(malformedText, "state")).toThrow(
      /Invalid Gazetteer header: missing NAME/,
    );
  });

  it("reports invalid record values with record context", () => {
    const malformedText =
      "USPS|GEOID|ANSICODE|NAME|ALAND|AWATER|INTPTLAT|INTPTLONG\nMN|bad|02395722|Minneapolis city|138912673|9501845|+44.963324|-093.268320\n";

    expect(() => parseGazetteerFile(malformedText, "place")).toThrow(
      /Invalid Gazetteer place record at record 1: GEOID:/,
    );
  });
});
