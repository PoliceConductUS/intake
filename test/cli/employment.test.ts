import { expect, it } from "vitest";
import {
  reconstructEmployment,
  type EmploymentEventInput,
} from "../../src/cli/transform/employment.js";

const affiliation = {
  agencyId: "agency",
  agencyName: "Employer",
  active: true,
};
const event = (
  date: string,
  action: EmploymentEventInput["action"],
  rank: string,
): EmploymentEventInput => ({
  date,
  action,
  rank,
  sourceAction: action,
  agencyName: affiliation.agencyName,
  classification: "",
  assignment: "",
});

it("matches concurrent periods by position independently of hire order", () => {
  const result = reconstructEmployment(
    [
      event("2020-01-01", "start", "Officer"),
      event("2020-02-01", "start", "Deputy"),
      event("2020-03-01", "start", "Dispatcher"),
      event("2020-04-01", "continue", "Deputy"),
      event("2020-05-01", "end", "Deputy"),
      event("2020-06-01", "end", "Dispatcher"),
      event("2020-07-01", "end", "Officer"),
    ],
    [affiliation],
  );
  expect(result).toEqual({
    assignments: [
      {
        agencyId: "agency",
        startDate: "2020-02-01",
        endDate: "2020-05-01",
        title: "Deputy",
      },
      {
        agencyId: "agency",
        startDate: "2020-03-01",
        endDate: "2020-06-01",
        title: "Dispatcher",
      },
      {
        agencyId: "agency",
        startDate: "2020-01-01",
        endDate: "2020-07-01",
        title: "Officer",
      },
    ],
    issues: [],
    rows: [
      "assigned",
      "assigned",
      "assigned",
      "assigned",
      "assigned",
      "assigned",
      "assigned",
    ],
  });
});

it("does not invent a match for a position change during concurrent employment", () => {
  const result = reconstructEmployment(
    [
      event("2020-01-01", "start", "Officer"),
      event("2020-02-01", "start", "Deputy"),
      event("2020-03-01", "continue", "Sergeant"),
    ],
    [affiliation],
  );
  expect(result.assignments).toEqual([]);
  expect(result.issues.join("\n")).toContain(
    "matches 0 open AgencyPersonnel records",
  );
});

it("honors supplied sequence instead of sorting by date", () => {
  const result = reconstructEmployment(
    [
      event("2020-01-01", "start", "Officer"),
      event("2020-03-01", "continue", "Sergeant"),
      event("2020-02-01", "continue", "Lieutenant"),
    ],
    [affiliation],
  );
  expect(result).toEqual({
    assignments: [
      {
        agencyId: "agency",
        startDate: "2020-01-01",
        endDate: null,
        title: "Lieutenant",
      },
    ],
    issues: [],
    rows: ["assigned", "assigned", "assigned"],
  });
});

