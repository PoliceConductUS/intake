export type EmploymentEventInput = {
  date: string;
  agencyName: string;
  action: "start" | "restore" | "continue" | "end" | "unresolved";
  sourceAction: string;
  rank: string;
  classification: string;
  assignment: string;
};
export type EmploymentAffiliation = {
  agencyId: string;
  agencyName: string;
  active: boolean;
};
export type EmploymentEpisode = {
  agencyId: string;
  startDate: string;
  endDate: string | null;
  title: string;
};

export function reconstructEmployment(
  events: EmploymentEventInput[],
  affiliations: EmploymentAffiliation[],
  agencyAffiliations: EmploymentAffiliation[] = affiliations,
): { assignments: EmploymentEpisode[]; issues: string[] } {
  const assignments: EmploymentEpisode[] = [];
  const issues: string[] = [];
  const groups = new Map<
    string,
    Array<EmploymentEventInput & { eventDate: string }>
  >();
  for (const event of new Map(
    events.map((e) => [JSON.stringify(e), e]),
  ).values()) {
    const eventDate = event.date;
    const rows = groups.get(event.agencyName) ?? [];
    rows.push({ ...event, eventDate });
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
    const open: Array<{ episode: EmploymentEpisode; ambiguous: boolean }> = [];
    const completed: EmploymentEpisode[] = [];
    for (const row of rows) {
      if (
        row.action === "start" ||
        (row.action === "restore" && open.length === 0)
      ) {
        open.push({
          episode: {
            agencyId,
            startDate: row.eventDate,
            endDate: null,
            title: row.rank,
          },
          ambiguous: false,
        });
        continue;
      }
      if (row.action === "unresolved") {
        for (const period of open) period.ambiguous = true;
        issues.push(
          `${name}: unresolved action ${row.sourceAction} on ${row.eventDate}`,
        );
        continue;
      }
      if (open.length === 0) {
        if (row.action === "end" && completed.length > 0) continue;
        const action = row.action === "end" ? "separation" : row.sourceAction;
        issues.push(`${name}: ${action} on ${row.eventDate} without hire`);
        continue;
      }
      const candidates =
        open.length === 1
          ? open
          : open.filter(
              (period) => row.rank && period.episode.title === row.rank,
            );
      if (candidates.length !== 1) {
        for (const period of candidates.length ? candidates : open)
          period.ambiguous = true;
        issues.push(
          `${name}: ${row.sourceAction} on ${row.eventDate} matches ${candidates.length} open AgencyPersonnel records by position; unresolved among ${open.length} AgencyPersonnel records`,
        );
        continue;
      }
      const period = candidates[0]!;
      if (row.rank) period.episode.title = row.rank;
      if (row.action === "end") {
        period.episode.endDate = row.eventDate;
        if (!period.ambiguous && period.episode.title)
          completed.push(period.episode);
        else
          issues.push(
            `${name}: omitted unresolved AgencyPersonnel starting ${period.episode.startDate}`,
          );
        open.splice(open.indexOf(period), 1);
      }
    }
    for (const period of open) {
      if (
        !period.ambiguous &&
        period.episode.title &&
        matches.some((affiliation) => affiliation.active)
      )
        completed.push(period.episode);
      else
        issues.push(
          `${name}: omitted unresolved AgencyPersonnel without an end date, starting ${period.episode.startDate}`,
        );
    }
    assignments.push(...completed);
  }
  return { assignments, issues };
}
