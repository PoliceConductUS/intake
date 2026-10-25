import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { createDataApiFetch } from "../../../sources/lib/youtube-data-api-fetch.js";
import { YoutubeQuotaError } from "../../../sources/lib/youtube.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

async function fetchWith(responses: Response[]) {
  const dir = await mkdtemp(path.join(tmpdir(), "youtube-fetch-"));
  tempDirs.push(dir);
  const apiLogPath = path.join(dir, ".api-calls.jsonl");
  const urls: string[] = [];
  const waits: number[] = [];
  const fetchJson = createDataApiFetch({
    sourceId: "youtube.test",
    apiKey: "KEY123",
    apiLogPath,
    fetch: async (url) => {
      urls.push(url);
      return responses.shift() ?? response(500, {});
    },
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { fetchJson, apiLogPath, urls, waits };
}

describe("createDataApiFetch", () => {
  it("appends the api key and returns the parsed body", async () => {
    const { fetchJson, urls } = await fetchWith([
      response(200, { items: [{ id: "UC1" }] }),
    ]);

    expect(await fetchJson("https://api.test/channels?part=id")).toEqual({
      items: [{ id: "UC1" }],
    });
    expect(urls).toEqual(["https://api.test/channels?part=id&key=KEY123"]);
  });

  it("starts the query string when the url has none", async () => {
    const { fetchJson, urls } = await fetchWith([response(200, {})]);
    await fetchJson("https://api.test/channels");
    expect(urls[0]).toBe("https://api.test/channels?key=KEY123");
  });

  it("logs every request and its verbatim body for audit", async () => {
    const { fetchJson, apiLogPath } = await fetchWith([
      response(200, { items: [] }),
    ]);
    await fetchJson("https://api.test/search?q=x");

    const logged = (await readFile(apiLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(logged).toHaveLength(1);
    expect(logged[0].url).toBe("https://api.test/search?q=x");
    expect(logged[0].status).toBe(200);
    expect(logged[0].body).toEqual({ items: [] });
    expect(typeof logged[0].at).toBe("string");
  });

  it("retries a 5xx with capped exponential backoff, then succeeds", async () => {
    const { fetchJson, waits } = await fetchWith([
      response(503, { error: {} }),
      response(500, { error: {} }),
      response(200, { items: [1] }),
    ]);

    expect(await fetchJson("https://api.test/search")).toEqual({ items: [1] });
    expect(waits).toEqual([1000, 2000]);
  });

  it("gives up after the retry budget, naming the source", async () => {
    const { fetchJson } = await fetchWith(
      Array.from({ length: 6 }, () => response(503, { error: {} })),
    );

    await expect(fetchJson("https://api.test/search")).rejects.toThrow(
      /^youtube\.test: 503 for https:\/\/api\.test\/search$/,
    );
  });

  it("does not retry a non-retryable status", async () => {
    const { fetchJson, urls } = await fetchWith([
      response(404, { error: { errors: [{ reason: "notFound" }] } }),
    ]);

    await expect(fetchJson("https://api.test/channels")).rejects.toThrow(
      /youtube\.test: 404/,
    );
    expect(urls).toHaveLength(1);
  });

  it("stops the run on an exhausted quota instead of retrying it", async () => {
    const { fetchJson, urls } = await fetchWith([
      response(403, { error: { errors: [{ reason: "quotaExceeded" }] } }),
    ]);

    await expect(fetchJson("https://api.test/search")).rejects.toThrow(
      YoutubeQuotaError,
    );
    expect(urls).toHaveLength(1);
  });

  it("treats a 429 rate-limit body as quota, not as a retryable error", async () => {
    const { fetchJson, urls } = await fetchWith([
      response(429, {
        error: {
          errors: [{ reason: "rateLimitExceeded" }],
          status: "RESOURCE_EXHAUSTED",
        },
      }),
    ]);

    await expect(fetchJson("https://api.test/search")).rejects.toThrow(
      YoutubeQuotaError,
    );
    expect(urls).toHaveLength(1);
  });
});
