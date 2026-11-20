import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireAgencyRecord,
  AcquireDeps,
  SourceAcquire,
} from "../../../../../src/cli/transform/source-transform.js";

const SOURCE = "com/courtlistener/www/api";
// Every state/territory → its active federal district courts plus its circuit
// (CourtListener court ids; circuit membership per 28 U.S.C. § 41). Any agency
// with at least one officer is searched against the courts that would hear a
// federal case naming it, so coverage is nationwide, not a debug subset.
export const STATE_COURTS: Record<string, string[]> = {
  AK: ["akd", "ca9"],
  AL: ["almd", "alnd", "alsd", "ca11"],
  AR: ["ared", "arwd", "ca8"],
  AZ: ["azd", "ca9"],
  CA: ["cacd", "caed", "cand", "casd", "ca9"],
  CO: ["cod", "ca10"],
  CT: ["ctd", "ca2"],
  DC: ["dcd", "cadc"],
  DE: ["ded", "ca3"],
  FL: ["flmd", "flnd", "flsd", "ca11"],
  GA: ["gamd", "gand", "gasd", "ca11"],
  GU: ["gud", "ca9"],
  HI: ["hid", "ca9"],
  IA: ["iand", "iasd", "ca8"],
  ID: ["idd", "ca9"],
  IL: ["ilcd", "ilnd", "ilsd", "ca7"],
  IN: ["innd", "insd", "ca7"],
  KS: ["ksd", "ca10"],
  KY: ["kyed", "kywd", "ca6"],
  LA: ["laed", "lamd", "lawd", "ca5"],
  MA: ["mad", "ca1"],
  MD: ["mdd", "ca4"],
  ME: ["med", "ca1"],
  MI: ["mied", "miwd", "ca6"],
  MN: ["mnd", "ca8"],
  MO: ["moed", "mowd", "ca8"],
  MS: ["msnd", "mssd", "ca5"],
  MT: ["mtd", "ca9"],
  NC: ["nced", "ncmd", "ncwd", "ca4"],
  ND: ["ndd", "ca8"],
  NE: ["ned", "ca8"],
  NH: ["nhd", "ca1"],
  NJ: ["njd", "ca3"],
  NM: ["nmd", "ca10"],
  NV: ["nvd", "ca9"],
  NY: ["nyed", "nynd", "nysd", "nywd", "ca2"],
  OH: ["ohnd", "ohsd", "ca6"],
  OK: ["oked", "oknd", "okwd", "ca10"],
  OR: ["ord", "ca9"],
  PA: ["paed", "pamd", "pawd", "ca3"],
  PR: ["prd", "ca1"],
  RI: ["rid", "ca1"],
  SC: ["scd", "ca4"],
  SD: ["sdd", "ca8"],
  TN: ["tned", "tnmd", "tnwd", "ca6"],
  TX: ["txed", "txnd", "txsd", "txwd", "ca5"],
  UT: ["utd", "ca10"],
  VA: ["vaed", "vawd", "ca4"],
  VI: ["vid", "ca3"],
  VT: ["vtd", "ca2"],
  WA: ["waed", "wawd", "ca9"],
  WI: ["wied", "wiwd", "ca7"],
  WV: ["wvnd", "wvsd", "ca4"],
  WY: ["wyd", "ca10"],
};
const DEFAULT_MIN_YEAR = 2022;
const REFRESH_DAYS = 120;

type Docket = {
  id: string;
  case_name: string;
  docket_number: string;
  court: string;
  date_filed: string | null;
  date_terminated: string | null;
  cause: string;
  absolute_url: string;
  parties: string[];
};

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

