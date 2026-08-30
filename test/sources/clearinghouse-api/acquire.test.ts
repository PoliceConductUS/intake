import { describe, it, expect } from "vitest";
import { isNoResults } from "../../../sources/clearinghouse-api/acquire.js";

// The Clearinghouse API returns HTTP 400 with a `["No results for {...}"]` body
// for a zero-match search — a normal empty result, not a failure. Independent
// oracle: the literal shape observed from the live API.
describe("isNoResults", () => {
  it("recognizes the API's no-results 400 shape", () => {
    expect(
      isNoResults(400, [
        "No results for {'text': 'Spring Valley Police Department', 'state': '5859', 'case_type': '5039'}",
      ]),
    ).toBe(true);
  });

  it("is false for a 400 that is a real error, not a no-results marker", () => {
    expect(isNoResults(400, { detail: "Invalid state id." })).toBe(false);
    expect(isNoResults(400, ["Some other message"])).toBe(false);
  });

  it("is false for non-400 statuses even with a no-results-shaped body", () => {
    expect(isNoResults(200, ["No results for {...}"])).toBe(false);
    expect(isNoResults(429, ["No results for {...}"])).toBe(false);
  });
});
