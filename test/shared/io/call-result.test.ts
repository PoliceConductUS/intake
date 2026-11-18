import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  CallResult,
  callRequestFingerprint,
} from "../../../src/shared/io/CallResult.js";

const request = {
  service: "download",
  operation: "get",
  url: "https://example.org/a.pdf",
};
// The request's stable JSON, keys sorted, written out by hand.
const name = createHash("sha256")
  .update(
    '{"operation":"get","service":"download","url":"https://example.org/a.pdf"}',
  )
  .digest("hex");
const succeeded = {
  status: "succeeded" as const,
  startedAt: "2026-11-17T10:00:00.000Z",
  completedAt: "2026-11-17T10:00:01.000Z",
  response: { ok: true },
  commandId: "command-1",
  intakeVersion: "abc123",
};
const failed = {
  status: "failed" as const,
  startedAt: "2026-11-17T09:00:00.000Z",
  completedAt: "2026-11-17T09:00:01.000Z",
  error: { kind: "item" as const, message: "HTTP 404" },
  httpStatus: 404,
  commandId: "command-0",
  intakeVersion: "abc123",
};

function envelope(outcomes: unknown[], overrides: object = {}) {
  return {
    metadata: { name, namespace: "com/example" },
    spec: { request, outcomes },
    ...overrides,
  } as Parameters<typeof CallResult.new>[0];
}

async function directory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "intake-call-result-"));
}

describe("CallResult", () => {
  test("is named by the fingerprint of its request", async () => {
    expect(callRequestFingerprint(request)).toBe(name);
    const written = await CallResult.write(
      await directory(),
      CallResult.new(envelope([succeeded])),
    );
    expect(path.basename(written.path)).toBe(`${name}.CallResult.yaml`);
    expect((await CallResult.read(written.path)).spec.request).toEqual(request);
  });

  test("ignores an absent optional field when naming", () => {
    expect(callRequestFingerprint({ ...request, prompt: undefined })).toBe(
      name,
    );
  });

  test("rejects a request that names a model", () => {
    expect(() =>
      callRequestFingerprint({ ...request, model: "claude-opus-5-5" } as never),
    ).toThrow("CallResult request is malformed at");
  });

  test("an outcome holds the model asked for and the model that answered", async () => {
    const outcome = {
      ...succeeded,
      requestedModel: "claude-opus-5-5",
      model: "claude-sonnet-5-5",
    };
    const written = await CallResult.write(
      await directory(),
      CallResult.new(envelope([outcome])),
    );
    expect((await CallResult.read(written.path)).spec.outcomes).toEqual([
      outcome,
    ]);
  });

  test("rejects a name that is not the request's fingerprint", () => {
    expect(() =>
      CallResult.new(
        envelope([succeeded], {
          metadata: { name: "0".repeat(64), namespace: "com/example" },
        }),
      ),
    ).toThrow("CallResult is malformed at metadata.name.");
  });

  test("rejects keys outside the schema", () => {
    expect(() =>
      CallResult.new(envelope([{ ...succeeded, confidence: 1 }])),
    ).toThrow("CallResult is malformed at spec.outcomes.0.confidence.");
    expect(() =>
      CallResult.new(
        envelope([succeeded], {
          spec: { request: { ...request, headers: {} }, outcomes: [succeeded] },
        }),
      ),
    ).toThrow("CallResult is malformed at spec.request.headers.");
  });

  test("rejects a request that holds a key", () => {
    for (const bad of [
      { ...request, parameters: { headers: { Authorization: "Token abc" } } },
      { ...request, parameters: { cookie: "session=1" } },
      { ...request, url: "https://example.org/a.pdf?api_key=abc" },
      { ...request, url: "https://user:secret@example.org/a.pdf" },
    ])
      expect(() => callRequestFingerprint(bad)).toThrow(
        /CallResult request is malformed at (parameters|url)\./,
      );
  });

  test("rejects an outcome whose status and content disagree", () => {
    expect(() =>
      CallResult.new(envelope([{ ...succeeded, error: failed.error }])),
    ).toThrow("CallResult is malformed at spec.outcomes.0.error.");
    expect(() =>
      CallResult.new(envelope([{ ...failed, error: undefined }])),
    ).toThrow("CallResult is malformed at spec.outcomes.0.error.");
    expect(() =>
      CallResult.new(envelope([{ ...failed, response: {} }])),
    ).toThrow("CallResult is malformed at spec.outcomes.0.response.");
    expect(() =>
      CallResult.new(envelope([{ ...succeeded, file: "a".repeat(64) }])),
    ).toThrow("CallResult is malformed at spec.outcomes.0.response.");
    expect(() => CallResult.new(envelope([]))).toThrow(
      "CallResult is malformed at spec.outcomes.",
    );
  });

  test("keeps earlier outcomes: a write that drops or changes one fails", async () => {
    const dir = await directory();
    const first = await CallResult.write(
      dir,
      CallResult.new(envelope([failed])),
    );
    await CallResult.write(dir, CallResult.new(envelope([failed, succeeded])));
    expect(
      (await CallResult.read(first.path)).spec.outcomes.map(
        (outcome) => outcome.status,
      ),
    ).toEqual(["failed", "succeeded"]);
    const before = await readFile(first.path, "utf8");

    await expect(
      CallResult.write(dir, CallResult.new(envelope([succeeded]))),
    ).rejects.toThrow("would drop or change earlier outcomes");
    await expect(
      CallResult.write(
        dir,
        CallResult.new(envelope([{ ...failed, httpStatus: 500 }, succeeded])),
      ),
    ).rejects.toThrow("would drop or change earlier outcomes");
    expect(await readFile(first.path, "utf8")).toBe(before);
  });
});
