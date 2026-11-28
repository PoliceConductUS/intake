import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  EmittedRecords,
  TransformDeps,
  SourceTransform,
} from "../../../../../src/cli/transform/source-transform.js";
import type { Finding } from "../../../../../src/shared/data-annotations.js";
import { isPersonName, slugify } from "../../../../lib/civil-defendants.js";
import {
  civilCaseNaturalId,
  normalizeDocketNumber,
} from "../../../../lib/civil-case-id.js";
import { stateAuthorityRecords } from "../../../../lib/state-authority-findings.js";

const SOURCE = "com/courtlistener/www/api";
const COURTLISTENER = "https://www.courtlistener.com";
const NO_MATCHING_OFFICER = "no matching officer";
const DATE = /^\d{4}-\d{2}-\d{2}/;

type Docket = {
  id?: number | string;
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
  // `id` is the namespace-local agency source id the acquire stamped (ADR 0023);
  // the import resolves it back to the canonical agency.
  agency?: {
    id?: string;
    name?: string;
    state?: string;
  };
  dockets?: Docket[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function problem(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const transform: SourceTransform = async ({
  paths,
  data,
  logger,
}: TransformDeps) => {
  const log = logger ?? { info() {} };
  if (data === undefined) {
    throw new Error(
      `${SOURCE}: run requires a data context (DATABASE_URL) to resolve officers (ADR 0023).`,
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
  const originOfCase = new Map<string, string>();
  const states = new Set<string>();
  const notBuildable = new Map<string, Map<string, Finding>>();
  let read = 0;
  let emitted = 0;
  let reported = 0;
  let noMatchingOfficer = 0;

  for (const file of files) {
    let envelope: AgencyDockets;
    try {
      envelope = JSON.parse(await readFile(file, "utf8")) as AgencyDockets;
    } catch (error) {
      throw new Error(`${SOURCE}: cannot read ${file}: ${problem(error)}`);
    }
    const agencyId = text(envelope.agency?.id);
    const agencyName = text(envelope.agency?.name);
    const state = text(envelope.agency?.state).toUpperCase();
    if (agencyId === "" || agencyName === "" || state === "") {
      throw new Error(`${SOURCE}: ${file} has no agency ID, name or state.`);
    }
    if (!Array.isArray(envelope.dockets)) {
      throw new Error(`${SOURCE}: ${file} has no list of dockets.`);
    }
    states.add(state);

    for (const [index, docket] of envelope.dockets.entries()) {
      read += 1;
      const docketId = text(String(docket.id ?? ""));
      if (docketId === "") {
        throw new Error(`${SOURCE}: ${file} docket ${index + 1} has no ID.`);
      }
      const address = text(docket.absolute_url);
      if (address === "") {
        throw new Error(
          `${SOURCE}: ${file} docket ${docketId} has no address.`,
        );
      }
      const url = address.startsWith("http")
        ? address
        : `${COURTLISTENER}${address}`;

      const resolvedPersonnelIds = new Set<string>();
      for (const party of docket.parties ?? []) {
        const personnelName = text(party);
        if (!isPersonName(personnelName)) continue;
        const match = await data.resolvePersonnel({ agencyId, personnelName });
        if (match !== null) resolvedPersonnelIds.add(match.agencyPersonnelId);
      }
      if (resolvedPersonnelIds.size === 0) {
        noMatchingOfficer += 1;
        log.info(
          `${SOURCE}: docket ${docketId} (${url}) left out: ${NO_MATCHING_OFFICER}.`,
        );
        continue;
      }

      const title = text(docket.case_name);
      const filed = text(docket.date_filed);
      if (title === "" || !DATE.test(filed)) {
        const missing = [
          ...(title === "" ? ["a title"] : []),
          ...(DATE.test(filed) ? [] : ["a filing date"]),
        ].join(" and ");
        const ofState = notBuildable.get(state) ?? new Map<string, Finding>();
        notBuildable.set(state, ofState);
        if (!ofState.has(docketId)) {
          ofState.set(docketId, {
            code: "docket-not-buildable",
            type: "warning",
            field: "civil_cases",
            value: {
              case_name: docket.case_name ?? null,
              date_filed: docket.date_filed ?? null,
            },
            message: `A court case naming an officer of ${agencyName} is not shown on this site because CourtListener, a free website of court records, lists it without ${missing}. You can see the case here: ${url}`,
            evidence: [{ url }],
            source_namespace: SOURCE,
            source_record_id: docketId,
          });
        }
        reported += 1;
        log.info(
          `${SOURCE}: docket ${docketId} (${url}) left out: names an officer but has no ${missing.replace(/\ba /g, "")}; reported on the licensing authority of ${state}.`,
        );
        continue;
      }

      // Canonical id is the natural docket key (ADR 0028), shared with the
      // Clearinghouse. `docket.court` is already CourtListener's court_id (the
      // acquire stores court_id), so it is the court token directly.
      const courtToken = text(docket.court);
      const docketNumber = normalizeDocketNumber(text(docket.docket_number));
      if (courtToken === "" || docketNumber === "") {
        throw new Error(
          `${SOURCE}: ${file} docket ${docketId} names an officer but has no court or no docket number.`,
        );
      }
      const terminated = text(docket.date_terminated);
      if (terminated !== "" && !DATE.test(terminated)) {
        throw new Error(
          `${SOURCE}: ${file} docket ${docketId} has a termination date that is not a date: ${JSON.stringify(docket.date_terminated)}.`,
        );
      }
      const caseId = civilCaseNaturalId(courtToken, docketNumber);
      const spec = {
        id: caseId,
        title,
        cause_number: docketNumber,
        court: courtToken,
        filed_date: filed.slice(0, 10),
        claims_summary: text(docket.cause) || title,
        slug: slugify(`${title}-${caseId}`),
        outcome: null,
        primary_source_url: url,
        date_terminated: terminated === "" ? null : terminated.slice(0, 10),
        location_path_id: state.toLowerCase(),
      };
      const origin = `docket ${docketId} in ${file}`;
      const earlier = civilCases[caseId];
      if (earlier !== undefined && !isDeepStrictEqual(earlier.spec, spec)) {
        log.info(
          `${SOURCE}: case ${caseId} from ${origin} replaces a different record of the same case from ${originOfCase.get(caseId)}.`,
        );
      }
      civilCases[caseId] = { spec };
      originOfCase.set(caseId, origin);
      links[`${caseId}|courtlistener`] = {
        spec: {
          civil_case_id: caseId,
          url,
          title: "CourtListener docket",
        },
      };
      for (const agencyPersonnelId of resolvedPersonnelIds) {
        personnel[`${caseId}|${agencyPersonnelId}`] = {
          spec: {
            civil_case_id: caseId,
            agency_personnel_id: agencyPersonnelId,
          },
        };
      }
      emitted += 1;
    }
  }

  log.info(
    `${SOURCE}: ${Object.keys(civilCases).length} cases written, ` +
      `${Object.keys(personnel).length} case-personnel links, ${Object.keys(links).length} source links; ` +
      `dockets left out: ${noMatchingOfficer} with ${NO_MATCHING_OFFICER}, ${reported} that cannot build a case.`,
  );

  return {
    artifacts: [
      { kind: "CivilCases", records: civilCases },
      { kind: "CivilCasePersonnel", records: personnel },
      { kind: "CivilCaseLinks", records: links },
      {
        kind: "LicensingAuthorities",
        records: stateAuthorityRecords(
          states,
          new Map(
            [...notBuildable].map(([state, findings]) => [
              state,
              [...findings.values()],
            ]),
          ),
        ),
      },
    ],
    accounting: [
      {
        input: "dockets",
        read,
        emitted,
        reported,
        notSelected: { [NO_MATCHING_OFFICER]: noMatchingOfficer },
      },
    ],
  };
};

async function collectEnvelopePaths(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const p of paths) {
    let entries: string[];
    try {
      entries = await readdir(p);
    } catch (error) {
      throw new Error(
        `${SOURCE}: cannot read input path ${p}: ${problem(error)}`,
      );
    }
    for (const entry of entries) {
      if (entry.endsWith(".dockets.json")) files.push(path.join(p, entry));
    }
  }
  return files;
}