it.each([
  {
    name: "a change with no start",
    events: [event("2020-01-01", "continue", "Sergeant")],
    rows: ["no-start"],
  },
  {
    name: "a row identical to an earlier row",
    events: [
      event("2020-01-01", "start", "Officer"),
      event("2020-01-01", "start", "Officer"),
      event("2020-02-01", "end", "Officer"),
    ],
    rows: ["assigned", "repeated", "assigned"],
  },
  {
    name: "a separation after the employment ended",
    events: [
      event("2020-01-01", "start", "Officer"),
      event("2020-02-01", "end", "Officer"),
      event("2020-03-01", "end", "Officer"),
    ],
    rows: ["assigned", "assigned", "ended"],
  },
  {
    name: "a separation after a leave",
    events: [
      event("2020-01-01", "start", "Officer"),
      event("2020-02-01", "leave", "Officer"),
      event("2020-03-01", "end", "Officer"),
      event("2020-04-01", "end", "Officer"),
    ],
    rows: ["assigned", "assigned", "assigned", "ended"],
  },
  {
    name: "a leave with no start",
    events: [event("2020-01-01", "leave", "Officer")],
    rows: ["no-start"],
  },
  {
    name: "a leave during a leave and a leave after a separation",
    events: [
      event("2020-01-01", "start", "Officer"),
      event("2020-02-01", "leave", "Officer"),
      event("2020-03-01", "leave", "Officer"),
      event("2020-04-01", "end", "Officer"),
      event("2020-05-01", "leave", "Officer"),
    ],
    rows: [
      "assigned",
      "assigned",
      "leave-while-inactive",
      "assigned",
      "leave-while-inactive",
    ],
  },
  {
    name: "a separation after a leave of a period with no title",
    events: [
      event("2020-01-01", "start", ""),
      event("2020-02-01", "leave", ""),
      event("2020-03-01", "end", ""),
    ],
    rows: ["untitled-period", "left-out-period", "left-out-period"],
  },
  {
    name: "a separation that fits neither of two periods on leave",
    events: [
      event("2020-01-01", "start", "Officer"),
      event("2020-02-01", "start", "Deputy"),
      event("2020-03-01", "leave", "Officer"),
      event("2020-04-01", "leave", "Deputy"),
      event("2020-05-01", "end", "Sergeant"),
    ],
    rows: [
      "ambiguous-period",
      "ambiguous-period",
      "left-out-period",
      "left-out-period",
      "ambiguous-position",
    ],
  },
  {
    name: "an unresolved action during a period",
    events: [
      event("2020-01-01", "start", "Officer"),
      event("2020-02-01", "unresolved", "Officer"),
      event("2020-03-01", "end", "Officer"),
    ],
    rows: ["ambiguous-period", "unresolved-action", "left-out-period"],
  },
  {
    name: "a change that matches no one open period",
    events: [
      event("2020-01-01", "start", "Officer"),
      event("2020-02-01", "start", "Deputy"),
      event("2020-03-01", "continue", "Sergeant"),
    ],
    rows: ["ambiguous-period", "ambiguous-period", "ambiguous-position"],
  },
  {
    name: "a period with no title",
    events: [event("2020-01-01", "start", ""), event("2020-02-01", "end", "")],
    rows: ["untitled-period", "left-out-period"],
  },
  {
    name: "an open period at an agency where the person is not active",
    events: [
      event("2020-01-01", "start", "Officer"),
      event("2020-02-01", "continue", "Officer"),
    ],
    affiliations: [{ ...affiliation, active: false }],
    rows: ["open-period", "left-out-period"],
  },
  {
    name: "an agency name with two source identities",
    events: [event("2020-01-01", "start", "Officer")],
    agencyAffiliations: [affiliation, { ...affiliation, agencyId: "other" }],
    rows: ["agency-identity"],
  },
])(
  "states the outcome of each row: $name",
  ({ events, affiliations = [affiliation], agencyAffiliations, rows }) => {
    expect(
      reconstructEmployment(events, affiliations, agencyAffiliations).rows,
    ).toEqual(rows);
  },
);

it("ends the one period on leave that a separation's position matches", () => {
  const result = reconstructEmployment(
    [
      event("2020-01-01", "start", "Officer"),
      event("2020-02-01", "start", "Deputy"),
      event("2020-03-01", "leave", "Officer"),
      event("2020-04-01", "leave", "Deputy"),
      event("2020-05-01", "end", "Deputy"),
    ],
    [affiliation],
  );
  expect(result).toEqual({
    assignments: [
      {
        agencyId: "agency",
        startDate: "2020-02-01",
        endDate: "2020-05-01",
        title: "Deputy",
      },
      {
        agencyId: "agency",
        startDate: "2020-01-01",
        endDate: "2020-03-01",
        title: "Officer",
      },
    ],
    issues: [],
    rows: ["assigned", "assigned", "assigned", "assigned", "assigned"],
  });
});

it("ends a period on its leave date when a new start follows the leave", () => {
  const result = reconstructEmployment(
    [
      event("2020-01-01", "start", "Officer"),
      event("2020-02-01", "leave", "Officer"),
      event("2020-03-01", "start", "Officer"),
      event("2020-04-01", "end", "Officer"),
    ],
    [affiliation],
  );
  expect(result.assignments).toEqual([
    {
      agencyId: "agency",
      startDate: "2020-01-01",
      endDate: "2020-02-01",
      title: "Officer",
    },
    {
      agencyId: "agency",
      startDate: "2020-03-01",
      endDate: "2020-04-01",
      title: "Officer",
    },
  ]);
});
