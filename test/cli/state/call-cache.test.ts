import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  appendOutcome,
  createCallCache,
  readBinaryFile,
  readCallResult,
  standingOutcome,
  writeBinaryFile,
} from "../../../src/cli/state/call-cache/index.js";
import type { CallOutcome } from "../../../src/shared/io/CallResult.js";

const HELLO =
  "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const NAMESPACE = "com/courtlistener/www/api";
const request = {
  service: "courtlistener",
  operation: "docket-entries",
  url: "https://www.courtlistener.com/api/rest/v4/docket-entries/?docket=1",
};
const now = new Date("2026-11-17T12:00:00.000Z");
const PAST = "2026-11-17T11:00:00.000Z";
const FUTURE = "2026-11-17T13:00:00.000Z";

function outcome(overrides: Partial<CallOutcome> = {}): CallOutcome {
  return {
    status: "succeeded",
    startedAt: "2026-11-17T10:00:00.000Z",
    completedAt: "2026-11-17T10:00:01.000Z",
    response: { results: [] },
    commandId: "command-1",
    intakeVersion: "abc123",
    ...overrides,
  };
}

function failure(overrides: Partial<CallOutcome> = {}): CallOutcome {
  return outcome({
    status: "failed",
    response: undefined,
    error: { kind: "service", message: "HTTP 503" },
    ...overrides,
  });
}

async function location() {
  return {
    rootDir: await mkdtemp(path.join(tmpdir(), "intake-call-cache-")),
    namespace: NAMESPACE,
  };
}

async function envelopeOf(...outcomes: CallOutcome[]) {
  const cache = await location();
  let envelope;
  for (const item of outcomes)
    envelope = await appendOutcome(cache, request, item);
  return envelope!;
}

