import { describe, it, expect } from "vitest";
import {
  parseFederalLeAgencies,
  slugify,
} from "../../../sources/gov.us.federal-le/acquire/parse.js";

const page = `
<div id="mw-content-text"><div class="mw-parser-output">
  <h2>Department of Justice</h2>
  <ul>
    <li><a href="/wiki/FBI">Federal Bureau of Investigation (FBI)</a></li>
    <li><a href="/wiki/DEA">Drug Enforcement Administration (DEA)</a></li>
  </ul>
  <h2>Department of Homeland Security</h2>
  <ul><li><a href="/wiki/ICE">U.S. Immigration and Customs Enforcement (ICE)</a></li></ul>
  <h2>See also</h2>
  <ul><li><a href="/wiki/x">Some unrelated link</a></li></ul>
</div></div>`;

describe("slugify", () => {
  it("drops parentheticals and hyphenates", () => {
    expect(slugify("Federal Bureau of Investigation (FBI)")).toBe(
      "federal-bureau-of-investigation",
    );
    expect(slugify("U.S. Immigration and Customs Enforcement (ICE)")).toBe(
      "u-s-immigration-and-customs-enforcement",
    );
  });
});

describe("parseFederalLeAgencies", () => {
  it("groups agencies under parent departments in document order", () => {
    const { parents } = parseFederalLeAgencies(page);
    expect(parents).toEqual([
      {
        name: "Department of Justice",
        slug: "department-of-justice",
        agencies: [
          "Federal Bureau of Investigation (FBI)",
          "Drug Enforcement Administration (DEA)",
        ],
      },
      {
        name: "Department of Homeland Security",
        slug: "department-of-homeland-security",
        agencies: ["U.S. Immigration and Customs Enforcement (ICE)"],
      },
    ]);
  });

  it("excludes page-structure headings like 'See also'", () => {
    const { parents } = parseFederalLeAgencies(page);
    expect(parents.map((p) => p.name)).not.toContain("See also");
  });
});
