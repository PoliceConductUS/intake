import { describe, expect, test } from "vitest";
import {
  createServiceClientBase,
  formatServiceSkips,
  httpFailure,
  httpGet,
  retryAfterSeconds,
  ServiceUnavailableError,
  type CallAttempt,
  type ClientDeps,
  type ServiceCheck,
} from "../../../src/shared/services/client-base.js";
import { fakeFetch, harness, START } from "./harness.js";

const request = {
  service: "example",
  operation: "get",
  url: "https://api.example.org/items/1",
};
const other = { ...request, url: "https://api.example.org/items/2" };
const answer: CallAttempt = {
  kind: "response",
  response: { id: 1 },
  httpStatus: 200,
};
const ONE_HOUR_LATER = "2026-11-17T13:00:00.000Z";

function client(
  deps: ClientDeps,
  check: () => Promise<ServiceCheck> = async () => ({ ok: true }),
) {
  let checks = 0;
  const base = createServiceClientBase({
    ...deps,
    service: "example",
    maxRetries: 2,
    check: () => {
      checks += 1;
      return check();
    },
  });
  return { base, checks: () => checks };
}

function scripted(...attempts: CallAttempt[]) {
  let calls = 0;
  return {
    calls: () => calls,
    call: async () => {
      const attempt = attempts[Math.min(calls, attempts.length - 1)];
      calls += 1;
      return attempt;
    },
  };
}

