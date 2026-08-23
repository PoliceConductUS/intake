import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";
import { slugify } from "../lib/civil-defendants.js";
import {
  agencyNeedsSearch,
  loadDocketCache,
  REFRESH_DAYS,
  saveDocketCache,
  type Docket,
} from "./docket-cache.js";

const API = "https://www.courtlistener.com/api/rest/v4";
const STATE_COURTS: Record<string, string[]> = {
  TX: ["txnd", "txsd", "txed", "txwd", "ca5"],
  MN: ["mnd", "ca8"],
};
const DEFAULT_MIN_YEAR = 2022;

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

// CourtListener's RECAP search exposes each docket's full party list only behind
// the dedicated `party_name` filter (a `q=party:(...)` query returns just the
// caption parties). The person parties it returns — plaintiffs and defendants
// alike — are matched to the agency roster at import; any officer named in the
// case attaches it (role-agnostic). These are the party names to search for.
function partyNames(agencyName: string, place: string, county: string): string[] {
  const names = [agencyName];
  const isCountyAgency = /\b(county|sheriff|parish)\b/i.test(agencyName);
  if (isCountyAgency && county.trim() !== "") {
    names.push(county.trim());
  } else if (place.trim() !== "") {
    names.push(`City of ${place.trim()}`);
  } else if (county.trim() !== "") {
    names.push(county.trim());
  }
  return [...new Set(names.filter((name) => name.trim() !== ""))];
}

function searchUrl(
  partyName: string,
  courts: string[],
  filedAfter: string,
): string {
  const params = new URLSearchParams({
    type: "r",
    party_name: partyName,
    filed_after: filedAfter,
    order_by: "dateFiled desc",
    court: courts.join(" "),
  });
  return `${API}/search/?${params.toString()}`;
}

async function searchAgencyDockets(
  agencyName: string,
  place: string,
  county: string,
  courts: string[],
  filedAfter: string,
  fetchJson: (url: string) => Promise<Record<string, unknown>>,
): Promise<Docket[]> {
  const dockets: Docket[] = [];
  const seen = new Set<string>();
  for (const partyName of partyNames(agencyName, place, county)) {
    let url = searchUrl(partyName, courts, filedAfter);
    while (url !== "") {
      const body = await fetchJson(url);
      for (const hit of asArray(body.results)) {
        const id = str(hit.docket_id ?? hit.id);
        if (id === "" || seen.has(id)) continue;
        seen.add(id);
        dockets.push({
          id,
          case_name: str(hit.caseName ?? hit.case_name),
          docket_number: str(hit.docketNumber ?? hit.docket_number),
          court: str(hit.court_id ?? hit.court),
          date_filed: str(hit.dateFiled ?? hit.date_filed) || null,
          date_terminated: str(hit.dateTerminated ?? hit.date_terminated) || null,
          cause: str(hit.cause),
          absolute_url: str(hit.docket_absolute_url ?? hit.absolute_url),
          parties: (Array.isArray(hit.party) ? hit.party : [])
            .map((party) => str(party).trim())
            .filter((party) => party !== ""),
        });
      }
      url = str(body.next);
    }
  }
  return dockets;
}

export const acquire: SourceAcquire = async ({
  sourceDir,
  state,
  env,
  data,
  logger,
}: AcquireDeps) => {
  const log = logger ?? { info() {} };
  const token = env.COURT_LISTENER_API_TOKEN;
  if (token === undefined || token.trim() === "") {
    throw new Error(
      "courtlistener: COURT_LISTENER_API_TOKEN is required to search CourtListener.",
    );
  }
  await mkdir(sourceDir, { recursive: true });
  const apiLogPath = path.join(sourceDir, ".api-calls.jsonl");
  const fetchJson = async (url: string): Promise<Record<string, unknown>> => {
    const response = await fetch(url, {
      headers: { Authorization: `Token ${token}` },
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    await appendFile(
      apiLogPath,
      `${JSON.stringify({ at: new Date().toISOString(), url, status: response.status, body })}\n`,
    );
    if (!response.ok) {
      throw new Error(`courtlistener: ${response.status} for ${url}`);
    }
    return body as Record<string, unknown>;
  };
  const minYear = Number(env.COURTLISTENER_MIN_YEAR ?? DEFAULT_MIN_YEAR);
  const filedAfter = `${minYear}-01-01`;
  const onlyWithCases = env.COURTLISTENER_ONLY_WITH_CASES === "true";
  const agenciesFile = env.COURTLISTENER_AGENCIES_FILE;

  const cache = await loadDocketCache(state);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let searched = 0;
  let cached = 0;

  const processAgency = async (
    agencyId: string,
    agencyName: string,
    agencyState: string,
    place: string,
    county: string,
  ): Promise<void> => {
    const courts = STATE_COURTS[agencyState] ?? [];
    if (agencyName === "" || courts.length === 0) return;
    const slug = slugify(agencyName);

    let dockets: Docket[];
    if (agencyNeedsSearch(cache.agencies[slug], nowMs)) {
      dockets = await searchAgencyDockets(
        agencyName,
        place,
        county,
        courts,
        filedAfter,
        fetchJson,
      );
      cache.agencies[slug] = { lastSearchedAt: nowIso, dockets };
      await saveDocketCache(state, cache);
      searched += 1;
      log.info(
        `courtlistener: ${agencyName} — ${dockets.length} docket(s) [searched ${searched}]`,
      );
    } else {
      dockets = cache.agencies[slug].dockets;
      cached += 1;
    }

    await writeFile(
      path.join(sourceDir, `${slug}.dockets.json`),
      JSON.stringify(
        {
          agency: { id: agencyId, name: agencyName, state: agencyState },
          dockets,
        },
        null,
        2,
      ),
    );
  };

  if (agenciesFile !== undefined && agenciesFile.trim() !== "") {
    const list = JSON.parse(await readFile(agenciesFile, "utf8")) as {
      id?: string;
      name?: string;
      state?: string;
      place?: string;
      county?: string;
    }[];
    for (const entry of list) {
      await processAgency(
        str(entry.id),
        str(entry.name).trim(),
        str(entry.state).trim().toUpperCase(),
        str(entry.place),
        str(entry.county),
      );
    }
  } else {
    let cursor: string | undefined;
    do {
      const page = await data.agencies({
        states: Object.keys(STATE_COURTS),
        minOfficers: 1,
        hasCivilCase: onlyWithCases,
        cursor,
        limit: 50,
      });
      for (const record of page.items) {
        await processAgency(
          str(record.agency.id),
          str(record.agency.name).trim(),
          record.state,
          record.place ?? "",
          record.county ?? "",
        );
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
  }

  log.info(
    `courtlistener: ${searched} agencies searched, ${cached} served from cache (< ${REFRESH_DAYS} days).`,
  );
};
