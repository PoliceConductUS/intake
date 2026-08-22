import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  EmittedRecords,
  RunDeps,
  SourceRun,
} from "../../src/cli/run/source-run.js";
import {
  isPersonDefendant,
  primaryAgencyName,
  slugify,
} from "../lib/civil-defendants.js";

export const description =
  "Civil Rights Litigation Clearinghouse — policing civil cases (TX + MN), linked to the officers named as defendants via the fuzzy agency_personnel resolver.";

const SOURCE_FILE = "clearinghouse-cases.json";
// Clearinghouse reports the full state name; map the states we can resolve
// against (have rosters + location paths for) to their 2-letter code.
const STATE_CODE: Record<string, string> = {
  Texas: "TX",
  Minnesota: "MN",
};
const DEFAULT_MIN_YEAR = 2022;

type Defendant = {
  name?: string;
  institution?: string;
  institution_city?: string;
  institution_county?: string;
};

type Case = {
  id: number | string;
  name?: string;
  state?: string;
  court?: string;
  filing_date?: string | null;
  filing_year?: number | null;
  terminating_date?: string | null;
  non_docket_case_number?: string;
  summary?: string;
  summary_short?: string;
  prevailing_party?: string;
  clearinghouse_link?: string;
  case_defendants?: Defendant[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function filedDate(civilCase: Case): string | undefined {
  const date = text(civilCase.filing_date);
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
  if (typeof civilCase.filing_year === "number") {
    return `${civilCase.filing_year}-01-01`;
  }
  return undefined;
}

export const run: SourceRun = async ({ paths, env, logger }: RunDeps) => {
  const log = logger ?? { info() {} };
  const jsonPath = paths.find((p) => path.basename(p) === SOURCE_FILE);
  if (jsonPath === undefined) {
    throw new Error(`clearinghouse-api expects the acquired ${SOURCE_FILE}.`);
  }
  const minYear = Number(env?.CLEARINGHOUSE_MIN_YEAR ?? DEFAULT_MIN_YEAR);

  const parsed = JSON.parse(await readFile(jsonPath, "utf8")) as {
    cases?: Case[];
  };
  const cases = parsed.cases ?? [];

  const civilCases: EmittedRecords = {};
  const officers: EmittedRecords = {};
  const links: EmittedRecords = {};
  let considered = 0;

  for (const civilCase of cases) {
    const stateCode = STATE_CODE[text(civilCase.state)];
    if (stateCode === undefined) continue;
    const year =
      typeof civilCase.filing_year === "number"
        ? civilCase.filing_year
        : Number(text(civilCase.filing_date).slice(0, 4));
    if (!Number.isFinite(year) || year < minYear) continue;
    const filed = filedDate(civilCase);
    const title = text(civilCase.name);
    if (filed === undefined || title === "") continue;

    considered += 1;
    const caseKey = String(civilCase.id);
    const summary = text(civilCase.summary) || text(civilCase.summary_short);
    civilCases[caseKey] = {
      spec: {
        title,
        cause_number: text(civilCase.non_docket_case_number) || `CH-${caseKey}`,
        court: text(civilCase.court) || null,
        filed_date: filed,
        claims_summary: summary || title,
        slug: `${slugify(title)}-${caseKey}`,
        outcome: text(civilCase.prevailing_party) || null,
        primary_source_url: text(civilCase.clearinghouse_link) || null,
        date_terminated: text(civilCase.terminating_date) || null,
        location_path_id: stateCode.toLowerCase(),
      },
    };

    const defendants = civilCase.case_defendants ?? [];
    const agencyName = primaryAgencyName(
      defendants.map((d) => text(d.institution) || text(d.name)),
    );
    for (const defendant of defendants) {
      const officerName = text(defendant.name);
      if (!isPersonDefendant(officerName) || agencyName === undefined) continue;
      officers[`${caseKey}|${slugify(officerName)}`] = {
        spec: {
          civil_case_id: caseKey,
          state: stateCode,
          agency_name: agencyName,
          officer_name: officerName,
        },
      };
    }

    const url = text(civilCase.clearinghouse_link);
    if (url !== "") {
      links[`${caseKey}|clearinghouse`] = {
        spec: {
          civil_case_id: caseKey,
          url,
          title: "Civil Rights Litigation Clearinghouse",
        },
      };
    }
  }

  log.info(
    `clearinghouse: ${considered} TX/MN cases since ${minYear}; ` +
      `${Object.keys(officers).length} officer defendants, ${Object.keys(links).length} links (linking resolved at import)`,
  );

  return {
    artifacts: [
      { kind: "CivilCases", records: civilCases },
      { kind: "CivilCaseOfficers", records: officers },
      { kind: "CivilCaseLinks", records: links },
    ],
  };
};
