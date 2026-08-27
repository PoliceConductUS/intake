import { describe, it, expect } from "vitest";
import {
  resolveIdBySelector,
  type Selector,
  type SelectorRowFinder,
} from "../../src/cli/import/artifacts/facades/selector-resolver.js";

// An in-memory stand-in for the database: rows per kind, matched by exact column
// equality — an independent oracle for the resolver's own constraint-building.
function rowStore(
  tables: Record<string, Array<Record<string, unknown>>>,
): SelectorRowFinder {
  return async (kind, columnValues) =>
    (tables[kind] ?? []).filter((row) =>
      Object.entries(columnValues).every(
        ([column, value]) => String(row[column]) === value,
      ),
    );
}

// Irving PD officers, keyed the way the real schema is: agency_personnel holds
// FK ids to agency and personnel, not names — so the selector must hop both FKs.
const IRVING = "irving-agency-id";
const store = rowStore({
  Agency: [
    { id: IRVING, name: "Irving Police Department" },
    { id: "dallas-agency-id", name: "Dallas Police Department" },
  ],
  Personnel: [
    { id: "p-markham", first_name: "James", last_name: "Markham" },
    { id: "p-paul-lewis", first_name: "Paul", last_name: "Lewis" },
    { id: "p-antwan-lewis", first_name: "Antwan", last_name: "Lewis" },
  ],
  AgencyPersonnel: [
    { id: "ap-markham", agency_id: IRVING, personnel_id: "p-markham" },
    { id: "ap-paul-lewis", agency_id: IRVING, personnel_id: "p-paul-lewis" },
    { id: "ap-antwan-lewis", agency_id: IRVING, personnel_id: "p-antwan-lewis" },
  ],
});

// A store where agency alone leaves two Irving officers — so the many-match fails
// at the AgencyPersonnel level, not a nested hop.
function rowStoreForAgencyOnly(): SelectorRowFinder {
  return rowStore({
    Agency: [{ id: IRVING, name: "Irving Police Department" }],
    AgencyPersonnel: [
      { id: "ap-1", agency_id: IRVING },
      { id: "ap-2", agency_id: IRVING },
    ],
  });
}

describe("resolveIdBySelector", () => {
  it("resolves an officer by hopping the agency and personnel foreign keys", async () => {
    const selector: Selector = {
      agency: { name: "Irving Police Department" },
      personnel: { first_name: "James", last_name: "Markham" },
    };
    expect(await resolveIdBySelector("AgencyPersonnel", selector, store)).toBe(
      "ap-markham",
    );
  });

  it("fails loud when the selector names more than one row", async () => {
    // Two Lewises at Irving — last name alone is ambiguous (the real case). The
    // ambiguity is at the personnel hop (two people), so it fails there, precisely.
    const selector: Selector = {
      agency: { name: "Irving Police Department" },
      personnel: { last_name: "Lewis" },
    };
    await expect(
      resolveIdBySelector("AgencyPersonnel", selector, store),
    ).rejects.toThrow(/matches 2 Personnel rows/);
  });

  it("disambiguates the two Lewises with the first name", async () => {
    const selector: Selector = {
      agency: { name: "Irving Police Department" },
      personnel: { first_name: "Paul", last_name: "Lewis" },
    };
    expect(await resolveIdBySelector("AgencyPersonnel", selector, store)).toBe(
      "ap-paul-lewis",
    );
  });

  it("fails loud when nothing matches (at the failing hop)", async () => {
    const selector: Selector = {
      agency: { name: "Irving Police Department" },
      personnel: { last_name: "Nobody" },
    };
    await expect(
      resolveIdBySelector("AgencyPersonnel", selector, store),
    ).rejects.toThrow(/no Personnel matches/);
  });

  it("fails loud when the ambiguity is at the target row itself", async () => {
    // agency alone matches both Irving officers at the AgencyPersonnel level.
    const single = rowStoreForAgencyOnly();
    await expect(
      resolveIdBySelector(
        "AgencyPersonnel",
        { agency: { name: "Irving Police Department" } },
        single,
      ),
    ).rejects.toThrow(/matches 2 AgencyPersonnel rows/);
  });

  it("rejects a scalar where a nested selector is required", async () => {
    const selector = {
      agency: "Irving Police Department",
    } as unknown as Selector;
    await expect(
      resolveIdBySelector("AgencyPersonnel", selector, store),
    ).rejects.toThrow(/'agency' is a foreign key and needs a nested selector/);
  });
});
