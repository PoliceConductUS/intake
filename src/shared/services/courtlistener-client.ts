import type { CallOutcome, CallRequest } from "../io/CallResult.js";
import {
  createServiceClientBase,
  httpFailure,
  httpGet,
  type CallAttempt,
  type ClientDeps,
  type ItemFailure,
  type ServiceSkips,
} from "./client-base.js";

const ORIGIN = "https://www.courtlistener.com";
const API = `${ORIGIN}/api/rest/v4`;

type Records = Record<string, unknown>[];
type Failed = { status: "failed"; error: ItemFailure; outcome: CallOutcome };
type Skipped = { status: "skipped"; service: string; retryAfter: string };

export type CourtListenerSearchResult =
  | { status: "succeeded"; results: Records; outcome: CallOutcome }
  | Failed
  | Skipped;

export type CourtListenerEntriesResult =
  | { status: "succeeded"; entries: Records; outcome: CallOutcome }
  | Failed
  | Skipped;

export type CourtListenerClient = {
  searchDockets(
    input: { partyName: string; courts: readonly string[]; filedAfter: string },
    options?: { refreshAfterMs?: number },
  ): Promise<CourtListenerSearchResult>;
  docketEntries(
    docketId: string,
    options?: { refreshAfterMs?: number },
  ): Promise<CourtListenerEntriesResult>;
  skips(): ServiceSkips[];
};

export function docketIdFromUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.origin !== ORIGIN) return undefined;
  return /^\/docket\/(\d+)\//.exec(parsed.pathname)?.[1];
}

export function searchDocketsRequest(input: {
  partyName: string;
  courts: readonly string[];
  filedAfter: string;
}): CallRequest {
  const params = new URLSearchParams({
    type: "r",
    party_name: input.partyName,
    filed_after: input.filedAfter,
    order_by: "dateFiled desc",
    court: input.courts.join(" "),
  });
  return {
    service: "courtlistener",
    operation: "search",
    url: `${API}/search/?${params.toString()}`,
  };
}

export function docketEntriesRequest(docketId: string): CallRequest {
  if (!/^\d+$/.test(docketId))
    throw new Error(`Invalid CourtListener docket ID: ${docketId}`);
  return {
    service: "courtlistener",
    operation: "docket-entries",
    url: `${API}/docket-entries/?docket=${docketId}&order_by=entry_number`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createCourtListenerClient(
  deps: ClientDeps & {
    fetch: typeof fetch;
    readToken: () => string | undefined;
    timeoutMs?: number;
  },
): CourtListenerClient {
  const timeoutMs = deps.timeoutMs ?? 60_000;
  let token: string | undefined;

  function get(url: string) {
    if (new URL(url).origin !== ORIGIN)
      throw new Error(
        `Refusing to send the CourtListener token outside ${ORIGIN}: ${url}`,
      );
    return httpGet(deps.fetch, url, {
      headers: { Authorization: `Token ${token}` },
      timeoutMs,
    });
  }

  const base = createServiceClientBase({
    ...deps,
    service: "courtlistener",
    check: async () => {
      token = deps.readToken()?.trim();
      if (token === undefined || token === "")
        return { ok: false, reason: "COURTLISTENER_API_TOKEN is not set" };
      const answer = await get(`${API}/courts/?page_size=1`);
      if (answer.kind === "outage")
        return { ok: false, reason: answer.message };
      if (answer.status === 401 || answer.status === 403)
        return {
          ok: false,
          reason: `CourtListener rejected COURTLISTENER_API_TOKEN (HTTP ${answer.status})`,
        };
      if (answer.status < 200 || answer.status >= 300)
        return {
          ok: false,
          reason: `HTTP ${answer.status} from CourtListener`,
        };
      return { ok: true };
    },
  });

  async function allPages(firstUrl: string): Promise<CallAttempt> {
    const results: Records = [];
    const seen = new Set<string>();
    let url: string | null = firstUrl;
    let httpStatus = 200;
    while (url !== null) {
      if (seen.has(url) || !url.startsWith(`${API}/`))
        return {
          kind: "item-failure",
          message: `CourtListener gave an unusable next page for ${firstUrl}: ${url}`,
        };
      seen.add(url);
      const answer = await get(url);
      if (answer.kind === "outage") return answer;
      const failure = httpFailure(answer, url, deps.now());
      if (failure !== undefined) return failure;
      httpStatus = answer.status;
      let page: unknown;
      try {
        page = JSON.parse(answer.body.toString("utf8"));
      } catch {
        page = undefined;
      }
      if (
        !isRecord(page) ||
        !Array.isArray(page.results) ||
        !page.results.every(isRecord) ||
        (page.next !== null &&
          page.next !== undefined &&
          typeof page.next !== "string")
      )
        return {
          kind: "item-failure",
          message: `CourtListener's answer for ${url} does not have the expected shape.`,
          httpStatus,
        };
      results.push(...page.results);
      url = page.next === undefined || page.next === "" ? null : page.next;
    }
    return { kind: "response", response: { results }, httpStatus };
  }

  async function records(
    request: CallRequest,
    options: { refreshAfterMs?: number },
  ): Promise<
    | { status: "succeeded"; records: Records; outcome: CallOutcome }
    | Failed
    | Skipped
  > {
    const result = await base.cachedCall(
      request,
      () => allPages(request.url!),
      options,
    );
    if (result.status !== "succeeded") return result;
    const response = (await base.jsonResponse(result.outcome)) as {
      results: Records;
    };
    return {
      status: "succeeded",
      records: response.results,
      outcome: result.outcome,
    };
  }

  return {
    async searchDockets(input, options = {}) {
      const result = await records(searchDocketsRequest(input), options);
      if (result.status !== "succeeded") return result;
      return {
        status: "succeeded",
        results: result.records,
        outcome: result.outcome,
      };
    },
    async docketEntries(docketId, options = {}) {
      const result = await records(docketEntriesRequest(docketId), options);
      if (result.status !== "succeeded") return result;
      return {
        status: "succeeded",
        entries: result.records,
        outcome: result.outcome,
      };
    },
    skips: () => {
      const skips = base.skips();
      return skips === undefined ? [] : [skips];
    },
  };
}