describe("call cache store", () => {
  test("keeps a call result under the namespace that asked", async () => {
    const cache = await location();
    expect(await readCallResult(cache, request)).toBeUndefined();
    const written = await appendOutcome(cache, request, outcome());
    expect(
      await readdir(
        path.join(
          cache.rootDir,
          "state/intake/namespaces/com/courtlistener/www/api/CallResult",
        ),
      ),
    ).toEqual([`${written.metadata.name}.CallResult.yaml`]);
    expect(await readCallResult(cache, request)).toEqual(written);
    expect(
      await readCallResult({ ...cache, namespace: "com/example" }, request),
    ).toBeUndefined();
  });

  test("appends an outcome and keeps the earlier ones", async () => {
    const cache = await location();
    await appendOutcome(cache, request, failure({ retryAfter: PAST }));
    await appendOutcome(cache, request, outcome());
    expect(
      (await readCallResult(cache, request))!.spec.outcomes.map(
        (item) => item.status,
      ),
    ).toEqual(["failed", "succeeded"]);
  });

  describe("standingOutcome", () => {
    test("no envelope: call", () => {
      expect(standingOutcome(undefined, now)).toBeUndefined();
    });

    for (const [label, make] of [
      ["succeeded", outcome],
      ["failed", failure],
    ] as const) {
      test(`a ${label} outcome with no retryAfter stands`, async () => {
        const envelope = await envelopeOf(make());
        expect(standingOutcome(envelope, now)?.status).toBe(label);
      });

      test(`a ${label} outcome stands until its retryAfter`, async () => {
        const envelope = await envelopeOf(make({ retryAfter: FUTURE }));
        expect(standingOutcome(envelope, now)?.status).toBe(label);
      });

      test(`a ${label} outcome no longer stands at or after its retryAfter`, async () => {
        const passed = await envelopeOf(make({ retryAfter: PAST }));
        expect(standingOutcome(passed, now)).toBeUndefined();
        const exactly = await envelopeOf(
          make({ retryAfter: now.toISOString() }),
        );
        expect(standingOutcome(exactly, now)).toBeUndefined();
      });
    }

    test("only the last outcome is the current one", async () => {
      const envelope = await envelopeOf(
        outcome(),
        failure({ retryAfter: PAST }),
      );
      expect(standingOutcome(envelope, now)).toBeUndefined();
    });

    test("a rebuild keeps a succeeded outcome whose retryAfter has passed", async () => {
      const stale = await envelopeOf(
        outcome({ retryAfter: PAST, response: { results: ["kept"] } }),
        failure({ retryAfter: PAST }),
      );
      expect(
        standingOutcome(stale, now, { keepSucceeded: true })?.response,
      ).toEqual({ results: ["kept"] });
    });

    test("a rebuild still calls for a request with no succeeded outcome", async () => {
      const failedOnly = await envelopeOf(failure({ retryAfter: PAST }));
      expect(
        standingOutcome(failedOnly, now, { keepSucceeded: true }),
      ).toBeUndefined();
      expect(
        standingOutcome(undefined, now, { keepSucceeded: true }),
      ).toBeUndefined();
    });

    test("the bound cache applies the rebuild rule", async () => {
      const stale = await envelopeOf(outcome({ retryAfter: PAST }));
      const cache = await location();
      expect(
        createCallCache(cache).standingOutcome(stale, now),
      ).toBeUndefined();
      expect(
        createCallCache({ ...cache, keepSucceeded: true }).standingOutcome(
          stale,
          now,
        )?.status,
      ).toBe("succeeded");
    });
  });

  describe("binary files", () => {
    const input = {
      bytes: Buffer.from("hello"),
      contentType: "application/pdf",
      extension: "pdf",
      origin: {
        kind: "download" as const,
        url: "https://example.org/hello.pdf",
        retrievedAt: "2026-11-17T10:00:00.000Z",
        httpStatus: 200,
      },
    };
    const directory = (rootDir: string) =>
      path.join(
        rootDir,
        "state/intake/namespaces/com/courtlistener/www/api/BinaryFile",
      );

    test("stores a file by its content, once", async () => {
      const cache = await location();
      expect(await readBinaryFile(cache, HELLO)).toBeUndefined();
      const first = await writeBinaryFile(cache, input);
      const second = await writeBinaryFile(cache, {
        ...input,
        extension: "bin",
        origin: { ...input.origin, url: "https://example.org/other" },
      });
      expect(first.envelope.metadata.name).toBe(HELLO);
      expect(second.envelope).toEqual(first.envelope);
      expect((await readdir(directory(cache.rootDir))).sort()).toEqual([
        `${HELLO}.BinaryFile.yaml`,
        `${HELLO}.pdf`,
      ]);
      expect((await readBinaryFile(cache, HELLO))!.bytes.toString()).toBe(
        "hello",
      );
    });

    test("fails a read when the stored file was altered", async () => {
      const cache = await location();
      const stored = await writeBinaryFile(cache, input);
      await writeFile(stored.filePath, "jello");
      await expect(readBinaryFile(cache, HELLO)).rejects.toThrow(
        `BinaryFile does not hash to its name: ${stored.filePath}`,
      );
    });

    test("fails a read of a file with no envelope", async () => {
      const cache = await location();
      const stored = await writeBinaryFile(cache, input);
      await rm(path.join(directory(cache.rootDir), `${HELLO}.BinaryFile.yaml`));
      await expect(readBinaryFile(cache, HELLO)).rejects.toThrow(
        `BinaryFile file has no envelope: ${stored.filePath}`,
      );
    });

    test("fails a read of an envelope with no file", async () => {
      const cache = await location();
      const stored = await writeBinaryFile(cache, input);
      await rm(stored.filePath);
      await expect(readBinaryFile(cache, HELLO)).rejects.toThrow(
        `BinaryFile envelope has no file: ${stored.filePath}`,
      );
    });

    test("writes the file before its envelope", async () => {
      // A crash between the two leaves a file with no envelope, never an
      // envelope that describes a file which is not there.
      const cache = await location();
      const stored = await writeBinaryFile(cache, input);
      const { stat } = await import("node:fs/promises");
      const file = await stat(stored.filePath, { bigint: true });
      const envelope = await stat(
        path.join(directory(cache.rootDir), `${HELLO}.BinaryFile.yaml`),
        { bigint: true },
      );
      expect(file.birthtimeNs <= envelope.birthtimeNs).toBe(true);
      expect(
        (await readdir(directory(cache.rootDir))).filter((name) =>
          name.endsWith(".tmp"),
        ),
      ).toEqual([]);
    });
  });
});
