import { createSign } from "node:crypto";
import { shiftDate, type SearchRow } from "./discovery.js";

export function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required");
  return value;
}
async function json<T>(response: Response, service: string): Promise<T> {
  if (!response.ok)
    throw new Error(service + " returned HTTP " + response.status);
  return response.json() as Promise<T>;
}
export function searchConsole(
  property: string,
  credentials: { client_email: string; private_key: string },
) {
  let token = "",
    expiry = 0;
  async function accessToken() {
    if (Date.now() < expiry) return token;
    const now = Math.floor(Date.now() / 1000),
      aud = "https://oauth2.googleapis.com/token";
    const encode = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    const payload =
      encode({ alg: "RS256", typ: "JWT" }) +
      "." +
      encode({
        iss: credentials.client_email,
        scope: "https://www.googleapis.com/auth/webmasters.readonly",
        aud,
        iat: now,
        exp: now + 3600,
      });
    const assertion =
      payload +
      "." +
      createSign("RSA-SHA256")
        .update(payload)
        .sign(credentials.private_key, "base64url");
    const response = await json<{ access_token: string; expires_in: number }>(
      await fetch(aud, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      }),
      "Google authentication",
    );
    token = response.access_token;
    expiry = Date.now() + (response.expires_in - 60) * 1000;
    return token;
  }
  async function query(body: Record<string, unknown>) {
    const url =
      "https://www.googleapis.com/webmasters/v3/sites/" +
      encodeURIComponent(property) +
      "/searchAnalytics/query";
    return json<{
      rows?: SearchRow[];
      metadata?: { first_incomplete_date?: string };
    }>(
      await fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + (await accessToken()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "web", dataState: "final", ...body }),
      }),
      "Search Console",
    );
  }
  return {
    async latestWindow(now: Date) {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      const result = await query({
        startDate: shiftDate(today, -14),
        endDate: today,
        dimensions: ["date"],
        dataState: "all",
      });
      const endDate = result.metadata?.first_incomplete_date
        ? shiftDate(result.metadata.first_incomplete_date, -1)
        : result.rows
            ?.map((r) => r.keys[0]!)
            .sort()
            .at(-1);
      if (!endDate)
        throw new Error("Search Console supplied no reporting dates");
      return { startDate: shiftDate(endDate, -6), endDate };
    },
    async rows(
      window: { startDate: string; endDate: string },
      startRow: number,
    ) {
      return (
        (
          await query({
            ...window,
            startRow,
            rowLimit: 25000,
            dimensions: ["query", "page"],
          })
        ).rows ?? []
      );
    },
    async position(
      term: string,
      page: string,
      startDate: string,
      endDate: string,
    ) {
      const response = await query({
        startDate,
        endDate,
        dimensionFilterGroups: [
          {
            filters: [
              { dimension: "page", operator: "equals", expression: page },
              { dimension: "query", operator: "equals", expression: term },
            ],
          },
        ],
      });
      return response.rows?.[0]?.position ?? null;
    },
  };
}
export class ProviderAllowance extends Error {}
export async function newsResults(
  term: string,
  officer: string,
  start: number,
  apiKey: string,
) {
  const account = await json<{
    plan_monthly_price: number;
    plan_searches_left: number;
    this_hour_searches: number;
    account_rate_limit_per_hour: number;
  }>(
    await fetch(
      "https://serpapi.com/account.json?" +
        new URLSearchParams({ api_key: apiKey }),
    ),
    "Search allowance",
  );
  if (
    account.plan_monthly_price !== 0 ||
    !(account.plan_searches_left > 0) ||
    account.this_hour_searches >= account.account_rate_limit_per_hour
  )
    throw new ProviderAllowance("Free search allowance unavailable");
  const params = new URLSearchParams({
    engine: "google",
    tbm: "nws",
    tbs: "qdr:w",
    q: term + " " + officer,
    api_key: apiKey,
    start: String(start),
    gl: "us",
    hl: "en",
  });
  const response = await fetch("https://serpapi.com/search.json?" + params);
  if (response.status === 429)
    throw new ProviderAllowance("Search allowance exhausted");
  const page = await json<{
    error?: string;
    news_results?: Array<{ link: string }>;
    serpapi_pagination?: { next?: string };
  }>(response, "Google News search");
  if (page.error && !/no results|hasn't returned any results/i.test(page.error))
    throw new Error("Google News search returned an error");
  let nextStart: number | null = null;
  const next = page.serpapi_pagination?.next;
  if (next) {
    const nextOffset = new URL(next).searchParams.get("start");
    if (
      !nextOffset ||
      !/^\d+$/.test(nextOffset) ||
      !Number.isSafeInteger(Number(nextOffset)) ||
      Number(nextOffset) <= start
    )
      throw new Error("Invalid next page offset from Google News search");
    nextStart = Number(nextOffset);
  }
  return {
    urls: (page.news_results ?? []).map((r) => r.link),
    nextStart,
  };
}
