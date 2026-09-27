import { expect, test } from "vitest";
import {
  selectAgencyGraph,
  graphKey,
  type AgencyGraphRecord,
} from "../../../src/cli/import/artifacts/agency-graph.js";

const node = (
  kind: string,
  id: string,
  values: Record<string, unknown> = {},
): AgencyGraphRecord => ({ kind, id, values });
const selected = (
  incoming: AgencyGraphRecord[],
  existing: AgencyGraphRecord[] = [],
) => [...selectAgencyGraph(existing, incoming)].sort();

test("open assignments root agencies, retaining history without following a shared person to another agency", () => {
  expect(
    selected([
      node("Agency", "a"),
      node("Agency", "b"),
      node("Agency", "empty"),
      node("AgencyPersonnel", "open", {
        agency_id: "a",
        personnel_id: "p",
        end_date: null,
      }),
      node("AgencyPersonnel", "past", {
        agency_id: "a",
        personnel_id: "q",
        end_date: "2020-01-01",
      }),
      node("AgencyPersonnel", "elsewhere", {
        agency_id: "b",
        personnel_id: "p",
        end_date: "2021-01-01",
      }),
      node("Personnel", "p"),
      node("Personnel", "q"),
      node("Personnel", "unassigned"),
    ]),
  ).toEqual([
    "Agency:a",
    "AgencyPersonnel:open",
    "AgencyPersonnel:past",
    "Personnel:p",
    "Personnel:q",
  ]);
});

test("only explicit null qualifies a new agency", () => {
  expect(
    selected([
      node("Agency", "a"),
      node("AgencyPersonnel", "missing", { agency_id: "a", personnel_id: "p" }),
      node("AgencyPersonnel", "blank", {
        agency_id: "a",
        personnel_id: "p",
        end_date: "",
      }),
      node("Personnel", "p"),
    ]),
  ).toEqual([]);
});

test("the dataset closing the last assignment retains its agency as a root", () => {
  expect(
    selected(
      [
        node("AgencyPersonnel", "job", { end_date: "2026-01-01" }),
        node("AgencyLink", "new-link", { agency_id: "a" }),
      ],
      [
        node("Agency", "a"),
        node("Personnel", "p"),
        node("AgencyPersonnel", "job", {
          agency_id: "a",
          personnel_id: "p",
          end_date: null,
        }),
      ],
    ),
  ).toEqual([
    "Agency:a",
    "AgencyLink:new-link",
    "AgencyPersonnel:job",
    "Personnel:p",
  ]);
});

test("a shared case qualifies both agencies including one with only historical assignments", () => {
  const incoming = [
    node("CivilCasePersonnel", "included-link", {
      agency_personnel_id: "job",
      civil_case_id: "case",
    }),
    node("CivilCasePersonnel", "other-link", {
      agency_personnel_id: "other-job",
      civil_case_id: "case",
    }),
    node("CivilCase", "case"),
    node("CivilCaseLink", "evidence", { civil_case_id: "case" }),
    node("ReviewPersonnel", "review-link", {
      agency_personnel_id: "job",
      review_id: "review",
    }),
    node("Review", "review"),
    node("ReviewLink", "video", { review_id: "review" }),
  ];
  const found = selectAgencyGraph(
    [
      node("Agency", "a"),
      node("Agency", "b"),
      node("Personnel", "p"),
      node("AgencyPersonnel", "job", {
        agency_id: "a",
        personnel_id: "p",
        end_date: null,
      }),
      node("AgencyPersonnel", "other-job", {
        agency_id: "b",
        personnel_id: "p",
        end_date: "2020-01-01",
      }),
    ],
    incoming,
  );
  expect(
    incoming.filter((r) => found.has(graphKey(r))).map((r) => r.id),
  ).toEqual([
    "included-link",
    "other-link",
    "case",
    "evidence",
    "review-link",
    "review",
    "video",
  ]);
});

test("licenses and actions follow personnel while state authority data stays independent", () => {
  const incoming = [
    node("Agency", "a"),
    node("Personnel", "p"),
    node("Personnel", "q"),
    node("AgencyPersonnel", "job", {
      agency_id: "a",
      personnel_id: "p",
      end_date: null,
    }),
    node("License", "yes", { personnel_id: "p", authority_license_id: "type" }),
    node("License", "no", { personnel_id: "q", authority_license_id: "type" }),
    node("LicenseAction", "action", { license_id: "yes" }),
    node("LicenseAction", "other-action", { license_id: "no" }),
    node("AuthorityLicense", "type"),
    node("LicensingAuthority", "authority"),
    node("LocationPath", "state"),
  ];
  const found = selectAgencyGraph([], incoming);
  expect(
    incoming.filter((r) => found.has(graphKey(r))).map((r) => r.id),
  ).toEqual(["a", "p", "job", "yes", "action", "type", "authority", "state"]);
});

