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
  });
});
