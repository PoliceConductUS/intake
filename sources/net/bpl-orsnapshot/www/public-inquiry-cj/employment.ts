import {
  reconstructEmployment,
  type EmploymentEventInput,
  type EmploymentRowOutcome,
} from "../../../../../src/cli/transform/employment.js";
import type { Affiliation, EmploymentEvent } from "./parse.js";

export function sourceDate(value: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid DPSST date: ${value}`);
  const [, month, day, year] = match;
  const eventDate = `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
  const date = new Date(`${eventDate}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== eventDate
  )
    throw new Error(`Invalid DPSST date: ${value}`);
  return eventDate;
}
const nonEmploymentActions = new Set([
  "CertDenied",
  "Cert Riens",
  "CertRevoke",
  "CertSuspnd",
  "InstrApp",
]);
const separations = new Set([
  "Resigned",
  "Retired",
  "Discharged",
  "Prob Dschg",
  "Layoff",
  "Inactive",
  "InactiveAG",
  "Deceased",
  "Terminated",
  "Rtrd Disab",
  "DOC-Transf",
]);
const leaves = new Set(["LOA", "Mil-LOA", "LveNonCert"]);
const continuations = new Set([
  "Promotion",
  "Demotn Vol",
  "Demotion",
  "Reclassed",
  "Name Chg",
  "Active",
  "Reinstated",
  "DPSSTRecla",
]);

export function buildEmploymentEpisodes(
  events: EmploymentEvent[],
  affiliations: Affiliation[],
  agencyAffiliations: Affiliation[] = affiliations,
) {
  const normalized: EmploymentEventInput[] = [];
  const rows: Array<EmploymentRowOutcome | "certification-action"> = [];
  const sourceRows: number[] = [];
  for (const [index, event] of events.entries()) {
    const date = sourceDate(event.date);
    if (nonEmploymentActions.has(event.action)) {
      rows[index] = "certification-action";
      continue;
    }
    let action: EmploymentEventInput["action"] = "unresolved";
    if (
      event.action === "Hired" ||
      event.action === "Transfered" ||
      event.action === "Return LOA" ||
      event.action === "Retrn MLOA"
    )
      action = "start";
    else if (event.action === "Active" || event.action === "Reinstated")
      action = "restore";
    else if (separations.has(event.action)) action = "end";
    else if (leaves.has(event.action)) action = "leave";
    else if (continuations.has(event.action)) action = "continue";
    normalized.push({ ...event, date, sourceAction: event.action, action });
    sourceRows.push(index);
  }
  const normalizeAffiliation = (affiliation: Affiliation) => ({
    agencyId: affiliation.agencyId,
    agencyName: affiliation.agencyName,
    active: affiliation.status === "Active",
  });
  const result = reconstructEmployment(
    normalized.reverse(),
    affiliations.map(normalizeAffiliation),
    agencyAffiliations.map(normalizeAffiliation),
  );
  sourceRows.reverse().forEach((index, position) => {
    rows[index] = result.rows[position]!;
  });
  return { ...result, rows };
}
