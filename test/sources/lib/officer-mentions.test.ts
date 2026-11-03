import { describe, it, expect } from "vitest";
import { officerMentions } from "../../../sources/lib/officer-mentions.js";

describe("officerMentions", () => {
  it("captures a role-prefixed name and the passage asserting it", () => {
    expect(officerMentions(["Officer John Smith responds to a call."])).toEqual(
      [{ name: "John Smith", passage: "Officer John Smith" }],
    );
  });

  it("matches a role word in any case", () => {
    expect(officerMentions(["OFFICER John Smith"])[0].name).toBe("John Smith");
    expect(officerMentions(["officer John Smith"])[0].name).toBe("John Smith");
  });

  it("recognises the rank vocabulary the sources actually encounter", () => {
    const ranks = [
      "Sergeant Jane Wilson",
      "Deputy Carl Reed",
      "Det. Maria Lopez",
      "Lt. Omar Haddad",
      "Trooper Beth Clark",
      "Sheriff Dan Boone",
    ];
    expect(officerMentions(ranks).map((m) => m.name)).toEqual([
      "Jane Wilson",
      "Carl Reed",
      "Maria Lopez",
      "Omar Haddad",
      "Beth Clark",
      "Dan Boone",
    ]);
  });

  it("keeps each name once, with its first supporting passage", () => {
    // Fields are searched in the order given, so the title's passage wins.
    const mentions = officerMentions([
      "Officer John Smith arrests a man",
      "Sergeant John Smith was also there",
    ]);
    expect(mentions).toEqual([
      { name: "John Smith", passage: "Officer John Smith" },
    ]);
  });

  it("ignores null, undefined, and empty fields", () => {
    expect(officerMentions([null, undefined, ""])).toEqual([]);
    expect(officerMentions([null, "Officer John Smith"])).toHaveLength(1);
  });

  it("stops at the next lowercase word rather than swallowing prose", () => {
    expect(officerMentions(["Officer John Smith responds"])[0].name).toBe(
      "John Smith",
    );
  });

  it("finds no candidate where no one is named", () => {
    expect(officerMentions(["General footage, no one named."])).toEqual([]);
    // A bare role word with no name is not a candidate.
    expect(officerMentions(["The officer drove away."])).toEqual([]);
  });

  it("requires a surname, so a role plus a single first name is not a candidate", () => {
    expect(officerMentions(["Officer John"])).toEqual([]);
  });
});
