import { describe, it, expect } from "vitest";
import { parseDelimited } from "../../../../src/cli/run/parse/delimited.js";
describe("parseDelimited", () => {
  it("parses pipe-delimited text keyed by header", () => {
    const rows = parseDelimited("USPS|GEOID|NAME\nAZ|04|Arizona\n", {
      delimiter: "|",
    });
    expect(rows).toEqual([{ USPS: "AZ", GEOID: "04", NAME: "Arizona" }]);
  });
  it("is deterministic and skips blank trailing lines", () => {
    const t = "A|B\n1|2\n\n";
    expect(parseDelimited(t, { delimiter: "|" })).toEqual([{ A: "1", B: "2" }]);
  });
});