// CourtListener's RECAP search exposes each docket's full party list only behind
// the dedicated `party_name` filter (a `q=party:(...)` query returns just the
// caption parties). The person parties it returns — plaintiffs and defendants
// alike — are matched to the agency roster at import; any officer named in the
// case attaches it (role-agnostic). These are the party names to search for.
// CourtListener's search 500s on some punctuation in party_name (a slash, e.g.
// "Cold Spring/Richmond Police Dept."), so normalize separators to spaces.
function sanitizePartyName(name: string): string {
  return name
    .replace(/[/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function partyNames(
  agencyName: string,
  place: string,
  county: string,
): string[] {
  const names = [agencyName];
  const isCountyAgency = /\b(county|sheriff|parish)\b/i.test(agencyName);
  if (isCountyAgency && county.trim() !== "") {
    names.push(county.trim());
  } else if (place.trim() !== "") {
    names.push(`City of ${place.trim()}`);
  } else if (county.trim() !== "") {
    names.push(county.trim());
  }
  return [
    ...new Set(names.map(sanitizePartyName).filter((name) => name !== "")),
  ];
}

function docketOfHit(
  hit: Record<string, unknown>,
  agencyId: string,
  partyName: string,
): Docket {
  const id = str(hit.docket_id).trim();
  if (id === "" || !Array.isArray(hit.party)) {
    throw new Error(
      `${SOURCE}: a search result for agency ${agencyId} (party ${JSON.stringify(partyName)}) has no ${id === "" ? "docket ID" : "list of parties"}.`,
    );
  }
  return {
    id,
    case_name: str(hit.caseName),
    docket_number: str(hit.docketNumber),
    court: str(hit.court_id),
    date_filed: str(hit.dateFiled) || null,
    date_terminated: str(hit.dateTerminated) || null,
    cause: str(hit.cause),
    absolute_url: str(hit.docket_absolute_url),
    parties: hit.party
      .map((party) => str(party).trim())
      .filter((party) => party !== ""),
  };
}

export const acquire: SourceAcquire = async ({
  sourceDir,
  env,
  data,
  logger,
  clients,
}: AcquireDeps) => {
  const log = logger ?? { info() {} };
  const setting = env.COURTLISTENER_MIN_YEAR;
  const minYear = setting === undefined ? DEFAULT_MIN_YEAR : Number(setting);
  if (
    setting !== undefined &&
    (setting.trim() === "" || !Number.isInteger(minYear))
  ) {
    throw new Error(
      `${SOURCE}: COURTLISTENER_MIN_YEAR is not a year: ${JSON.stringify(setting)}.`,
    );
  }
  const filedAfter = `${minYear}-01-01`;
  await mkdir(sourceDir, { recursive: true });

  let written = 0;
  let failed = 0;
  let skipped = 0;

  const processAgency = async (record: AcquireAgencyRecord): Promise<void> => {
    const agencyId = record.agencyId;
    const agencyName = record.name.trim();
    if (agencyName === "") {
      throw new Error(`${SOURCE}: agency ${agencyId} has no name.`);
    }
    const courts = STATE_COURTS[record.state];
    if (courts === undefined) {
      throw new Error(
        `${SOURCE}: agency ${agencyId} is in state ${JSON.stringify(record.state)}, which has no court list.`,
      );
    }
    const place = record.place ?? "";
    const county = record.county ?? "";

    const dockets: Docket[] = [];
    const seen = new Set<string>();
    for (const partyName of partyNames(agencyName, place, county)) {
      const search = await clients.courtListener.searchDockets(
        { partyName, courts, filedAfter },
        { refreshAfterMs: REFRESH_DAYS * 86_400_000 },
      );
      if (search.status === "skipped") {
        skipped += 1;
        log.info(
          `${SOURCE}: ${agencyName} (${agencyId}): no dockets file written, because CourtListener is down; try again after ${search.retryAfter}.`,
        );
        return;
      }
      if (search.status === "failed") {
        failed += 1;
        log.info(
          `${SOURCE}: ${agencyName} (${agencyId}): no dockets file written, because the search for party ${JSON.stringify(partyName)} failed (${search.error.message}).`,
        );
        return;
      }
      for (const hit of search.results) {
        const docket = docketOfHit(hit, agencyId, partyName);
        if (seen.has(docket.id)) continue;
        seen.add(docket.id);
        dockets.push(docket);
      }
    }

    await writeFile(
      path.join(sourceDir, `${encodeURIComponent(agencyId)}.dockets.json`),
      JSON.stringify(
        {
          agency: {
            id: agencyId,
            name: agencyName,
            state: record.state,
            county,
            place,
          },
          dockets,
        },
        null,
        2,
      ),
    );
    written += 1;
    log.info(
      `${SOURCE}: ${agencyName} (${agencyId}): ${dockets.length} docket(s).`,
    );
  };

  let cursor: string | undefined;
  do {
    const page = await data.agencies({
      states: Object.keys(STATE_COURTS),
      minOfficers: 1,
      cursor,
      limit: 50,
    });
    for (const record of page.items) {
      await processAgency(record);
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  log.info(
    `${SOURCE}: ${written} agencies written, ${failed} left out after a failed search, ${skipped} left out while CourtListener was down.`,
  );
};
