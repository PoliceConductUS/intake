import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { callRequestFingerprint } from "../../../src/shared/io/CallResult.js";
import { ServiceUnavailableError } from "../../../src/shared/services/client-base.js";
import {
  createInferenceClient,
  structuredAnswerRequest,
} from "../../../src/shared/services/inference-client.js";
import { fakeFetch, harness, type FakeAnswer } from "./harness.js";

const schema = z.object({ summary: z.string() }).strict();
const input = {
  model: "claude-opus-5-5",
  prompt: "Summarize the complaint.",
  text: "The plaintiff alleges ...",
  inputName: "complaint-text",
  schema,
  maxTokens: 4096,
  effort: "high" as const,
};
const TEXT_SHA256 = createHash("sha256")
  .update("The plaintiff alleges ...")
  .digest("hex");
const usage = { input_tokens: 120, output_tokens: 30 };

function message(
  text: string,
  overrides: Record<string, unknown> = {},
): FakeAnswer {
  return {
    status: 200,
    headers: { "content-type": "application/json", "request-id": "req_123" },
    body: JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage,
      ...overrides,
    }),
  };
}

function error(status: number, headers: Record<string, string> = {}) {
  return {
    status,
    headers: {
      "content-type": "application/json",
      "request-id": "req_err",
      ...headers,
    },
    body: JSON.stringify({
      type: "error",
      error: { type: "api_error", message: "failed" },
    }),
  };
}

const MODELS: FakeAnswer = {
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    data: [],
    has_more: false,
    first_id: null,
    last_id: null,
  }),
};

function anthropic(messages: () => FakeAnswer, models: FakeAnswer = MODELS) {
  return fakeFetch((url) =>
    new URL(url).pathname === "/v1/models" ? models : messages(),
  );
}

function build(
  deps: Awaited<ReturnType<typeof harness>>["deps"],
  web: ReturnType<typeof fakeFetch>,
  apiKey: string | undefined = "sk-test-key",
) {
  return createInferenceClient({
    ...deps,
    fetch: web.fetch,
    readApiKey: () => apiKey,
    maxRetries: 1,
    maxBackoffMs: 10,
  });
}

const posts = (web: ReturnType<typeof fakeFetch>) =>
  web.calls.filter((call) => new URL(call.url).pathname === "/v1/messages");

