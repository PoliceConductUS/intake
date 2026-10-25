import type { Affiliation, EmploymentEvent } from "./parse.js";

export function sourceDate(value: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid DPSST date: ${value}`);
  const [, month, day, year] = match;
  const iso = `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso)
    throw new Error(`Invalid DPSST date: ${value}`);
  return iso;
}
export type EmploymentEpisode = {
  agencyId: string;
  startDate: string;
  endDate: string | null;
  title: string;
};
const separations = new Set([
  "Resigned",
  "Retired",
  "Discharged",
  "Prob Dschg",
  "Layoff",
]);
const continuations = new Set([
  "Promotion",
  "Demotn Vol",
  "Demotion",
  "Reclassed",
  "LOA",
  "Return LOA",
  "Name Chg",
]);

export function buildEmploymentEpisodes(
  events: EmploymentEvent[],
  affiliations: Affiliation[],
  agencyAffiliations: Affiliation[] = affiliations,
): { assignments: EmploymentEpisode[]; issues: string[] } {
  const assignments: EmploymentEpisode[] = [];
  const issues: string[] = [];
  const groups = new Map<string, Array<EmploymentEvent & { iso: string }>>();
  for (const event of new Map(
    events.map((e) => [JSON.stringify(e), e]),
  ).values()) {
    const rows = groups.get(event.agencyName) ?? [];
    rows.push({ ...event, iso: sourceDate(event.date) });
    groups.set(event.agencyName, rows);
  }
  for (const [name, rows] of groups) {
    const matches = affiliations.filter((a) => a.agencyName === name);
    const ids = new Set(
      agencyAffiliations
        .filter((a) => a.agencyName === name)
        .map((a) => a.agencyId),
    );
    if (ids.size !== 1) {
      issues.push(`${name}: agency name has ${ids.size} source identities`);
      continue;
    }
    const agencyId = [...ids][0]!;
    let open: EmploymentEpisode | undefined;
    let ambiguous = false;
    const completed: EmploymentEpisode[] = [];
    for (const row of rows.sort(
      (a, b) =>
        a.iso.localeCompare(b.iso) ||
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
    )) {
      if (rows.some((other) => other !== row && other.iso === row.iso)) {
        ambiguous = true;
        issues.push(
          `${name}: multiple events on ${row.iso} have unknown ordering`,
        );
      }
      if (row.action === "Hired") {
        if (open) {
          ambiguous = true;
          issues.push(
            `${name}: repeated hire without separation on ${row.iso}`,
          );
        } else
          open = {
            agencyId,
            startDate: row.iso,
            endDate: null,
            title: row.rank,
          };
      } else if (separations.has(row.action)) {
        if (!open) {
          issues.push(`${name}: separation on ${row.iso} without hire`);
          continue;
        }
        open.endDate = row.iso;
        if (row.rank) open.title = row.rank;
        if (!ambiguous && open.title) completed.push(open);
        else
          issues.push(`${name}: omitted unresolved episode ${open.startDate}`);
        open = undefined;
        ambiguous = false;
      } else if (continuations.has(row.action)) {
        if (!open)
          issues.push(`${name}: ${row.action} on ${row.iso} without hire`);
        else if (row.rank) open.title = row.rank;
      } else {
        ambiguous = true;
        issues.push(`${name}: unresolved action ${row.action} on ${row.iso}`);
      }
    }
    if (open) {
      if (
        !ambiguous &&
        open.title &&
        matches.some((a) => a.status === "Active")
      )
        completed.push(open);
      else
        issues.push(
          `${name}: omitted unresolved open episode ${open.startDate}`,
        );
    }
    assignments.push(...completed);
  }
  return { assignments, issues };
}
