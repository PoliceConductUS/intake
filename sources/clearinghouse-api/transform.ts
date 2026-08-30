import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  TransformDeps,
  SourceTransform,
} from "../../src/cli/transform/source-transform.js";
import { isPersonName, slugify } from "../lib/civil-defendants.js";
import {
  civilCaseNaturalId,
  courtTokenFromName,
  normalizeDocketNumber,
} from "../lib/civil-case-id.js";

export const produces: readonly ImportArtifactKind[] = [
  "CivilCases",
  "CivilCasePersonnel",
  "CivilCaseLinks",
];

export const description =
  "Civil Rights Litigation Clearinghouse — policing civil cases naming any agency with at least one officer, linked to the officers named as defendants via the run-phase agency_personnel resolver.";

const DEFAULT_MIN_YEAR = 2022;
const AGENCY_STOPWORDS = new Set([
  "police",
  "department",
  "dept",
  "sheriff",
  "office",
  "county",
  "city",
  "of",
  "the",
  "and",
  "town",
  "village",
  "state",
  "patrol",
  "public",
  "safety",
]);

type Defendant = {
  name?: string;
  institution?: string;
  institution_city?: string;
  institution_county?: string;
};

type Case = {
  id: number | string;
  name?: string;
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
  dockets?: Docket[];
};

// A case's dockets (acquired from cases/<id>/dockets/). The main docket carries
// the court-assigned number the CivilCase is keyed on (ADR 0028).
type Docket = {
  court?: string;
  is_main_docket?: boolean;
  docket_number_manual?: string;
  recap_docket_number?: string;
};

