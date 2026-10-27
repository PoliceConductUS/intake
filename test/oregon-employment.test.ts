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
describe("Oregon AgencyPersonnel", () => {
  it.each(["LOA", "Mil-LOA", "LveNonCert"])(
    "ends active AgencyPersonnel on %s",
    (action) => {
      const result = buildEmploymentEpisodes(
        [event("2/1/2020", action), event("1/1/2020", "Hired")],
        [affiliation],
      );
      expect(result).toEqual({
        assignments: [
          {
            agencyId: "7",
            startDate: "2020-01-01",
            endDate: "2020-02-01",
            title: "Officer",
          },
        ],
        issues: [],
      });
    },
  );
  it.each(["Return LOA", "Retrn MLOA"])(
    "uses %s to establish AgencyPersonnel at the receiving agency",
    (action) => {
      const result = buildEmploymentEpisodes(
        [
          event("1/30/2026", "Retired", "Lieutenant"),
          event("5/18/2020", action, "Lieutenant"),
          event("10/29/2019", "LOA", "Lieutenant"),
          event("8/22/2017", action, "Lieutenant"),
          {
            ...event("8/21/2017", "DOC-Transf", "Lieutenant"),
            agencyName: "Coffee Creek",
          },
          {
            ...event("1/17/2017", "LOA", "Lieutenant"),
            agencyName: "Coffee Creek",
          },
          {
            ...event("1/1/2010", "Hired", "Lieutenant"),
            agencyName: "Coffee Creek",
          },
        ],
        [
          { ...affiliation, status: "Inactive" },
          {
            ...affiliation,
            agencyName: "Coffee Creek",
            agencyId: "8",
            status: "Inactive",
          },
        ],
      );
      expect(result).toEqual({
        assignments: [
          {
            agencyId: "8",
            startDate: "2010-01-01",
            endDate: "2017-01-17",
            title: "Lieutenant",
          },
          {
            agencyId: "7",
            startDate: "2017-08-22",
            endDate: "2019-10-29",
            title: "Lieutenant",
          },
          {
            agencyId: "7",
            startDate: "2020-05-18",
            endDate: "2026-01-30",
            title: "Lieutenant",
          },
        ],
        issues: [],
      });
    },
  );

  it("preserves overlapping employment under one source label", () => {
    const result = buildEmploymentEpisodes(
      [
        event("10/31/2018", "Resigned", "Dpty Shrf"),
        event("6/30/2017", "Resigned", "Police Off"),
        event("6/19/2017", "Hired", "Dpty Shrf"),
        event("1/12/2015", "Hired", "Police Off"),
      ],
      [{ ...affiliation, status: "Inactive" }],
    );
    expect(result).toEqual({
      assignments: [
        {
          agencyId: "7",
          startDate: "2015-01-12",
          endDate: "2017-06-30",
          title: "Police Off",
        },
        {
          agencyId: "7",
          startDate: "2017-06-19",
          endDate: "2018-10-31",
          title: "Dpty Shrf",
        },
      ],
      issues: [],
    });
  });
  it("does not choose between indistinguishable concurrent hires", () => {
    const result = buildEmploymentEpisodes(
      [
        event("3/1/2020", "Resigned"),
        event("2/1/2020", "Hired"),
        event("1/1/2020", "Hired"),
      ],
      [affiliation],
    );
    expect(result.assignments).toEqual([]);
    expect(result.issues.join(" ")).toContain(
      "matches 2 open AgencyPersonnel records",
    );
    expect(result.issues.join(" ")).not.toContain("without hire");
  });
  it("preserves overlapping employment at separately identified agencies", () => {
    const otherAgency = {
      ...affiliation,
      agencyId: "8",
      agencyName: "County SO",
    };
    const result = buildEmploymentEpisodes(
      [
        { ...event("2/1/2020", "Hired"), agencyName: otherAgency.agencyName },
        event("1/1/2020", "Hired"),
      ],
      [affiliation, otherAgency],
    );
    expect(result.issues).toEqual([]);
    expect(result.assignments).toEqual([
      {
        agencyId: "7",
        startDate: "2020-01-01",
        endDate: null,
        title: "Officer",
      },
      {
        agencyId: "8",
        startDate: "2020-02-01",
        endDate: null,
        title: "Officer",
      },
    ]);
  });
  it("omits internal instructor applications without resolving an agency", () => {
    const result = buildEmploymentEpisodes(
      [{ ...event("1/1/2020", "InstrApp", ""), agencyName: "DPSST Use Only" }],
      [],
    );
    expect(result).toEqual({ assignments: [], issues: [] });
  });
  it("starts restored employment without altering a prior separation", () => {
    const result = buildEmploymentEpisodes(
      [
        event("3/1/2020", "Reinstated", "Sergeant"),
        event("2/1/2020", "Discharged"),
        event("1/1/2020", "Hired"),
      ],
      [affiliation],
    );
    expect(result.issues).toEqual([]);
    expect(result.assignments).toEqual([
      {
        agencyId: "7",
        startDate: "2020-01-01",
        endDate: "2020-02-01",
        title: "Officer",
      },
      {
        agencyId: "7",
        startDate: "2020-03-01",
        endDate: null,
        title: "Sergeant",
      },
    ]);
  });
  it("starts new AgencyPersonnel on reinstatement after leave", () => {
    const result = buildEmploymentEpisodes(
      [
        event("3/1/2020", "Reinstated", "Sergeant"),
        event("2/1/2020", "LOA"),
        event("1/1/2020", "Hired"),
      ],
      [affiliation],
    );
    expect(result.issues).toEqual([]);
    expect(result.assignments).toEqual([
      {
        agencyId: "7",
        startDate: "2020-01-01",
        endDate: "2020-02-01",
        title: "Officer",
      },
      {
        agencyId: "7",
        startDate: "2020-03-01",
        endDate: null,
        title: "Sergeant",
      },
    ]);
  });
  it("uses reinstatement as the first known start without inventing earlier service", () => {
    const result = buildEmploymentEpisodes(
      [event("3/1/2020", "Reinstated")],
      [affiliation],
    );
    expect(result.issues).toEqual([]);
    expect(result.assignments).toEqual([
      {
        agencyId: "7",
        startDate: "2020-03-01",
        endDate: null,
        title: "Officer",
      },
    ]);
  });
  it.each([
    ["CertDenied", "1/1/2020"],
    ["CertDenied", "2/1/2020"],
    ["Cert Riens", "1/1/2020"],
    ["Cert Riens", "2/1/2020"],
    ["CertRevoke", "1/1/2020"],
    ["CertRevoke", "2/1/2020"],
    ["CertSuspnd", "1/1/2020"],
    ["CertSuspnd", "2/1/2020"],
    ["InstrApp", "1/1/2020"],
    ["InstrApp", "2/1/2020"],
  ])("preserves employment through %s on %s", (action, date) => {
    const result = buildEmploymentEpisodes(
      [event(date, action, "Different title"), event("1/1/2020", "Hired")],
      [affiliation],
    );
    expect(result.issues).toEqual([]);
    expect(result.assignments).toEqual([
      {
        agencyId: "7",
        startDate: "2020-01-01",
        endDate: null,
        title: "Officer",
      },
    ]);
  });
  it.each(["CertDenied", "Cert Riens", "CertRevoke", "CertSuspnd", "InstrApp"])(
    "does not create employment from %s alone",
    (action) => {
      const result = buildEmploymentEpisodes(
        [event("1/1/2020", action)],
        [affiliation],
      );
      expect(result).toEqual({ assignments: [], issues: [] });
    },
  );
  it("uses Active to start employment and update an existing title", () => {
    const result = buildEmploymentEpisodes(
      [event("2/1/2020", "Active", "Sergeant"), event("1/1/2020", "Active")],
      [affiliation],
    );
    expect(result.issues).toEqual([]);
    expect(result.assignments).toEqual([
      {
        agencyId: "7",
        startDate: "2020-01-01",
        endDate: null,
        title: "Sergeant",
      },
    ]);
  });
  it.each([
    "Inactive",
    "InactiveAG",
    "Deceased",
    "Terminated",
    "Rtrd Disab",
    "DOC-Transf",
  ])("closes employment on %s", (action) => {
    const result = buildEmploymentEpisodes(
      [event("2/1/2020", action), event("1/1/2020", "Hired")],
      [{ ...affiliation, status: "Inactive" }],
    );
    expect(result.issues).toEqual([]);
    expect(result.assignments).toEqual([
      {
        agencyId: "7",
        startDate: "2020-01-01",
        endDate: "2020-02-01",
        title: "Officer",
      },
    ]);
  });
  it.each(["DPSSTRecla"])(
    "retains employment through %s without inventing a start",
    (action) => {
      const result = buildEmploymentEpisodes(
        [event("2/1/2020", action, "Sergeant"), event("1/1/2020", "Hired")],
        [affiliation],
      );
      expect(result.issues).toEqual([]);
      expect(result.assignments).toEqual([
        {
          agencyId: "7",
          startDate: "2020-01-01",
          endDate: null,
          title: "Sergeant",
        },
      ]);
      const withoutStart = buildEmploymentEpisodes(
        [event("2/1/2020", action)],
        [affiliation],
      );
      expect(withoutStart.assignments).toEqual([]);
      expect(withoutStart.issues).toEqual([
        `City PD: ${action} on 2020-02-01 without hire`,
      ]);
    },
  );
  it("uses explicit hires, retains rank changes and separates rehires", () => {
    const result = buildEmploymentEpisodes(
      [
        event("4/1/2020", "Hired"),
        event("3/1/2020", "Resigned"),
        event("2/1/2020", "Promotion", "Sergeant"),
        event("1/1/2020", "Hired"),
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
  it("does not fabricate a start from a promotion or transfer departure", () => {
    for (const action of ["Promotion", "DOC-Transf", "Mystery"]) {
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
        event("3/1/2020", "LOA", "Sergeant"),
        event("2/1/2020", "Promotion", "Sergeant"),
        hired,
        hired,
      ],
      [affiliation],
    );
    expect(r.assignments).toEqual([
      {
        agencyId: "7",
        startDate: "2020-01-01",
        endDate: "2020-03-01",
        title: "Sergeant",
      },
    ]);
  });
  it("rejects invalid calendar dates", () => {
    expect(() => sourceDate("2/30/2020")).toThrow();
    expect(() => sourceDate("junk")).toThrow();
    expect(sourceDate("2/29/2020")).toBe("2020-02-29");
  });
  it("does not use another officer's active affiliation to open this officer's AgencyPersonnel record", () => {
    const own = { ...affiliation, status: "Inactive" };
    const other = { ...affiliation, officerId: "99", status: "Active" };
    const r = buildEmploymentEpisodes(
      [event("1/1/2020", "Hired")],
      [own],
      [own, other],
    );
    expect(r.assignments).toEqual([]);
    expect(r.issues.join(" ")).toContain(
      "unresolved AgencyPersonnel without an end date",
    );
  });
  it("uses DOC-Transf departure and Transfered arrival as separate agency dates", () => {
    const departing = {
      ...affiliation,
      agencyName: "DOC/Eastern Oregon Correctional Institut",
      status: "Inactive",
    };
    const receiving = {
      ...affiliation,
      agencyName: "DOC/Deer Ridge Correctional Institution",
      agencyId: "8",
      status: "Inactive",
    };
    const result = buildEmploymentEpisodes(
      [
        { ...event("8/31/2022", "Resigned"), agencyName: receiving.agencyName },
        {
          ...event("8/7/2016", "Transfered"),
          agencyName: receiving.agencyName,
        },
        {
          ...event("8/6/2016", "DOC-Transf"),
          agencyName: departing.agencyName,
        },
        { ...event("5/29/2016", "Hired"), agencyName: departing.agencyName },
      ],
      [departing, receiving],
    );
    expect(result.issues).toEqual([]);
    expect(result.assignments).toEqual([
      {
        agencyId: "7",
        startDate: "2016-05-29",
        endDate: "2016-08-06",
        title: "Officer",
      },
      {
        agencyId: "8",
        startDate: "2016-08-07",
        endDate: "2022-08-31",
        title: "Officer",
      },
    ]);
  });
  it("opens employment from arrival without requiring a departure elsewhere", () => {
    const result = buildEmploymentEpisodes(
      [event("8/7/2016", "Transfered")],
      [affiliation],
    );
    expect(result.issues).toEqual([]);
    expect(result.assignments).toEqual([
      {
        agencyId: "7",
        startDate: "2016-08-07",
        endDate: null,
        title: "Officer",
      },
    ]);
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
  it("retains a same-day hire and separation in bottom-to-top source sequence", () => {
    const r = buildEmploymentEpisodes(
      [event("1/1/2020", "Resigned"), event("1/1/2020", "Hired")],
      [affiliation],
    );
    expect(r).toEqual({
      assignments: [
        {
          agencyId: "7",
          startDate: "2020-01-01",
          endDate: "2020-01-01",
          title: "Officer",
        },
      ],
      issues: [],
    });
  });
});

it("uses source sequence for same-day title changes", () => {
  const result = buildEmploymentEpisodes(
    [
      event("4/18/2022", "Reclassed", "Supervisor"),
      event("4/18/2022", "Hired", "Dispatcher"),
    ],
    [affiliation],
  );
  expect(result).toEqual({
    assignments: [
      {
        agencyId: "7",
        startDate: "2022-04-18",
        endDate: null,
        title: "Supervisor",
      },
    ],
    issues: [],
  });
});
