import { mkdir, writeFile } from "node:fs/promises";
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
  TX: ["txnd", "txsd", "txed", "txwd"],
  MN: ["mnd"],
};
const NATURE_OF_SUIT = ["440", "550", "555"];
const DEFAULT_MIN_YEAR = 2022;

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

async function fetchDefendants(
  docketId: string,
  fetchJson: (url: string) => Promise<Record<string, unknown>>,
): Promise<string[]> {
  const body = await fetchJson(`${API}/parties/?docket=${docketId}`);
  return asArray(body.results)
    .filter((party) =>
      asArray(party.party_types).some(
        (type) => str(type.name).toLowerCase() === "defendant",
      ),
    )
    .map((party) => str(party.name).trim())
    .filter((name) => name !== "");
}

function searchUrl(
  agencyName: string,
  courts: string[],
  filedAfter: string,
): string {
  const params = new URLSearchParams({
    type: "r",
    q: `"${agencyName}"`,
    filed_after: filedAfter,
  });
  for (const court of courts) params.append("court", court);
  for (const nos of NATURE_OF_SUIT) params.append("nature_of_suit", nos);
  return `${API}/search/?${params.toString()}`;
}

async function searchAgencyDockets(
  agencyName: string,
  courts: string[],
  filedAfter: string,
  fetchJson: (url: string) => Promise<Record<string, unknown>>,
): Promise<Docket[]> {
  const dockets: Docket[] = [];
  let url = searchUrl(agencyName, courts, filedAfter);
  while (url !== "") {
    const body = await fetchJson(url);
    for (const hit of asArray(body.results)) {
      const id = str(hit.docket_id ?? hit.id);
      if (id === "") continue;
      dockets.push({
        id,
        case_name: str(hit.caseName ?? hit.case_name),
        docket_number: str(hit.docketNumber ?? hit.docket_number),
        court: str(hit.court_id ?? hit.court),
        date_filed: str(hit.dateFiled ?? hit.date_filed) || null,
        date_terminated: str(hit.dateTerminated ?? hit.date_terminated) || null,
        cause: str(hit.cause),
        absolute_url: str(hit.docket_absolute_url ?? hit.absolute_url),
        defendants: await fetchDefendants(id, fetchJson),
      });
    }
    url = str(body.next);
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
  const fetchJson = async (url: string): Promise<Record<string, unknown>> => {
    const response = await fetch(url, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!response.ok) {
      throw new Error(`courtlistener: ${response.status} for ${url}`);
    }
    return (await response.json()) as Record<string, unknown>;
  };
  const minYear = Number(env.COURTLISTENER_MIN_YEAR ?? DEFAULT_MIN_YEAR);
  const filedAfter = `${minYear}-01-01`;
  const onlyWithCases = env.COURTLISTENER_ONLY_WITH_CASES === "true";
  await mkdir(sourceDir, { recursive: true });

  const cache = await loadDocketCache(state);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  let cursor: string | undefined;
  let searched = 0;
  let cached = 0;
  do {
    const page = await data.agencies({
      states: Object.keys(STATE_COURTS),
      minOfficers: 1,
      hasCivilCase: onlyWithCases,
      cursor,
      limit: 50,
    });
    for (const record of page.items) {
      const agencyName = str(record.agency.name).trim();
      const courts = STATE_COURTS[record.state] ?? [];
      if (agencyName === "" || courts.length === 0) continue;
      const slug = slugify(agencyName);

      let dockets: Docket[];
      if (agencyNeedsSearch(cache.agencies[slug], nowMs)) {
        dockets = await searchAgencyDockets(
          agencyName,
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
            agency: {
              id: str(record.agency.id),
              name: agencyName,
              state: record.state,
            },
            dockets,
          },
          null,
          2,
        ),
      );
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  log.info(
    `courtlistener: ${searched} agencies searched, ${cached} served from cache (< ${REFRESH_DAYS} days).`,
  );
};