type AgencyCases = {
  agency: { id?: string; name?: string; state?: string };
  cases?: Case[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Distinctive place tokens of an agency name (drop the generic agency words), so
// a full-text hit is only kept when a defendant institution actually names the
// same agency, not merely mentions it.
function distinctiveTokens(agencyName: string): Set<string> {
  return new Set(
    normalize(agencyName)
      .split(" ")
      .filter((token) => token.length >= 3 && !AGENCY_STOPWORDS.has(token)),
  );
}

function namesAgency(
  caseDefendants: Defendant[],
  tokens: Set<string>,
): boolean {
  if (tokens.size === 0) return false;
  for (const defendant of caseDefendants) {
    const haystack = normalize(
      `${text(defendant.institution)} ${text(defendant.name)}`,
    );
    if (haystack === "") continue;
    for (const token of tokens) {
      if (haystack.includes(token)) return true;
    }
  }
  return false;
}

function filedDate(civilCase: Case): string | undefined {
  const date = text(civilCase.filing_date);
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
  if (typeof civilCase.filing_year === "number") {
    return `${civilCase.filing_year}-01-01`;
  }
  return undefined;
}

function caseUrl(civilCase: Case): string {
  const link = text(civilCase.clearinghouse_link);
  if (link === "") return "";
  return link.startsWith("http") ? link : `https://${link}`;
}

// The CivilCase identity (ADR 0028): the main docket's court-assigned key
// `court:docket` (so it converges with the same docket from CourtListener) plus
// the normalized docket number for `cause_number`. A case with no docket number
// (rare; some state cases) falls back to a deterministic court+title id and an
// empty docket number — Clearinghouse-only, so a lucky-only match is fine.
function caseIdentity(
  civilCase: Case,
  title: string,
): { id: string; docketNumber: string } {
  const dockets = civilCase.dockets ?? [];
  const main =
    dockets.find((docket) => docket.is_main_docket) ??
    dockets.find((docket) => text(docket.docket_number_manual) !== "") ??
    dockets[0];
  const courtToken = courtTokenFromName(
    text(main?.court) || text(civilCase.court),
  );
  const docketNumber = normalizeDocketNumber(
    text(main?.docket_number_manual) || text(main?.recap_docket_number),
  );
  return docketNumber !== ""
    ? { id: civilCaseNaturalId(courtToken, docketNumber), docketNumber }
    : { id: `${courtToken}:${slugify(title)}`, docketNumber: "" };
}

export const transform: SourceTransform = async ({
  paths,
  data,
  env,
  logger,
}: TransformDeps) => {
  const log = logger ?? { info() {} };
  if (data === undefined) {
    throw new Error(
      "clearinghouse-api: run requires a data context (DATABASE_URL) to resolve officers.",
    );
  }
  const minYear = Number(env?.CLEARINGHOUSE_MIN_YEAR ?? DEFAULT_MIN_YEAR);
  const files =
    paths.filter((p) => p.endsWith(".cases.json")).length > 0
      ? paths.filter((p) => p.endsWith(".cases.json"))
      : await collectEnvelopePaths(paths);

  const civilCases: EmittedRecords = {};
  const personnel: EmittedRecords = {};
  const links: EmittedRecords = {};

  for (const file of files) {
    const envelope = JSON.parse(await readFile(file, "utf8")) as AgencyCases;
    const agencyId = text(envelope.agency.id);
    const agencyName = text(envelope.agency.name);
    const state = text(envelope.agency.state).toUpperCase();
    if (agencyId === "" || agencyName === "" || state === "") continue;
    const tokens = distinctiveTokens(agencyName);

    for (const civilCase of envelope.cases ?? []) {
      const title = text(civilCase.name);
      const filed = filedDate(civilCase);
      if (title === "" || filed === undefined || filed < `${minYear}-01-01`) {
        continue;
      }
      const defendants = civilCase.case_defendants ?? [];
      if (!namesAgency(defendants, tokens)) continue;

      const resolvedPersonnelIds = new Set<string>();
      for (const defendant of defendants) {
        const personnelName = text(defendant.name);
        if (!isPersonName(personnelName)) continue;
        const match = await data.resolvePersonnel({ agencyId, personnelName });
        if (match !== null) resolvedPersonnelIds.add(match.agencyPersonnelId);
      }
      if (resolvedPersonnelIds.size === 0) continue;

      // Canonical id is the natural docket key (ADR 0028), shared with CL.
      const { id: caseId, docketNumber } = caseIdentity(civilCase, title);
      const url = caseUrl(civilCase);
      const terminated = text(civilCase.terminating_date);
      civilCases[caseId] = {
        spec: {
          id: caseId,
          title,
          // The court-assigned docket number; the id itself when the case has no
          // docket (a court+title fallback), never an empty string.
          cause_number: docketNumber || caseId,
          court: text(civilCase.court) || null,
          filed_date: filed,
          claims_summary:
            text(civilCase.summary) || text(civilCase.summary_short) || title,
          slug: slugify(`${title}-${caseId}`),
          outcome: text(civilCase.prevailing_party) || null,
          primary_source_url: url || null,
          date_terminated: /^\d{4}-\d{2}-\d{2}/.test(terminated)
            ? terminated.slice(0, 10)
            : null,
          location_path_id: state.toLowerCase(),
        },
      };
      if (url !== "") {
        links[`${caseId}|clearinghouse`] = {
          spec: {
            civil_case_id: caseId,
            url,
            title: "Civil Rights Litigation Clearinghouse",
          },
        };
      }
      for (const agencyPersonnelId of resolvedPersonnelIds) {
        personnel[`${caseId}|${agencyPersonnelId}`] = {
          spec: {
            civil_case_id: caseId,
            agency_personnel_id: agencyPersonnelId,
          },
        };
      }
    }
  }

  log.info(
    `clearinghouse: ${Object.keys(civilCases).length} cases with a resolved officer, ` +
      `${Object.keys(personnel).length} case-personnel links, ${Object.keys(links).length} source links`,
  );

  return {
    artifacts: [
      { kind: "CivilCases", records: civilCases },
      { kind: "CivilCasePersonnel", records: personnel },
      { kind: "CivilCaseLinks", records: links },
    ],
  };
};

async function collectEnvelopePaths(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const p of paths) {
    if (p.endsWith(".cases.json")) {
      files.push(p);
      continue;
    }
    try {
      const entries = await readdir(p);
      for (const entry of entries) {
        if (entry.endsWith(".cases.json")) files.push(path.join(p, entry));
      }
    } catch {
      // not a directory — ignore
    }
  }
  return files;
}
