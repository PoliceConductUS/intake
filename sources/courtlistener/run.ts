import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  EmittedRecords,
  RunDeps,
  SourceRun,
} from "../../src/cli/run/source-run.js";
import { isPersonName, slugify } from "../lib/civil-defendants.js";

export const description =
  "CourtListener — federal dockets naming TX/MN agencies, linked to any officer named as a party (plaintiff or defendant) via the fuzzy agency_personnel resolver.";

const COURTLISTENER = "https://www.courtlistener.com";

type Docket = {
  id: number | string;
  case_name?: string;
  docket_number?: string;
  court?: string;
  date_filed?: string | null;
  date_terminated?: string | null;
  cause?: string;
  absolute_url?: string;
  parties?: string[];
};

type AgencyDockets = {
  agency: { id?: string; name?: string; state?: string };
  dockets?: Docket[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function docketUrl(docket: Docket): string {
  const url = text(docket.absolute_url);
  if (url === "") return "";
  return url.startsWith("http") ? url : `${COURTLISTENER}${url}`;
}

export const run: SourceRun = async ({ paths, logger }: RunDeps) => {
  const log = logger ?? { info() {} };
  const envelopePaths = paths.filter((p) => p.endsWith(".dockets.json"));
  const files =
    envelopePaths.length > 0
      ? envelopePaths
      : await collectEnvelopePaths(paths);

  const civilCases: EmittedRecords = {};
  const officers: EmittedRecords = {};
  const links: EmittedRecords = {};

  for (const file of files) {
    const envelope = JSON.parse(await readFile(file, "utf8")) as AgencyDockets;
    const agencyName = text(envelope.agency.name);
    const agencyId = text(envelope.agency.id);
    const state = text(envelope.agency.state).toUpperCase();
    if (agencyName === "" || state === "") continue;

    for (const docket of envelope.dockets ?? []) {
      const title = text(docket.case_name);
      const filed = text(docket.date_filed);
      if (title === "" || !/^\d{4}-\d{2}-\d{2}/.test(filed)) continue;
      const caseKey = `cl-${docket.id}`;
      const url = docketUrl(docket);

      const terminated = text(docket.date_terminated);
      civilCases[caseKey] = {
        spec: {
          title,
          cause_number: text(docket.docket_number) || caseKey,
          court: text(docket.court) || null,
          filed_date: filed.slice(0, 10),
          claims_summary: text(docket.cause) || title,
          slug: `${slugify(title)}-${caseKey}`,
          outcome: null,
          primary_source_url: url || null,
          date_terminated: /^\d{4}-\d{2}-\d{2}/.test(terminated)
            ? terminated.slice(0, 10)
            : null,
          location_path_id: state.toLowerCase(),
        },
      };
      if (url !== "") {
        links[`${caseKey}|courtlistener`] = {
          spec: {
            civil_case_id: caseKey,
            url,
            title: "CourtListener docket",
          },
        };
      }
      for (const party of docket.parties ?? []) {
        const officerName = text(party);
        if (!isPersonName(officerName)) continue;
        officers[`${caseKey}|${slugify(officerName)}`] = {
          spec: {
            civil_case_id: caseKey,
            state,
            agency_id: agencyId,
            agency_name: agencyName,
            officer_name: officerName,
          },
        };
      }
    }
  }

  log.info(
    `courtlistener: ${Object.keys(civilCases).length} dockets, ` +
      `${Object.keys(officers).length} candidate officer parties, ${Object.keys(links).length} links (linking resolved at import)`,
  );

  return {
    artifacts: [
      { kind: "CivilCases", records: civilCases },
      { kind: "CivilCaseOfficers", records: officers },
      { kind: "CivilCaseLinks", records: links },
    ],
  };
};

async function collectEnvelopePaths(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const p of paths) {
    if (p.endsWith(".dockets.json")) {
      files.push(p);
      continue;
    }
    try {
      const entries = await readdir(p);
      for (const entry of entries) {
        if (entry.endsWith(".dockets.json")) files.push(path.join(p, entry));
      }
    } catch {
      continue;
    }
  }
  return files;
}