describe("cachedCall and the cache", () => {
  test("calls once, then returns the cached response without calling", async () => {
    const h = await harness();
    const { base, checks } = client(h.deps);
    const service = scripted(answer);

    const first = await base.cachedCall(request, service.call);
    const second = await base.cachedCall(request, service.call);

    expect(first.status).toBe("succeeded");
    expect(second).toEqual(first);
    expect(service.calls()).toBe(1);
    expect(checks()).toBe(1);
    expect(await h.outcomes(request)).toEqual([
      {
        status: "succeeded",
        startedAt: START,
        completedAt: START,
        response: { id: 1 },
        httpStatus: 200,
        commandId: "command-1",
        intakeVersion: "test-version",
      },
    ]);
  });

  test("a request that differs only in its prompt is a new envelope", async () => {
    const h = await harness();
    const { base } = client(h.deps);
    const service = scripted(answer);
    const model = { service: "example", operation: "messages" };

    await base.cachedCall({ ...model, prompt: "Summarize." }, service.call);
    await base.cachedCall({ ...model, prompt: "Summarise." }, service.call);

    expect(service.calls()).toBe(2);
    expect(await h.callResultCount()).toBe(2);
    expect(await h.outcomes({ ...model, prompt: "Summarize." })).toHaveLength(
      1,
    );
  });

  test("a fully cached command neither checks nor calls", async () => {
    const h = await harness();
    await client(h.deps).base.cachedCall(request, scripted(answer).call);

    const later = client(h.nextCommand(), async () => {
      throw new Error("the service must not be contacted");
    });
    const service = scripted(answer);
    const result = await later.base.cachedCall(request, service.call);

    expect(result.status).toBe("succeeded");
    expect(service.calls()).toBe(0);
    expect(later.checks()).toBe(0);
  });

  test("a success with refreshAfterMs is called again once that time passes", async () => {
    const h = await harness();
    const { base } = client(h.deps);
    const service = scripted(answer, {
      ...answer,
      response: { id: 1, newer: true },
    });

    await base.cachedCall(request, service.call, { refreshAfterMs: 60_000 });
    h.advance(59_000);
    await base.cachedCall(request, service.call, { refreshAfterMs: 60_000 });
    expect(service.calls()).toBe(1);

    h.advance(1_000);
    const refreshed = await base.cachedCall(request, service.call, {
      refreshAfterMs: 60_000,
    });
    expect(service.calls()).toBe(2);
    expect(
      refreshed.status === "succeeded" && refreshed.outcome.response,
    ).toEqual({ id: 1, newer: true });
    expect(
      (await h.outcomes(request)).map((outcome) => outcome.retryAfter),
    ).toEqual(["2026-11-17T12:01:00.000Z", "2026-11-17T12:02:00.000Z"]);
  });

  test("a rebuild uses a stale success as it is and calls only what has none", async () => {
    const h = await harness();
    await client(h.deps).base.cachedCall(request, scripted(answer).call, {
      refreshAfterMs: 60_000,
    });
    h.advance(120_000);

    const rebuild = client(h.nextCommand({ keepSucceeded: true }));
    const service = scripted({ ...answer, response: { id: 2 } });
    const cached = await rebuild.base.cachedCall(request, service.call);
    expect(service.calls()).toBe(0);
    expect(cached.status === "succeeded" && cached.outcome.response).toEqual({
      id: 1,
    });

    const fresh = await rebuild.base.cachedCall(other, service.call);
    expect(service.calls()).toBe(1);
    expect(fresh.status === "succeeded" && fresh.outcome.response).toEqual({
      id: 2,
    });
  });

  test("two callers asking for the same request at once share one call", async () => {
    const h = await harness();
    const { base } = client(h.deps);
    const service = scripted(answer);

    const results = await Promise.all([
      base.cachedCall(request, service.call),
      base.cachedCall(request, service.call),
      base.cachedCall(other, service.call),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(service.calls()).toBe(2);
    expect(await h.outcomes(request)).toHaveLength(1);
  });

  test("rejects a request that carries an Authorization value, before any call", async () => {
    const h = await harness();
    const { base, checks } = client(h.deps);
    const service = scripted(answer);

    await expect(
      base.cachedCall(
        { ...request, parameters: { Authorization: "Token abc" } },
        service.call,
      ),
    ).rejects.toThrow("CallResult request is malformed at parameters.");
    expect(service.calls()).toBe(0);
    expect(checks()).toBe(0);
    expect(await h.callResultCount()).toBe(0);
  });

  test("keeps a JSON answer over 256 KB as a binary file named in the outcome", async () => {
    const h = await harness();
    const { base } = client(h.deps);
    const big = { text: "x".repeat(300 * 1024) };

    const result = await base.cachedCall(
      request,
      scripted({ kind: "response", response: big, httpStatus: 200 }).call,
    );

    if (result.status !== "succeeded") throw new Error(result.status);
    expect(result.outcome.response).toBeUndefined();
    expect(result.outcome.file).toMatch(/^[a-f0-9]{64}$/);
    expect(await h.binaryFileNames()).toEqual([
      `${result.outcome.file}.BinaryFile.yaml`,
      `${result.outcome.file}.json`,
    ]);
    expect(await base.jsonResponse(result.outcome)).toEqual(big);
  });
});

describe("item failures and outages (design section 4)", () => {
  test("an item failure is recorded with no retryAfter and returned; the command goes on", async () => {
    const h = await harness();
    const { base } = client(h.deps);
    const missing = scripted({
      kind: "item-failure",
      message: "HTTP 404 for https://api.example.org/items/1",
      httpStatus: 404,
    });

    const failed = await base.cachedCall(request, missing.call);
    const again = await base.cachedCall(request, missing.call);
    const next = await base.cachedCall(other, scripted(answer).call);

    expect(failed).toMatchObject({
      status: "failed",
      error: {
        kind: "item",
        message: "HTTP 404 for https://api.example.org/items/1",
      },
    });
    expect(again).toEqual(failed);
    expect(missing.calls()).toBe(1);
    expect(next.status).toBe("succeeded");
    expect(await h.outcomes(request)).toEqual([
      {
        status: "failed",
        startedAt: START,
        completedAt: START,
        error: {
          kind: "item",
          message: "HTTP 404 for https://api.example.org/items/1",
        },
        httpStatus: 404,
        commandId: "command-1",
        intakeVersion: "test-version",
      },
    ]);
    expect(base.skips()).toBeUndefined();
  });

  test("a model's unusable answer is an item failure that keeps the service's facts", async () => {
    const h = await harness();
    const { base } = client(h.deps);
    const model = {
      service: "example",
      operation: "messages",
      prompt: "Summarize.",
    };

    const refused = await base.cachedCall(
      model,
      scripted({
        kind: "item-failure",
        message: "The model stopped with refusal.",
        httpStatus: 200,
        requestId: "req_1",
        stopReason: "refusal",
        requestedModel: "m",
        model: "m-2026",
        usage: { input_tokens: 10, output_tokens: 0 },
      }).call,
    );

    expect(refused.status).toBe("failed");
    expect(await h.outcomes(model)).toMatchObject([
      {
        status: "failed",
        error: { kind: "item" },
        requestId: "req_1",
        stopReason: "refusal",
        requestedModel: "m",
        model: "m-2026",
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    ]);
    expect((await h.outcomes(model))[0].retryAfter).toBeUndefined();
  });

  test("a service that is down at the start stops the command and records nothing", async () => {
    const h = await harness();
    const { base, checks } = client(h.deps, async () => ({
      ok: false,
      reason: "the service rejected EXAMPLE_TOKEN (HTTP 401)",
    }));
    const service = scripted(answer);

    const stopped = base.cachedCall(request, service.call);
    await expect(stopped).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(stopped).rejects.toThrow(
      "example is not available: the service rejected EXAMPLE_TOKEN (HTTP 401).",
    );
    await expect(base.cachedCall(other, service.call)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );

    expect(service.calls()).toBe(0);
    expect(checks()).toBe(1);
    expect(await h.callResultCount()).toBe(0);
  });

  test("an outage that outlasts the retries is recorded, marks the service down and skips", async () => {
    const h = await harness();
    const { base } = client(h.deps);
    const down = scripted({
      kind: "outage",
      message: "HTTP 503 from api.example.org",
      httpStatus: 503,
    });
    const later = scripted(answer);

    const skipped = await base.cachedCall(request, down.call);
    const alsoSkipped = await base.cachedCall(other, later.call);

    // 1 try + 2 retries, backing off 1s then 2s; the outcome is an hour after
    // the last failure because the service named no time.
    expect(down.calls()).toBe(3);
    expect(h.sleeps).toEqual([1000, 2000]);
    const failedAt = "2026-11-17T12:00:03.000Z";
    const retryAfter = "2026-11-17T13:00:03.000Z";
    expect(skipped).toEqual({
      status: "skipped",
      service: "example",
      retryAfter,
    });
    expect(alsoSkipped).toEqual(skipped);
    expect(later.calls()).toBe(0);
    expect(await h.outcomes(request)).toEqual([
      {
        status: "failed",
        startedAt: START,
        completedAt: failedAt,
        error: { kind: "service", message: "HTTP 503 from api.example.org" },
        httpStatus: 503,
        retryAfter,
        commandId: "command-1",
        intakeVersion: "test-version",
      },
    ]);
    expect(await h.outcomes(other)).toEqual([]);
    expect(base.skips()).toEqual({
      service: "example",
      downAt: failedAt,
      skipped: 2,
      retryAfter,
    });
  });

  test("an outage takes its retryAfter from the service's Retry-After", async () => {
    const h = await harness();
    const { base } = client(h.deps);

    const skipped = await base.cachedCall(
      request,
      scripted({
        kind: "outage",
        message: "HTTP 429 from api.example.org",
        httpStatus: 429,
        retryAfterSeconds: 30,
      }).call,
    );

    expect(h.sleeps).toEqual([30_000, 30_000]);
    expect(skipped).toMatchObject({
      status: "skipped",
      retryAfter: "2026-11-17T12:01:30.000Z",
    });
  });

  test("a call that recovers within its retries succeeds and marks nothing down", async () => {
    const h = await harness();
    const { base } = client(h.deps);
    const flaky = scripted(
      { kind: "outage", message: "no answer from api.example.org" },
      answer,
    );

    const result = await base.cachedCall(request, flaky.call);

    expect(result.status).toBe("succeeded");
    expect(flaky.calls()).toBe(2);
    expect(base.skips()).toBeUndefined();
    expect(await h.outcomes(request)).toHaveLength(1);
  });

  test("the next run skips until retryAfter, then makes the skipped call", async () => {
    const h = await harness();
    await client(h.deps).base.cachedCall(
      request,
      scripted({ kind: "outage", message: "no answer" }).call,
    );
    const retryAfter = (await h.outcomes(request))[0].retryAfter!;

    const soon = client(h.nextCommand());
    const service = scripted(answer);
    expect(await soon.base.cachedCall(request, service.call)).toEqual({
      status: "skipped",
      service: "example",
      retryAfter,
    });
    expect(service.calls()).toBe(0);
    expect(soon.checks()).toBe(0);
    expect(soon.base.skips()).toEqual({
      service: "example",
      skipped: 1,
      retryAfter,
    });
    // An earlier outage skips its own request only: the service is tried for others.
    expect((await soon.base.cachedCall(other, service.call)).status).toBe(
      "succeeded",
    );

    h.advance(3_600_000);
    const afterwards = client(h.nextCommand());
    expect(
      (await afterwards.base.cachedCall(request, service.call)).status,
    ).toBe("succeeded");
    expect(
      (await h.outcomes(request)).map((outcome) => outcome.status),
    ).toEqual(["failed", "succeeded"]);
  });

  test("anything else thrown by a call is a defect and fails", async () => {
    const h = await harness();
    const { base } = client(h.deps);
    await expect(
      base.cachedCall(request, async () => {
        throw new TypeError("results is not iterable");
      }),
    ).rejects.toThrow("results is not iterable");
    expect(await h.callResultCount()).toBe(0);
    expect((await base.cachedCall(other, scripted(answer).call)).status).toBe(
      "succeeded",
    );
  });
});

describe("HTTP helpers", () => {
  const now = new Date(START);

  test("httpGet returns the answer, and an outage when there is none", async () => {
    const ok = fakeFetch(() => ({ status: 200, body: "hello" }));
    expect(
      await httpGet(ok.fetch, "https://example.org/a", {
        headers: { Accept: "text/plain" },
        timeoutMs: 1000,
      }),
    ).toMatchObject({
      kind: "answer",
      status: 200,
      body: Buffer.from("hello"),
    });
    expect(new Headers(ok.calls[0].init?.headers).get("accept")).toBe(
      "text/plain",
    );

    const refused = fakeFetch(() => new TypeError("fetch failed"));
    expect(
      await httpGet(refused.fetch, "https://example.org/a", {
        timeoutMs: 1000,
      }),
    ).toEqual({
      kind: "outage",
      message: "no answer from example.org (fetch failed)",
    });
  });

  test("httpGet gives up at its timeout", async () => {
    const hangs = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () =>
          reject(init!.signal!.reason),
        );
      })) as unknown as typeof fetch;
    expect(
      await httpGet(hangs, "https://example.org/a", { timeoutMs: 5 }),
    ).toMatchObject({ kind: "outage" });
  });

  test("httpFailure sorts a status into success, item failure or outage", () => {
    const at = (status: number, headers: Record<string, string> = {}) =>
      httpFailure(
        {
          kind: "answer",
          status,
          headers: new Headers(headers),
          body: Buffer.alloc(0),
        },
        "https://example.org/a",
        now,
      );
    expect(at(200)).toBeUndefined();
    for (const status of [400, 401, 403, 404, 410])
      expect(at(status)).toEqual({
        kind: "item-failure",
        message: `HTTP ${status} for https://example.org/a`,
        httpStatus: status,
      });
    for (const status of [429, 500, 502, 503])
      expect(at(status)).toEqual({
        kind: "outage",
        message: `HTTP ${status} from example.org`,
        httpStatus: status,
      });
    expect(at(429, { "retry-after": "120" })).toMatchObject({
      kind: "outage",
      retryAfterSeconds: 120,
    });
  });

  test("retryAfterSeconds reads seconds or a date", () => {
    const header = (value?: string) =>
      new Headers(value === undefined ? {} : { "retry-after": value });
    expect(retryAfterSeconds(header(), now)).toBeUndefined();
    expect(retryAfterSeconds(header("45"), now)).toBe(45);
    expect(
      retryAfterSeconds(header("Tue, 17 Nov 2026 12:10:00 GMT"), now),
    ).toBe(600);
    expect(retryAfterSeconds(header("soon"), now)).toBeUndefined();
  });

  test("formatServiceSkips names the service, the calls skipped and when to try again", () => {
    expect(
      formatServiceSkips([
        {
          service: "courtlistener",
          downAt: START,
          skipped: 12,
          retryAfter: ONE_HOUR_LATER,
        },
        { service: "anthropic", skipped: 1, retryAfter: ONE_HOUR_LATER },
      ]),
    ).toEqual([
      `courtlistener: went down at ${START}; 12 call(s) skipped. Try again after ${ONE_HOUR_LATER}.`,
      `anthropic: 1 call(s) skipped while waiting after an earlier outage. Try again after ${ONE_HOUR_LATER}.`,
    ]);
  });
});