test("a case root includes all assignments at its agency, not just the assignment named in the case", () => {
  expect(
    selected([
      node("Agency", "historical"),
      node("Personnel", "defendant"),
      node("Personnel", "colleague"),
      node("AgencyPersonnel", "case-job", {
        agency_id: "historical",
        personnel_id: "defendant",
        end_date: "2020-01-01",
      }),
      node("AgencyPersonnel", "other-job", {
        agency_id: "historical",
        personnel_id: "colleague",
        end_date: "2019-01-01",
      }),
      node("CivilCasePersonnel", "case-link", {
        agency_personnel_id: "case-job",
        civil_case_id: "case",
      }),
      node("CivilCase", "case"),
    ]),
  ).toEqual([
    "Agency:historical",
    "AgencyPersonnel:case-job",
    "AgencyPersonnel:other-job",
    "CivilCase:case",
    "CivilCasePersonnel:case-link",
    "Personnel:colleague",
    "Personnel:defendant",
  ]);
});

test("reachable records cannot retain a reference to a deliberately unselected candidate", () => {
  expect(() =>
    selected([
      node("Agency", "a"),
      node("Personnel", "p"),
      node("Personnel", "q"),
      node("AgencyPersonnel", "job", {
        agency_id: "a",
        personnel_id: "p",
        license_id: "license",
        end_date: null,
      }),
      node("License", "license", { personnel_id: "q" }),
    ]),
  ).toThrow(/License:license.*personnel_id.*Personnel:q/);
});

test("a later dataset retains updates to stored history without selecting new descendants of an unqualified agency", () => {
  expect(
    selected(
      [
        node("Personnel", "p", { first_name: "Corrected" }),
        node("AgencyLink", "later", { agency_id: "a" }),
      ],
      [
        node("Agency", "a"),
        node("Personnel", "p"),
        node("AgencyPersonnel", "job", {
          agency_id: "a",
          personnel_id: "p",
          end_date: "2026-01-01",
        }),
      ],
    ),
  ).toEqual(["Agency:a", "AgencyPersonnel:job", "Personnel:p"]);
});

test("explicit roots traverse historical descendants, union ordinary roots, and never fabricate missing agencies", () => {
  const incoming = [
    node("Agency", "historical"),
    node("Agency", "open"),
    node("Agency", "unlisted"),
    node("AgencyPersonnel", "past-job", {
      agency_id: "historical",
      personnel_id: "past-person",
      end_date: "2000-01-01",
    }),
    node("Personnel", "past-person"),
    node("License", "past-license", { personnel_id: "past-person" }),
    node("LicenseAction", "past-action", { license_id: "past-license" }),
    node("AgencyPersonnel", "open-job", {
      agency_id: "open",
      personnel_id: "open-person",
      end_date: null,
    }),
    node("Personnel", "open-person"),
  ];
  expect(
    [...selectAgencyGraph([], incoming, ["historical", "absent"])].sort(),
  ).toEqual([
    "Agency:historical",
    "Agency:open",
    "AgencyPersonnel:open-job",
    "AgencyPersonnel:past-job",
    "License:past-license",
    "LicenseAction:past-action",
    "Personnel:open-person",
    "Personnel:past-person",
  ]);
});

test("person-level discipline and education follow an included person without another agency", () => {
  expect(
    selected([
      node("Agency", "a"),
      node("Agency", "b"),
      node("AgencyPersonnel", "open", {
        agency_id: "a",
        personnel_id: "p",
        end_date: null,
      }),
      node("AgencyPersonnel", "past", {
        agency_id: "b",
        personnel_id: "p",
        end_date: "2020-01-01",
      }),
      node("Personnel", "p"),
      node("Personnel", "unassigned"),
      node("Discipline", "action", { personnel_id: "p" }),
      node("Discipline", "excluded-action", { personnel_id: "unassigned" }),
      node("PersonnelEducation", "course", { personnel_id: "p" }),
      node("PersonnelEducation", "excluded-course", {
        personnel_id: "unassigned",
      }),
    ]),
  ).toEqual([
    "Agency:a",
    "AgencyPersonnel:open",
    "Discipline:action",
    "Personnel:p",
    "PersonnelEducation:course",
  ]);
});
