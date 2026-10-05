import { describe, expect, it } from "vitest";
import { isPersonName } from "../../sources/lib/civil-defendants.js";

describe("civil party person-name filter", () => {
  it.each([
    "B. M. Bullin",
    "C. C. Flores",
    "Chief  Mike Gudgel",
    "Chief\t Mike Gudgel",
    "Officer  Bryan Pham",
    "Officer  B. M. Bullin",
    "Officer C. C. Flores",
  ])("allows %s to reach personnel resolution", (name) => {
    expect(isPersonName(name)).toBe(true);
  });
  it.each([
    "Office of Inspector General",
    "City of Houston",
    "Police Department",
    "Officer John Doe",
  ])("still excludes %s", (name) => {
    expect(isPersonName(name)).toBe(false);
  });
});
