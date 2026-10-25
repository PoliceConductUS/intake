import { describe, expect, it } from "vitest";
import {
  buildEmploymentEpisodes,
  sourceDate,
} from "../sources/gov.or.dpsst/employment.js";
import type {
  EmploymentEvent,
  Affiliation,
} from "../sources/gov.or.dpsst/parse.js";
const event = (
  date: string,
  action: string,
  rank = "Officer",
): EmploymentEvent => ({
  date,
  action,
  rank,
  agencyName: "City PD",
  classification: "",
  assignment: "",
});
const affiliation: Affiliation = {
  officerId: "42",
  name: "Smith, Pat",
  agencyId: "7",
  agencyName: "City PD",
  rank: "Officer",
  status: "Active",
  recordId: "r",
  recordNumber: "1",
  detailUrl: "https://example.com",
};
describe("Oregon employment episodes", () => {
  it("uses explicit hires, retains rank changes and separates rehires", () => {
    const result = buildEmploymentEpisodes(
      [
        event("1/1/2020", "Hired"),
        event("2/1/2020", "Promotion", "Sergeant"),
        event("3/1/2020", "Resigned"),
        event("4/1/2020", "Hired"),
      ],
      [affiliation],
    );
    expect(result.issues).toEqual([]);
    expect(result.assignments).toEqual([
      {
        agencyId: "7",
        startDate: "2020-01-01",
        endDate: "2020-03-01",
        title: "Officer",
      },
      {
        agencyId: "7",
        startDate: "2020-04-01",
        endDate: null,
        title: "Officer",
      },
    ]);
  });
  it("does not fabricate a start from a promotion or transfer", () => {
    for (const action of ["Promotion", "Transfered", "DOC-Transf", "Mystery"]) {
      const r = buildEmploymentEpisodes(
        [event("1/1/2020", action)],
        [affiliation],
      );
      expect(r.assignments).toEqual([]);
      expect(r.issues.length).toBeGreaterThan(0);
    }
  });
  it("omits incomplete inactive and ambiguous duplicate hires", () => {
    for (const events of [
      [event("1/1/2020", "Hired")],
      [event("1/1/2020", "Hired"), event("2/1/2020", "Hired")],
    ]) {
      const r = buildEmploymentEpisodes(events, [
        { ...affiliation, status: "Inactive" },
      ]);
      expect(r.assignments).toEqual([]);
      expect(r.issues.length).toBeGreaterThan(0);
    }
  });
  it("deduplicates repeated evidence and preserves latest dated rank", () => {
    const hired = event("1/1/2020", "Hired");
    const r = buildEmploymentEpisodes(
      [
        hired,
        hired,
        event("2/1/2020", "Promotion", "Sergeant"),
        event("3/1/2020", "LOA", "Sergeant"),
      ],
      [affiliation],
    );
    expect(r.assignments).toEqual([
      {
        agencyId: "7",
        startDate: "2020-01-01",
        endDate: null,
        title: "Sergeant",
      },
    ]);
  });
  it("rejects invalid calendar dates", () => {
    expect(() => sourceDate("2/30/2020")).toThrow();
    expect(() => sourceDate("junk")).toThrow();
    expect(sourceDate("2/29/2020")).toBe("2020-02-29");
  });
  it("does not use another officer's active affiliation to open this officer's episode", () => {
    const own = { ...affiliation, status: "Inactive" };
    const other = { ...affiliation, officerId: "99", status: "Active" };
    const r = buildEmploymentEpisodes(
      [event("1/1/2020", "Hired")],
      [own],
      [own, other],
    );
    expect(r.assignments).toEqual([]);
    expect(r.issues.join(" ")).toContain("unresolved open episode");
  });
  it("omits a hired episode affected by unknown transfer direction", () => {
    const r = buildEmploymentEpisodes(
      [
        event("1/1/2020", "Hired"),
        event("2/1/2020", "DOC-Transf"),
        event("3/1/2020", "Retired"),
      ],
      [affiliation],
    );
    expect(r.assignments).toEqual([]);
    expect(r.issues.join(" ")).toContain("DOC-Transf");
  });
  it("reports missing and nonunique agency identities", () => {
    for (const known of [
      [],
      [affiliation, { ...affiliation, agencyId: "8" }],
    ]) {
      const r = buildEmploymentEpisodes(
        [event("1/1/2020", "Hired")],
        [],
        known,
      );
      expect(r.assignments).toEqual([]);
      expect(r.issues.join(" ")).toMatch(
        /agency name has [02] source identities/,
      );
    }
  });
  it("reports same-day conflicting history without ordering it by action", () => {
    const r = buildEmploymentEpisodes(
      [event("1/1/2020", "Hired"), event("1/1/2020", "Resigned")],
      [affiliation],
    );
    expect(r.assignments).toEqual([]);
    expect(r.issues.join(" ")).toContain("unknown ordering");
  });
});
