import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";
import { slugify } from "../lib/civil-defendants.js";
import { CLEARINGHOUSE_STATE_ID } from "./state-ids.js";

const API = "https://clearinghouse.net/api/v2p1";
const POLICING_CASE_TYPE = 5039;
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60_000;

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function bodyText(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

// The Clearinghouse API answers a zero-match search with HTTP 400 and a body of
// `["No results for {...}"]` rather than 200 with an empty result set. That is a
// normal "this agency has no cases", not a failure.
export function isNoResults(status: number, body: unknown): boolean {
  return (
    status === 400 &&
    Array.isArray(body) &&
    String(body[0] ?? "").startsWith("No results")
  );
}

export const acquire: SourceAcquire = async ({
  sourceDir,
  env,
  data,
  logger,
}: AcquireDeps) => {
  const log = logger ?? { info() {} };
  const token = env.CLEARING_HOUSE_API_TOKEN;
  if (token === undefined || token.trim() === "") {
    throw new Error(
      "clearinghouse-api: CLEARING_HOUSE_API_TOKEN is required to search the Clearinghouse.",
    );
  }
  await mkdir(sourceDir, { recursive: true });
  const apiLogPath = path.join(sourceDir, ".api-calls.jsonl");

  const fetchJson = async (url: string): Promise<Record<string, unknown>> => {
    for (let attempt = 0; ; attempt += 1) {
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
        `${JSON.stringify({
          at: new Date().toISOString(),
          url,
          status: response.status,
          // Log the body on any non-2xx so a failure is diagnosable from the log
          // alone, without re-running the request to see why.
          ...(response.ok ? {} : { body }),
        })}\n`,
      );
      if (response.ok) return body as Record<string, unknown>;
      // A zero-match search is a 400 here (see isNoResults) — return an empty
      // page instead of throwing, so an agency with no cases is not a failure.
      if (isNoResults(response.status, body)) {
        return { results: [], next: "" };
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        throw new Error(
          `clearinghouse: ${response.status} for ${url}: ${bodyText(body)}`,
        );
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
      log.info(
        `clearinghouse: ${response.status} throttled; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES}).`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  };

  // A case's dockets carry the court-assigned docket number (`docket_number_manual`
  // / `recap_docket_number`) and a `recap_link` to the matching CourtListener
  // docket — the identity the import keys a CivilCase on (ADR 0028). Cached by
  // case id so a case naming several agencies is fetched once. `docket_entries`
  // (every filing) is dropped — bulky and unused.
  const docketCache = new Map<string, Record<string, unknown>[]>();
  const docketsForCase = async (
    caseId: string,
  ): Promise<Record<string, unknown>[]> => {
    const cached = docketCache.get(caseId);
    if (cached !== undefined) return cached;
    const raw = await fetchJson(
      `${API}/cases/${encodeURIComponent(caseId)}/dockets/`,
    );
    const rows = Array.isArray(raw)
      ? (raw as Record<string, unknown>[])
      : asArray((raw as { results?: unknown }).results);
    const dockets = rows.map(({ docket_entries: _ignored, ...rest }) => rest);
    docketCache.set(caseId, dockets);
    return dockets;
  };

  const casesForAgency = async (
    name: string,
    stateId: number,
  ): Promise<Record<string, unknown>[]> => {
    const cases: Record<string, unknown>[] = [];
    const params = new URLSearchParams({
      text: name,
      state: String(stateId),
      case_type: String(POLICING_CASE_TYPE),
    });
    let url = `${API}/cases/?${params.toString()}`;
    while (url !== "") {
      const body = await fetchJson(url);
      cases.push(...asArray(body.results));
      url = str(body.next);
    }
    for (const civilCase of cases) {
      civilCase.dockets = await docketsForCase(str(civilCase.id));
    }
    return cases;
  };

  let searched = 0;
  let skipped = 0;
  let failed = 0;
  let agenciesWithCases = 0;
  let totalCases = 0;
  // Page every agency into memory first, so the long, throttled search phase below
  // does not hold a DB connection open across it — a DB restart mid-run would
  // otherwise drop the idle connection. The agency list is only a few thousand rows.
  const agencyRecords: Awaited<ReturnType<typeof data.agencies>>["items"] = [];
  let cursor: string | undefined;
  do {
    const page = await data.agencies({ minOfficers: 1, cursor, limit: 50 });
    agencyRecords.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  for (const record of agencyRecords) {
    const agencyName = record.name.trim();
    const stateId = CLEARINGHOUSE_STATE_ID[record.state.toUpperCase()];
    if (agencyName === "" || stateId === undefined) {
      skipped += 1;
      continue;
    }
    let cases: Record<string, unknown>[];
    try {
      cases = await casesForAgency(agencyName, stateId);
    } catch (error) {
      failed += 1;
      log.info(
        `clearinghouse: ${agencyName} — search failed, skipped (${error instanceof Error ? error.message : String(error)}).`,
      );
      continue;
    }
    searched += 1;
    totalCases += cases.length;
    if (cases.length > 0) agenciesWithCases += 1;
    await writeFile(
      path.join(sourceDir, `${slugify(agencyName)}.cases.json`),
      JSON.stringify(
        {
          agency: {
            id: record.agencyId,
            name: agencyName,
            state: record.state,
          },
          cases,
        },
        null,
        2,
      ),
    );
    log.info(
      `clearinghouse: ${agencyName} — ${cases.length} case(s) [searched ${searched}]`,
    );
  }

  log.info(
    `clearinghouse: ${totalCases} case(s) across ${agenciesWithCases} of ${searched} agencies searched; ` +
      `${skipped} skipped (no clearinghouse state id), ${failed} skipped after errors.`,
  );
};
