import { afterEach, expect, test, vi } from "vitest";
import { dailyDeps } from "../../../sources/com/serpapi/landing-page-search/daily.js";
import { withParameterStoreSecrets } from "../../../src/cli/parameter-store-env.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const stored: Record<string, string> = {
  "/policeconduct/secrets/SERPAPI_KEY": "stored-serpapi",
  "/policeconduct/secrets/SEARCH_CONSOLE_CREDENTIALS":
    '{"client_email":"e","private_key":"k"}',
  "/policeconduct/secrets/NEWS_INFERENCE_API_KEY": "stored-inference",
};

function stubLocalEnvironment() {
  for (const [name, value] of Object.entries({
    NEWS_PRIVATE_BUCKET: "private",
    NEWS_SITE_BUCKET: "site",
    NEWS_SITE_ORIGIN: "https://example.org/news",
    NEWS_INFERENCE_URL: "https://inference.example/v1",
    NEWS_INFERENCE_MODEL: "model",
    SEARCH_CONSOLE_PROPERTY: "sc-domain:example.org",
    SEARCH_CONSOLE_CREDENTIALS: "stale local copy, not JSON",
    SERPAPI_KEY: "stale-local-copy",
    NEWS_INFERENCE_API_KEY: "stale-local-copy",
  }))
    vi.stubEnv(name, value);
}

test("daily takes its API keys from Parameter Store, not local values", () => {
  stubLocalEnvironment();
  const read = vi.fn((name: string) => stored[name]);

  const deps = dailyDeps(withParameterStoreSecrets(process.env, read));

  expect(deps.apiKey).toBe("stored-serpapi");
  expect(read.mock.calls.map(([name]) => name).sort()).toEqual([
    "/policeconduct/secrets/SEARCH_CONSOLE_CREDENTIALS",
    "/policeconduct/secrets/SERPAPI_KEY",
  ]);
});

test("daily news inference sends the NEWS_INFERENCE_API_KEY stored in Parameter Store", async () => {
  stubLocalEnvironment();
  const headers: Array<Record<string, string>> = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    headers.push(init.headers as Record<string, string>);
    return new Response("unavailable", { status: 503 });
  });
  const deps = dailyDeps(
    withParameterStoreSecrets(process.env, (name) => stored[name]),
  );

  await expect(deps.infer("body", [])).rejects.toThrow("HTTP 503");

  expect(headers.map((h) => h.Authorization)).toEqual([
    "Bearer stored-inference",
  ]);
});
