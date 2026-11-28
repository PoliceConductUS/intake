import { describe, expect, test } from "vitest";
import { callRequestFingerprint } from "../../../src/shared/io/CallResult.js";
import { ServiceUnavailableError } from "../../../src/shared/services/client-base.js";
import {
  createCourtListenerClient,
  docketEntriesRequest,
  docketIdFromUrl,
  searchDocketsRequest,
} from "../../../src/shared/services/courtlistener-client.js";
import { fakeFetch, harness, type FakeAnswer } from "./harness.js";

const API = "https://www.courtlistener.com/api/rest/v4";
const CHECK = `${API}/courts/?page_size=1`;
const ENTRIES = `${API}/docket-entries/?docket=123&order_by=entry_number`;
const SEARCH = `${API}/search/?type=r&party_name=Irving+Police+Department&filed_after=2022-01-01&order_by=dateFiled+desc&court=txnd+ca5`;
const search = {
  partyName: "Irving Police Department",
  courts: ["txnd", "ca5"],
  filedAfter: "2022-01-01",
};
const json = (body: unknown): FakeAnswer => ({
  status: 200,
  body: JSON.stringify(body),
});

function api(pages: Record<string, FakeAnswer>, check: FakeAnswer = json({})) {
  return fakeFetch((url) => {
    if (url === CHECK) return check;
    const answer = pages[url];
    if (answer === undefined) throw new Error(`Unexpected request: ${url}`);
    return answer;
  });
}

function build(
  deps: Awaited<ReturnType<typeof harness>>["deps"],
  web: ReturnType<typeof fakeFetch>,
  token: string | undefined = "secret-token",
) {
  return createCourtListenerClient({
    ...deps,
    fetch: web.fetch,
    readToken: () => token,
    maxRetries: 1,
    maxBackoffMs: 10,
  });
}

