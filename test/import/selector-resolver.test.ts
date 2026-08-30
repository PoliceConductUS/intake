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
  return async (kind, constraints) =>
    (tables[kind] ?? []).filter((row) =>
      Object.entries(constraints).every(([column, constraint]) =>
        Array.isArray(constraint)
          ? constraint.includes(String(row[column]))
          : String(row[column]) === constraint,
      ),
    );
}

// Irving PD officers, keyed the way the real schema is: agency_personnel holds
// FK ids to agency and personnel, not names — so the selector must hop both FKs.
const IRVING = "irving-agency-id";
const DALLAS = "dallas-agency-id";
// Two people named "Paul Lewis" — one at Irving, one at Dallas — the real case:
// the name is ambiguous, only the agency scopes it to one officer.
const store = rowStore({
  Agency: [
    { id: IRVING, name: "Irving Police Department" },
    { id: DALLAS, name: "Dallas Police Department" },
  ],
  Personnel: [
    { id: "p-markham", first_name: "James", last_name: "Markham" },
    { id: "p-paul-lewis-irving", first_name: "Paul", last_name: "Lewis" },
    { id: "p-antwan-lewis", first_name: "Antwan", last_name: "Lewis" },
    { id: "p-paul-lewis-dallas", first_name: "Paul", last_name: "Lewis" },
  ],
  AgencyPersonnel: [
    { id: "ap-markham", agency_id: IRVING, personnel_id: "p-markham" },
    {
      id: "ap-paul-lewis",
      agency_id: IRVING,
      personnel_id: "p-paul-lewis-irving",
    },
    {
      id: "ap-antwan-lewis",
      agency_id: IRVING,
      personnel_id: "p-antwan-lewis",
    },
    {
      id: "ap-lewis-dallas",
      agency_id: DALLAS,
      personnel_id: "p-paul-lewis-dallas",
    },
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

  it("fails loud when the target row is still ambiguous", async () => {
    // Two Lewises at Irving — the agency join leaves two officers, so it fails at
    // the target (AgencyPersonnel), the row we actually resolve to.
    const selector: Selector = {
      agency: { name: "Irving Police Department" },
      personnel: { last_name: "Lewis" },
    };
    await expect(
      resolveIdBySelector("AgencyPersonnel", selector, store),
    ).rejects.toThrow(/matches 2 AgencyPersonnel rows/);
  });

  it("disambiguates two same-named people by agency (the join, not the name)", async () => {
    // "Paul Lewis" is two people (Irving + Dallas); the personnel hop is ambiguous,
    // but the agency scopes the officer to exactly one.
    const selector: Selector = {
      agency: { name: "Irving Police Department" },
      personnel: { first_name: "Paul", last_name: "Lewis" },
    };
    expect(await resolveIdBySelector("AgencyPersonnel", selector, store)).toBe(
      "ap-paul-lewis",
    );
  });

  it("fails loud when nothing matches", async () => {
    const selector: Selector = {
      agency: { name: "Irving Police Department" },
      personnel: { last_name: "Nobody" },
    };
    await expect(
      resolveIdBySelector("AgencyPersonnel", selector, store),
    ).rejects.toThrow(/no AgencyPersonnel matches/);
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
