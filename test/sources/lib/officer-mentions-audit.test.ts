import { describe, it, expect } from "vitest";
import { officerMentions } from "../../../sources/lib/officer-mentions.js";

describe("officerMentions", () => {
  it("captures a role-prefixed Title-case name and its passage", () => {
    expect(officerMentions(["Officer John Smith responds to a call."])).toEqual(
      [{ name: "John Smith", passage: "Officer John Smith" }],
    );
  });

  it("matches the role prefix case-insensitively", () => {
    expect(officerMentions(["OFFICER John Smith"])[0].name).toBe("John Smith");
    expect(officerMentions(["sergeant Jane Wilson"])[0].name).toBe(
      "Jane Wilson",
    );
  });

  it("reads fields in order and keeps the first passage for a repeated name", () => {
    expect(
      officerMentions([
        "Deputy Jane Wilson on scene",
        "Sergeant Jane Wilson later",
      ]),
    ).toEqual([{ name: "Jane Wilson", passage: "Deputy Jane Wilson" }]);
  });

  it("returns each distinct officer once", () => {
    expect(
      officerMentions([
        "Officer John Smith and Detective Ann Lee",
        "Trooper Ann Lee",
      ]).map((mention) => mention.name),
    ).toEqual(["John Smith", "Ann Lee"]);
  });

  it("rejects a candidate that reads as an institution", () => {
    expect(officerMentions(["Chiefs Police Department"])).toEqual([]);
  });

  it("leaves a role phrase that reads like a name to the roster resolver", () => {
    // Nothing in the text says "Involved Shooting Unit" is not a person; only the
    // agency roster can, which is the resolver's job (#52). Extraction produces
    // candidates, never links.
    expect(officerMentions(["Officer Involved Shooting Unit"])).toEqual([
      {
        name: "Involved Shooting Unit",
        passage: "Officer Involved Shooting Unit",
      },
    ]);
  });

  it("finds nothing in text that names no officer", () => {
    expect(officerMentions(["General footage, no one named."])).toEqual([]);
    expect(officerMentions([""])).toEqual([]);
  });
});
