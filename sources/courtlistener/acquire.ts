import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";
import { slugify } from "../lib/civil-defendants.js";

const API = "https://www.courtlistener.com/api/rest/v4";
const STATE_COURTS: Record<string, string[]> = {
  TX: ["txnd", "txsd", "txed", "txwd"],
  MN: ["mnd"],
};
const NATURE_OF_SUIT = ["440", "550", "555"];
const DEFAULT_MIN_YEAR = 2022;

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((v) => str(v).trim()).filter((v) => v !== "")
    : [];
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
        parties: stringArray(hit.party),
      });
    }
    url = str(body.next);
  }
  return dockets;
}

export const acquire: SourceAcquire = async ({
  sourceDir,
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
  await mkdir(sourceDir, { recursive: true });

  let cursor: string | undefined;
  let searched = 0;
  do {
    const page = await data.agencies({
      states: Object.keys(STATE_COURTS),
      cursor,
      limit: 50,
    });
    for (const record of page.items) {
      const agencyName = str(record.agency.name).trim();
      const courts = STATE_COURTS[record.state] ?? [];
      if (agencyName === "" || courts.length === 0) continue;
      const destination = path.join(
        sourceDir,
        `${slugify(agencyName)}.dockets.json`,
      );
      if (await fileExists(destination)) continue;

      const dockets = await searchAgencyDockets(
        agencyName,
        courts,
        filedAfter,
        fetchJson,
      );
      await writeFile(
        destination,
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
      searched += 1;
      log.info(
        `courtlistener: ${agencyName} — ${dockets.length} docket(s) [${searched}]`,
      );
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
};
