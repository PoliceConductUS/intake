import { describe, it, expect } from "vitest";
import {
  parseFederalLeAgencies,
  slugify,
} from "../../../sources/gov.us.federal-le/acquire/parse.js";

const page = `
<div id="mw-content-text"><div class="mw-parser-output">
  <div class="mw-heading mw-heading2"><h2 id="Overview">Overview and history<span class="mw-editsection">[edit]</span></h2></div>
  <ul><li><a href="/x">Ignored intro link</a></li></ul>

  <div class="mw-heading mw-heading2"><h2 id="List">List of federal law enforcement agencies and units of agencies<span class="mw-editsection">[edit]</span></h2></div>
  <div class="mw-heading mw-heading3"><h3 id="Exec">Executive branch<span class="mw-editsection">[edit]</span></h3></div>
  <div class="mw-heading mw-heading4"><h4 id="DOJ">Department of Justice<span class="mw-editsection">[edit]</span></h4></div>
  <ul>
    <li><a href="/fbi">Federal Bureau of Investigation</a> (FBI)
      <ul><li><a href="/fbipd">FBI Police</a></li></ul>
    </li>
    <li><a href="/dea">Drug Enforcement Administration</a></li>
  </ul>
  <div class="mw-heading mw-heading4"><h4 id="DHS">Department of Homeland Security<span class="mw-editsection">[edit]</span></h4></div>
  <ul><li><a href="/ice">U.S. Immigration and Customs Enforcement</a></li></ul>

  <div class="mw-heading mw-heading2"><h2 id="Former">List of former agencies and units of agencies<span class="mw-editsection">[edit]</span></h2></div>
  <ul><li><a href="/gone">Defunct Bureau</a></li></ul>
</div></div>`;

describe("slugify", () => {
  it("drops parentheticals and hyphenates", () => {
    expect(slugify("Federal Bureau of Investigation (FBI)")).toBe(
      "federal-bureau-of-investigation",
    );
  });
});

describe("parseFederalLeAgencies", () => {
  it("returns the flat agency list within the main section, including nested units", () => {
    const { agencies } = parseFederalLeAgencies(page);
    expect(agencies).toEqual([
      "Federal Bureau of Investigation",
      "FBI Police",
      "Drug Enforcement Administration",
      "U.S. Immigration and Customs Enforcement",
    ]);
  });

  it("excludes the overview and former-agencies sections", () => {
    const { agencies } = parseFederalLeAgencies(page);
    expect(agencies).not.toContain("Ignored intro link");
    expect(agencies).not.toContain("Defunct Bureau");
  });
});
