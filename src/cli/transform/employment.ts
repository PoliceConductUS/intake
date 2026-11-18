export type EmploymentEventInput = {
  date: string;
  agencyName: string;
  action: "start" | "restore" | "continue" | "leave" | "end" | "unresolved";
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
export type EmploymentRowOutcome =
  | "assigned"
  | "repeated"
  | "ended"
  | "leave-while-inactive"
  | "agency-identity"
  | "unresolved-action"
  | "no-start"
  | "ambiguous-position"
  | "ambiguous-period"
  | "untitled-period"
  | "open-period"
  | "left-out-period";
type OpenPeriod = {
  episode: EmploymentEpisode;
  ambiguous: boolean;
  rows: number[];
};

export function reconstructEmployment(
  events: EmploymentEventInput[],
  affiliations: EmploymentAffiliation[],
  agencyAffiliations: EmploymentAffiliation[] = affiliations,
): {
  assignments: EmploymentEpisode[];
  issues: string[];
  rows: EmploymentRowOutcome[];
} {
  const assignments: EmploymentEpisode[] = [];
  const issues: string[] = [];
  const outcomes: EmploymentRowOutcome[] = [];
  const seen = new Set<string>();
  const groups = new Map<
    string,
    Array<EmploymentEventInput & { eventDate: string; index: number }>
  >();
  events.forEach((event, index) => {
    const key = JSON.stringify(event);
    if (seen.has(key)) {
      outcomes[index] = "repeated";
      return;
    }
    seen.add(key);
    const rows = groups.get(event.agencyName) ?? [];
    rows.push({ ...event, eventDate: event.date, index });
    groups.set(event.agencyName, rows);
  });
  const leaveOut = (period: OpenPeriod, issue: string) => {
    issues.push(issue);
    const [start, ...rest] = period.rows;
    outcomes[start!] = period.ambiguous
      ? "ambiguous-period"
      : period.episode.title
        ? "open-period"
        : "untitled-period";
    for (const index of rest) outcomes[index] = "left-out-period";
  };
  for (const [name, rows] of groups) {
    const matches = affiliations.filter((a) => a.agencyName === name);
    const ids = new Set(
      agencyAffiliations
        .filter((a) => a.agencyName === name)
        .map((a) => a.agencyId),
    );
    if (ids.size !== 1) {
      issues.push(`${name}: agency name has ${ids.size} source identities`);
      for (const row of rows) outcomes[row.index] = "agency-identity";
      continue;
    }
    const agencyId = [...ids][0]!;
    const open: OpenPeriod[] = [];
    const onLeave: OpenPeriod[] = [];
    const completed: EmploymentEpisode[] = [];
    const complete = (period: OpenPeriod) => {
      completed.push(period.episode);
      for (const index of period.rows) outcomes[index] = "assigned";
    };
    const close = (period: OpenPeriod) => {
      if (!period.ambiguous && period.episode.title) complete(period);
      else
        leaveOut(
          period,
          `${name}: omitted unresolved AgencyPersonnel starting ${period.episode.startDate}`,
        );
    };
    for (const row of rows) {
      if (
        row.action === "start" ||
        (row.action === "restore" && open.length === 0)
      ) {
        for (const period of onLeave.splice(0)) close(period);
        open.push({
          episode: {
            agencyId,
            startDate: row.eventDate,
            endDate: null,
            title: row.rank,
          },
          ambiguous: false,
          rows: [row.index],
        });
        continue;
      }
      if (row.action === "unresolved") {
        for (const period of open) period.ambiguous = true;
        issues.push(
          `${name}: unresolved action ${row.sourceAction} on ${row.eventDate}`,
        );
        outcomes[row.index] = "unresolved-action";
        continue;
      }
      const pool = open.length === 0 && row.action === "end" ? onLeave : open;
      if (pool.length === 0) {
        if (
          row.action === "leave" &&
          (completed.length > 0 || onLeave.length > 0)
        ) {
          outcomes[row.index] = "leave-while-inactive";
          continue;
        }
        if (row.action === "end" && completed.length > 0) {
          outcomes[row.index] = "ended";
          continue;
        }
        const action =
          row.action === "end"
            ? "separation"
            : row.action === "leave"
              ? "leave"
              : row.sourceAction;
        issues.push(`${name}: ${action} on ${row.eventDate} without hire`);
        outcomes[row.index] = "no-start";
        continue;
      }
      const candidates =
        pool.length === 1
          ? pool
          : pool.filter(
              (period) => row.rank && period.episode.title === row.rank,
            );
      if (candidates.length !== 1) {
        for (const period of candidates.length ? candidates : pool)
          period.ambiguous = true;
        issues.push(
          `${name}: ${row.sourceAction} on ${row.eventDate} matches ${candidates.length} open AgencyPersonnel records by position; unresolved among ${pool.length} AgencyPersonnel records`,
        );
        outcomes[row.index] = "ambiguous-position";
        continue;
      }
      const period = candidates[0]!;
      period.rows.push(row.index);
      if (row.rank) period.episode.title = row.rank;
      if (row.action === "end" || row.action === "leave") {
        period.episode.endDate = row.eventDate;
        pool.splice(pool.indexOf(period), 1);
        if (row.action === "leave") onLeave.push(period);
        else close(period);
      }
    }
    for (const period of onLeave) close(period);
    for (const period of open) {
      if (
        !period.ambiguous &&
        period.episode.title &&
        matches.some((affiliation) => affiliation.active)
      )
        complete(period);
      else
        leaveOut(
          period,
          `${name}: omitted unresolved AgencyPersonnel without an end date, starting ${period.episode.startDate}`,
        );
    }
    assignments.push(...completed);
  }
  return { assignments, issues, rows: outcomes };
}
