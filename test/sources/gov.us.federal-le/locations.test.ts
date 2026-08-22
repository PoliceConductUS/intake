import { describe, it, expect } from "vitest";
import { mergeLocationStubs } from "../../../sources/gov.us.federal-le/locations.js";

describe("mergeLocationStubs", () => {
  it("adds blank stubs for new agencies and preserves curated entries", () => {
    const existing = [
      {
        slug: "federal-bureau-of-investigation",
        name: "Federal Bureau of Investigation (FBI)",
        state: "DC",
        city: "Washington",
        address: "935 Pennsylvania Avenue NW",
        zip_code: "20535",
      },
    ];
    const { agencies, added } = mergeLocationStubs(existing, [
      {
        slug: "federal-bureau-of-investigation",
        name: "Federal Bureau of Investigation (FBI)",
      },
      { slug: "drug-enforcement-administration", name: "DEA" },
    ]);

    expect(added).toEqual(["drug-enforcement-administration"]);
    // Curated FBI entry is untouched; DEA is a blank stub; sorted by slug.
    expect(agencies).toEqual([
      {
        slug: "drug-enforcement-administration",
        name: "DEA",
        state: "",
        city: "",
        address: "",
        zip_code: "",
      },
      existing[0],
    ]);
  });

  it("adds nothing when every discovered agency is already listed", () => {
    const existing = [
      {
        slug: "a",
        name: "A",
        state: "DC",
        city: "X",
        address: "Y",
        zip_code: "1",
      },
    ];
    const { added } = mergeLocationStubs(existing, [{ slug: "a", name: "A" }]);
    expect(added).toEqual([]);
  });
});