describe("CourtListenerClient", () => {
  test("builds requests that hold the URL and no token", () => {
    expect(searchDocketsRequest(search)).toEqual({
      service: "courtlistener",
      operation: "search",
      url: SEARCH,
    });
    expect(docketEntriesRequest("123")).toEqual({
      service: "courtlistener",
      operation: "docket-entries",
      url: ENTRIES,
    });
    expect(() => docketEntriesRequest("123; drop")).toThrow(
      "Invalid CourtListener docket ID: 123; drop",
    );
  });

  test("each input that decides a search's answer changes its fingerprint", () => {
    const base = callRequestFingerprint(searchDocketsRequest(search));
    for (const changed of [
      { ...search, partyName: "City of Irving" },
      { ...search, courts: ["txnd"] },
      { ...search, filedAfter: "2023-01-01" },
    ])
      expect(callRequestFingerprint(searchDocketsRequest(changed))).not.toBe(
        base,
      );
    expect(callRequestFingerprint(docketEntriesRequest("124"))).not.toBe(
      callRequestFingerprint(docketEntriesRequest("123")),
    );
  });

  test("reads a docket ID from a docket address on www.courtlistener.com only", () => {
    expect(
      docketIdFromUrl(
        "https://www.courtlistener.com/docket/68123456/doe-v-roe/",
      ),
    ).toBe("68123456");
    expect(
      docketIdFromUrl("https://www.courtlistener.com/docket/68123456/"),
    ).toBe("68123456");
    expect(
      docketIdFromUrl("https://www.courtlistener.com/opinion/68123456/x/"),
    ).toBeUndefined();
    expect(
      docketIdFromUrl("https://example.org/docket/68123456/x/"),
    ).toBeUndefined();
    expect(docketIdFromUrl("not a url")).toBeUndefined();
  });

  test("searches every page with the token, once, and stales the result when asked", async () => {
    const h = await harness();
    const second = `${API}/search/?cursor=abc&type=r`;
    const web = api({
      [SEARCH]: json({ results: [{ docket_id: 1 }], next: second }),
      [second]: json({ results: [{ docket_id: 2 }], next: null }),
    });
    const client = build(h.deps, web);

    const result = await client.searchDockets(search, {
      refreshAfterMs: 120 * 86_400_000,
    });
    const again = await client.searchDockets(search, {
      refreshAfterMs: 120 * 86_400_000,
    });

    if (result.status !== "succeeded") throw new Error(result.status);
    expect(result.results).toEqual([{ docket_id: 1 }, { docket_id: 2 }]);
    expect(again.status === "succeeded" && again.results).toEqual(
      result.results,
    );
    expect(web.calls.map((call) => call.url)).toEqual([CHECK, SEARCH, second]);
    for (const call of web.calls)
      expect(new Headers(call.init?.headers).get("authorization")).toBe(
        "Token secret-token",
      );
    // 120 days after 2026-11-17T12:00:00Z.
    expect(result.outcome.retryAfter).toBe("2027-03-17T12:00:00.000Z");
    const [stored] = await h.outcomes(searchDocketsRequest(search));
    expect(JSON.stringify(stored)).not.toContain("secret-token");
    expect(stored.response).toEqual({
      results: [{ docket_id: 1 }, { docket_id: 2 }],
    });
  });

  test("lists a docket's entries", async () => {
    const h = await harness();
    const web = api({
      [ENTRIES]: json({
        results: [{ entry_number: 1, recap_documents: [] }],
        next: null,
      }),
    });

    const result = await build(h.deps, web).docketEntries("123");

    if (result.status !== "succeeded") throw new Error(result.status);
    expect(result.entries).toEqual([{ entry_number: 1, recap_documents: [] }]);
    expect(result.outcome.retryAfter).toBeUndefined();
  });

  test("a rejected token stops the command and writes no call result", async () => {
    for (const status of [401, 403]) {
      const h = await harness();
      const web = api({}, { status });
      const client = build(h.deps, web);

      const stopped = client.docketEntries("123");
      await expect(stopped).rejects.toBeInstanceOf(ServiceUnavailableError);
      await expect(stopped).rejects.toThrow(
        `courtlistener is not available: CourtListener rejected COURTLISTENER_API_TOKEN (HTTP ${status}).`,
      );
      expect(web.calls.map((call) => call.url)).toEqual([CHECK]);
      expect(await h.callResultCount()).toBe(0);
    }
  });

  test("a missing token stops the command without a request", async () => {
    const h = await harness();
    const web = api({});
    await expect(build(h.deps, web, "  ").docketEntries("123")).rejects.toThrow(
      "COURTLISTENER_API_TOKEN is not set",
    );
    expect(web.calls).toEqual([]);
  });

  test("a 404 for one docket is that docket's failure", async () => {
    const h = await harness();
    const other = `${API}/docket-entries/?docket=124&order_by=entry_number`;
    const web = api({
      [ENTRIES]: { status: 404 },
      [other]: json({ results: [], next: null }),
    });
    const client = build(h.deps, web);

    expect(await client.docketEntries("123")).toMatchObject({
      status: "failed",
      error: { kind: "item", message: `HTTP 404 for ${ENTRIES}` },
    });
    expect((await client.docketEntries("124")).status).toBe("succeeded");
  });

  test("an answer without the expected shape is an item failure, not a thrown error", async () => {
    for (const body of ["<html>", JSON.stringify({ results: "none" })]) {
      const h = await harness();
      const web = api({ [ENTRIES]: { status: 200, body } });
      expect(await build(h.deps, web).docketEntries("123")).toMatchObject({
        status: "failed",
        error: {
          kind: "item",
          message: `CourtListener's answer for ${ENTRIES} does not have the expected shape.`,
        },
      });
    }
  });

  test("a next page outside the API is an item failure and gets no token", async () => {
    const h = await harness();
    const web = api({
      [ENTRIES]: json({ results: [], next: "https://evil.example.org/next" }),
    });

    const result = await build(h.deps, web).docketEntries("123");

    expect(result).toMatchObject({ status: "failed", error: { kind: "item" } });
    expect(web.calls.map((call) => call.url)).toEqual([CHECK, ENTRIES]);
  });

  test("throttling that outlasts the retries skips this and later calls", async () => {
    const h = await harness();
    const web = api({
      [ENTRIES]: { status: 429, headers: { "retry-after": "300" } },
    });
    const client = build(h.deps, web);

    const skipped = await client.docketEntries("123");
    const later = await client.searchDockets(search);

    expect(skipped).toEqual({
      status: "skipped",
      service: "courtlistener",
      retryAfter: "2026-11-17T12:05:00.010Z",
    });
    expect(later).toEqual(skipped);
    expect(web.calls.map((call) => call.url)).toEqual([
      CHECK,
      ENTRIES,
      ENTRIES,
    ]);
    expect(client.skips()).toEqual([
      {
        service: "courtlistener",
        downAt: "2026-11-17T12:00:00.010Z",
        skipped: 2,
        retryAfter: "2026-11-17T12:05:00.010Z",
      },
    ]);
  });
});