describe("InferenceClient", () => {
  test("the request holds what decides the answer and no key", () => {
    const request = structuredAnswerRequest(input);
    expect(request).toEqual({
      service: "anthropic",
      operation: "messages",
      parameters: {
        maxTokens: 4096,
        effort: "high",
        outputSchema: expect.any(Object),
      },
      prompt: "Summarize the complaint.",
      inputs: [{ name: "complaint-text", sha256: TEXT_SHA256 }],
    });
    expect(request.parameters!.outputSchema).toMatchObject({
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    });
  });

  test("each input that decides the answer changes the fingerprint", () => {
    const base = callRequestFingerprint(structuredAnswerRequest(input));
    for (const changed of [
      { ...input, prompt: "Summarise the complaint." },
      { ...input, text: "The plaintiff alleges ... more" },
      { ...input, maxTokens: 8192 },
      { ...input, effort: "low" as const },
      { ...input, effort: undefined },
      {
        ...input,
        schema: z.object({ summary: z.string(), pages: z.string() }),
      },
    ])
      expect(callRequestFingerprint(structuredAnswerRequest(changed))).not.toBe(
        base,
      );
  });

  test("the model does not change the fingerprint", () => {
    expect(
      callRequestFingerprint(
        structuredAnswerRequest({ ...input, model: "claude-sonnet-5-5" }),
      ),
    ).toBe(callRequestFingerprint(structuredAnswerRequest(input)));
  });

  test("two requests that differ only in model make one call and share one cache entry", async () => {
    const h = await harness();
    const web = anthropic(() =>
      message('{"summary":"Once."}', { model: "claude-opus-5-5-20261001" }),
    );
    const client = build(h.deps, web);

    const first = await client.structuredAnswer(input);
    const second = await client.structuredAnswer({
      ...input,
      model: "claude-sonnet-5-5",
    });

    expect(posts(web)).toHaveLength(1);
    expect(await h.callResultCount()).toBe(1);
    expect(first).toMatchObject({
      status: "succeeded",
      value: { summary: "Once." },
      model: "claude-opus-5-5-20261001",
    });
    expect(second).toMatchObject({
      status: "succeeded",
      value: { summary: "Once." },
      model: "claude-opus-5-5-20261001",
    });
    expect(await h.outcomes(structuredAnswerRequest(input))).toMatchObject([
      {
        status: "succeeded",
        requestedModel: "claude-opus-5-5",
        model: "claude-opus-5-5-20261001",
      },
    ]);
  });

  test.each([
    ["no model", { model: undefined }],
    ["a blank model", { model: "" }],
  ])(
    "a response that names %s is an item failure",
    async (_label, overrides) => {
      const h = await harness();
      const web = anthropic(() => message('{"summary":"Unnamed."}', overrides));

      const result = await build(h.deps, web).structuredAnswer(input);

      expect(result).toMatchObject({
        status: "failed",
        error: { kind: "item", message: "The response names no model." },
        outcome: { requestedModel: "claude-opus-5-5", requestId: "req_123" },
      });
      if (result.status !== "failed") throw new Error(result.status);
      expect(result.outcome.model).toBeUndefined();
    },
  );

  test("asks once and records model, parameters, prompt, input hash, request ID, stop reason and tokens", async () => {
    const h = await harness();
    const web = anthropic(() => message('{"summary":"Two paragraphs."}'));
    const client = build(h.deps, web);

    const result = await client.structuredAnswer(input);
    const again = await client.structuredAnswer(input);

    expect(result).toMatchObject({
      status: "succeeded",
      value: { summary: "Two paragraphs." },
    });
    expect(again.status === "succeeded" && again.value).toEqual({
      summary: "Two paragraphs.",
    });
    expect(posts(web)).toHaveLength(1);
    const sent = JSON.parse(String(posts(web)[0].init?.body));
    expect(sent).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      system: "Summarize the complaint.",
      messages: [{ role: "user", content: "The plaintiff alleges ..." }],
      output_config: { effort: "high", format: { type: "json_schema" } },
    });
    expect(
      [...new Headers(posts(web)[0].init?.headers).values()].filter((value) =>
        value.includes("sk-test-key"),
      ),
    ).toHaveLength(1);

    const request = structuredAnswerRequest(input);
    const [stored] = await h.outcomes(request);
    expect(stored).toMatchObject({
      status: "succeeded",
      response: { summary: "Two paragraphs." },
      httpStatus: 200,
      requestId: "req_123",
      stopReason: "end_turn",
      requestedModel: "claude-opus-5-5",
      model: "claude-opus-5-5",
      usage,
      commandId: "command-1",
      intakeVersion: "test-version",
    });
    expect(stored.retryAfter).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain("sk-test-key");
  });

  test.each([
    [
      "refusal",
      {
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: null },
      },
      "The model stopped with refusal (cyber) and gave no usable answer.",
    ],
    [
      "max_tokens",
      { stop_reason: "max_tokens" },
      "The model stopped with max_tokens and gave no usable answer.",
    ],
  ])(
    "a model that stops with %s is an item failure holding the stop reason and request ID",
    async (stopReason, overrides, messageText) => {
      const h = await harness();
      const web = anthropic(() => message("", overrides));
      const client = build(h.deps, web);

      const result = await client.structuredAnswer(input);
      await client.structuredAnswer(input);

      expect(result).toMatchObject({
        status: "failed",
        error: { kind: "item", message: messageText },
      });
      expect(posts(web)).toHaveLength(1);
      const [stored] = await h.outcomes(structuredAnswerRequest(input));
      expect(stored).toMatchObject({
        status: "failed",
        stopReason,
        requestId: "req_123",
        requestedModel: "claude-opus-5-5",
        model: "claude-opus-5-5",
        usage,
      });
      expect(stored.retryAfter).toBeUndefined();
      expect(client.skips()).toEqual([]);
    },
  );

  test.each([
    ["is not JSON", "Here is the summary.", "The model's answer is not JSON."],
    [
      "does not fit the schema",
      '{"summary":1}',
      /^The model's answer does not fit the schema: /,
    ],
  ])("an answer that %s is an item failure", async (_label, text, expected) => {
    const h = await harness();
    const web = anthropic(() => message(text));

    const result = await build(h.deps, web).structuredAnswer(input);

    if (result.status !== "failed") throw new Error(result.status);
    expect(result.error.message).toMatch(expected);
    expect(result.outcome.stopReason).toBe("end_turn");
  });

  test("a 400 for one input is an item failure", async () => {
    const h = await harness();
    const web = anthropic(() => error(400));

    const result = await build(h.deps, web).structuredAnswer(input);

    expect(result).toMatchObject({
      status: "failed",
      error: { kind: "item" },
      outcome: {
        httpStatus: 400,
        requestId: "req_err",
        requestedModel: "claude-opus-5-5",
      },
    });
  });

  test("a rejected key stops the command and records nothing", async () => {
    for (const status of [401, 403]) {
      const h = await harness();
      const web = anthropic(() => message("{}"), error(status));

      const stopped = build(h.deps, web).structuredAnswer(input);
      await expect(stopped).rejects.toBeInstanceOf(ServiceUnavailableError);
      await expect(stopped).rejects.toThrow(
        `anthropic is not available: Anthropic rejected ANTHROPIC_API_KEY (HTTP ${status}).`,
      );
      expect(posts(web)).toHaveLength(0);
      expect(await h.callResultCount()).toBe(0);
    }
  });

  test("a missing key stops the command without a request", async () => {
    const h = await harness();
    const web = anthropic(() => message("{}"));
    await expect(
      build(h.deps, web, "").structuredAnswer(input),
    ).rejects.toThrow("ANTHROPIC_API_KEY is not set");
    expect(web.calls).toEqual([]);
  });

  test("the key is not read while every answer is cached", async () => {
    const h = await harness();
    await build(
      h.deps,
      anthropic(() => message('{"summary":"Cached."}')),
    ).structuredAnswer(input);

    const web = anthropic(() => message("{}"));
    const later = createInferenceClient({
      ...h.nextCommand(),
      fetch: web.fetch,
      readApiKey: () => {
        throw new Error("the key must not be read");
      },
    });

    expect(await later.structuredAnswer(input)).toMatchObject({
      status: "succeeded",
      value: { summary: "Cached." },
    });
    expect(web.calls).toEqual([]);
  });

  test.each([
    [
      "overload",
      () => error(529, { "retry-after": "120" }),
      "2026-11-17T12:02:00.010Z",
    ],
    [
      "no answer",
      () => new TypeError("fetch failed"),
      "2026-11-17T13:00:00.010Z",
    ],
  ] as const)(
    "%s that outlasts the retries skips this and later calls",
    async (_label, answer, retryAfter) => {
      const h = await harness();
      const web = anthropic(answer);
      const client = build(h.deps, web);

      const skipped = await client.structuredAnswer(input);
      const later = await client.structuredAnswer({
        ...input,
        text: "Another complaint.",
      });

      expect(skipped).toEqual({
        status: "skipped",
        service: "anthropic",
        retryAfter,
      });
      expect(later).toEqual(skipped);
      expect(posts(web)).toHaveLength(2);
      expect(await h.outcomes(structuredAnswerRequest(input))).toMatchObject([
        {
          status: "failed",
          error: { kind: "service" },
          requestedModel: "claude-opus-5-5",
          retryAfter,
        },
      ]);
      expect(client.skips()).toMatchObject([
        { service: "anthropic", skipped: 2, retryAfter },
      ]);
    },
  );
});
