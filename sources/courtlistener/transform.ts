import { readdir, readFile } from "node:fs/promises";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";

export const produces: readonly ImportArtifactKind[] = [
  "CivilCases",
  "CivilCasePersonnel",
  "CivilCaseLinks",
];
import path from "node:path";
import type {
  EmittedRecords,
  TransformDeps,
  SourceTransform,
} from "../../src/cli/transform/source-transform.js";
import { isPersonName, slugify } from "../lib/civil-defendants.js";
import {
  civilCaseNaturalId,
  normalizeDocketNumber,
} from "../lib/civil-case-id.js";

export const description =
  "CourtListener — federal dockets naming any U.S. agency with at least one officer (active or not), linked to any officer named as a party (plaintiff or defendant) via the fuzzy agency_personnel resolver.";

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
  complaint_intro?: string;
};

type AgencyDockets = {
  // `id` is the namespace-local agency source id the acquire stamped (ADR 0023);
  // the import resolves it back to the canonical agency.
  agency: {
    id?: string;
    name?: string;
    state?: string;
  };
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

export const transform: SourceTransform = async ({
  paths,
  data,
  logger,
}: TransformDeps) => {
  const log = logger ?? { info() {} };
  if (data === undefined) {
    throw new Error(
      "courtlistener: run requires a data context (DATABASE_URL) to resolve officers (ADR 0023).",
    );
  }
  const envelopePaths = paths.filter((p) => p.endsWith(".dockets.json"));
  const files =
    envelopePaths.length > 0
      ? envelopePaths
      : await collectEnvelopePaths(paths);

  const civilCases: EmittedRecords = {};
  const personnel: EmittedRecords = {};
  const links: EmittedRecords = {};

  for (const file of files) {
    const envelope = JSON.parse(await readFile(file, "utf8")) as AgencyDockets;
    const agencyId = text(envelope.agency.id);
    const agencyName = text(envelope.agency.name);
    const state = text(envelope.agency.state).toUpperCase();
    if (agencyId === "" || agencyName === "" || state === "") continue;

    for (const docket of envelope.dockets ?? []) {
      const title = text(docket.case_name);
      const filed = text(docket.date_filed);
      if (title === "" || !/^\d{4}-\d{2}-\d{2}/.test(filed)) continue;

      const resolvedPersonnelIds = new Set<string>();
      for (const party of docket.parties ?? []) {
        const personnelName = text(party);
        if (!isPersonName(personnelName)) continue;
        const match = await data.resolvePersonnel({ agencyId, personnelName });
        if (match !== null) resolvedPersonnelIds.add(match.agencyPersonnelId);
      }
      if (resolvedPersonnelIds.size === 0) continue;

      // Canonical id is the natural docket key (ADR 0028), shared with the
      // Clearinghouse. `docket.court` is already CourtListener's court_id (the
      // acquire stores court_id), so it is the court token directly.
      const courtToken = text(docket.court);
      const docketNumber = normalizeDocketNumber(text(docket.docket_number));
      const caseId =
        docketNumber !== "" && courtToken !== ""
          ? civilCaseNaturalId(courtToken, docketNumber)
          : `${courtToken || "unknown"}:${slugify(title)}`;
      const url = docketUrl(docket);
      const terminated = text(docket.date_terminated);
      civilCases[caseId] = {
        spec: {
          id: caseId,
          title,
          cause_number: docketNumber || caseId,
          court: courtToken || null,
          filed_date: filed.slice(0, 10),
          // The operative complaint's intro (verbatim from RECAP) when available,
          // else the PACER cause code, else the title.
          claims_summary:
            text(docket.complaint_intro) || text(docket.cause) || title,
          slug: slugify(`${title}-${caseId}`),
          outcome: null,
          primary_source_url: url || null,
          date_terminated: /^\d{4}-\d{2}-\d{2}/.test(terminated)
            ? terminated.slice(0, 10)
            : null,
          location_path_id: state.toLowerCase(),
        },
      };
      if (url !== "") {
        links[`${caseId}|courtlistener`] = {
          spec: {
            civil_case_id: caseId,
            url,
            title: "CourtListener docket",
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
    `courtlistener: ${Object.keys(civilCases).length} cases with a resolved officer, ` +
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
