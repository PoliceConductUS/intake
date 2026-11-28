import type { BinaryFileOrigin, StoredBinaryFile } from "../io/BinaryFile.js";
import {
  callRequestFingerprint,
  type CallOutcome,
  type CallRequest,
  type CallResultEnvelope,
} from "../io/CallResult.js";

export type CallCache = {
  readCallResult(request: CallRequest): Promise<CallResultEnvelope | undefined>;
  appendOutcome(
    request: CallRequest,
    outcome: CallOutcome,
  ): Promise<CallResultEnvelope>;
  standingOutcome(
    envelope: CallResultEnvelope | undefined,
    now: Date,
  ): CallOutcome | undefined;
  readBinaryFile(sha256: string): Promise<StoredBinaryFile | undefined>;
  writeBinaryFile(input: {
    bytes: Buffer;
    contentType: string;
    extension: string;
    origin: BinaryFileOrigin;
  }): Promise<StoredBinaryFile>;
};

type ServiceFacts = {
  httpStatus?: number;
  requestId?: string;
  stopReason?: string;
  requestedModel?: string;
  model?: string;
  usage?: Record<string, unknown>;
};

export type CallAttempt =
  | ({ kind: "response"; response: unknown } & ServiceFacts)
  | ({
      kind: "file";
      bytes: Buffer;
      contentType: string;
      extension: string;
      httpStatus: number;
    } & ServiceFacts)
  | ({ kind: "item-failure"; message: string } & ServiceFacts)
  | {
      kind: "outage";
      message: string;
      httpStatus?: number;
      requestedModel?: string;
      retryAfterSeconds?: number;
    };

export type ServiceCheck = { ok: true } | { ok: false; reason: string };

export type ItemFailure = { kind: "item"; message: string };

export type CachedCallResult =
  | { status: "succeeded"; outcome: CallOutcome }
  | { status: "failed"; error: ItemFailure; outcome: CallOutcome }
  | { status: "skipped"; service: string; retryAfter: string };

export type ServiceSkips = {
  service: string;
  downAt?: string;
  skipped: number;
  retryAfter: string;
};

export type ClientDeps = {
  cache: CallCache;
  commandId: string;
  intakeVersion: () => string;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  logger?: { info(message: string): void };
  maxRetries?: number;
  maxBackoffMs?: number;
};

export class ServiceUnavailableError extends Error {
  constructor(
    readonly service: string,
    reason: string,
  ) {
    super(
      `${service} is not available: ${reason}. No work that needs it was started.`,
    );
    this.name = "ServiceUnavailableError";
  }
}

const HOUR_MS = 3_600_000;
const INLINE_RESPONSE_LIMIT = 256 * 1024;

export type ServiceClientBase = ReturnType<typeof createServiceClientBase>;

export function createServiceClientBase(
  deps: ClientDeps & { service: string; check: () => Promise<ServiceCheck> },
) {
  const maxRetries = deps.maxRetries ?? 5;
  const maxBackoffMs = deps.maxBackoffMs ?? 60_000;
  const inFlight = new Map<string, Promise<CachedCallResult>>();
  let checked: Promise<void> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let down: { at: string; retryAfter: string } | undefined;
  let skips: ServiceSkips | undefined;

  function skip(retryAfter: string): CachedCallResult {
    skips = {
      service: deps.service,
      ...(down === undefined ? {} : { downAt: down.at }),
      skipped: (skips?.skipped ?? 0) + 1,
      retryAfter:
        skips === undefined || skips.retryAfter < retryAfter
          ? retryAfter
          : skips.retryAfter,
    };
    return { status: "skipped", service: deps.service, retryAfter };
  }

  function fromOutcome(outcome: CallOutcome): CachedCallResult {
    if (outcome.status === "succeeded") return { status: "succeeded", outcome };
    if (outcome.error!.kind === "item")
      return {
        status: "failed",
        error: { kind: "item", message: outcome.error!.message },
        outcome,
      };
    if (outcome.retryAfter === undefined)
      throw new Error(
        `A ${deps.service} outage outcome has no retryAfter: it would never be tried again.`,
      );
    return skip(outcome.retryAfter);
  }

  function ensureChecked(): Promise<void> {
    checked ??= deps.check().then((result) => {
      if (!result.ok)
        throw new ServiceUnavailableError(deps.service, result.reason);
    });
    return checked;
  }

  async function attemptWithRetries(
    call: () => Promise<CallAttempt>,
  ): Promise<CallAttempt> {
    for (let attempt = 0; ; attempt += 1) {
      const result = await call();
      if (result.kind !== "outage" || attempt >= maxRetries) return result;
      const waitMs = Math.min(
        maxBackoffMs,
        result.retryAfterSeconds !== undefined
          ? result.retryAfterSeconds * 1000
          : 1000 * 2 ** attempt,
      );
      deps.logger?.info(
        `${deps.service}: ${result.message}; trying again in ${Math.round(waitMs / 1000)}s (${attempt + 1} of ${maxRetries}).`,
      );
      await deps.sleep(waitMs);
    }
  }

  async function record(
    request: CallRequest,
    startedAt: string,
    result: CallAttempt,
    refreshAfterMs: number | undefined,
  ): Promise<CallOutcome> {
    const completed = deps.now();
    const common = {
      startedAt,
      completedAt: completed.toISOString(),
      ...(result.httpStatus === undefined
        ? {}
        : { httpStatus: result.httpStatus }),
      ...("requestId" in result && result.requestId !== undefined
        ? { requestId: result.requestId }
        : {}),
      ...("stopReason" in result && result.stopReason !== undefined
        ? { stopReason: result.stopReason }
        : {}),
      ...(result.requestedModel === undefined
        ? {}
        : { requestedModel: result.requestedModel }),
      ...("model" in result && result.model !== undefined
        ? { model: result.model }
        : {}),
      ...("usage" in result && result.usage !== undefined
        ? { usage: result.usage }
        : {}),
      commandId: deps.commandId,
      intakeVersion: deps.intakeVersion(),
    };
    const after = (milliseconds: number) =>
      new Date(completed.getTime() + milliseconds).toISOString();
    let outcome: CallOutcome;
    if (result.kind === "outage") {
      outcome = {
        ...common,
        status: "failed",
        error: { kind: "service", message: result.message },
        retryAfter: after(
          result.retryAfterSeconds !== undefined
            ? result.retryAfterSeconds * 1000
            : HOUR_MS,
        ),
      };
    } else if (result.kind === "item-failure") {
      outcome = {
        ...common,
        status: "failed",
        error: { kind: "item", message: result.message },
      };
    } else {
      const stale =
        refreshAfterMs === undefined
          ? {}
          : { retryAfter: after(refreshAfterMs) };
      const json =
        result.kind === "response"
          ? Buffer.from(JSON.stringify(result.response))
          : undefined;
      if (json !== undefined && json.length <= INLINE_RESPONSE_LIMIT) {
        outcome = {
          ...common,
          ...stale,
          status: "succeeded",
          response: JSON.parse(json.toString()),
        };
      } else {
        if (request.url === undefined)
          throw new Error(
            `A ${deps.service} answer that is kept as a file needs the request's URL for the file's origin.`,
          );
        if (result.httpStatus === undefined)
          throw new Error(
            `A ${deps.service} answer that is kept as a file needs its HTTP status for the file's origin.`,
          );
        const stored = await deps.cache.writeBinaryFile({
          bytes: result.kind === "file" ? result.bytes : json!,
          contentType:
            result.kind === "file" ? result.contentType : "application/json",
          extension: result.kind === "file" ? result.extension : "json",
          origin: {
            kind: "download",
            url: request.url,
            retrievedAt: common.completedAt,
            httpStatus: result.httpStatus,
          },
        });
        outcome = {
          ...common,
          ...stale,
          status: "succeeded",
          file: stored.envelope.spec.sha256,
        };
      }
    }
    await deps.cache.appendOutcome(request, outcome);
    return outcome;
  }

  async function callService(
    request: CallRequest,
    call: () => Promise<CallAttempt>,
    refreshAfterMs: number | undefined,
  ): Promise<CachedCallResult> {
    if (down !== undefined) return skip(down.retryAfter);
    await ensureChecked();
    const startedAt = deps.now().toISOString();
    const result = await attemptWithRetries(call);
    const outcome = await record(request, startedAt, result, refreshAfterMs);
    if (result.kind === "outage") {
      down = { at: outcome.completedAt, retryAfter: outcome.retryAfter! };
      deps.logger?.info(
        `${deps.service}: down at ${down.at} (${result.message}); its calls are skipped for the rest of this command.`,
      );
    }
    return fromOutcome(outcome);
  }

  async function cachedCall(
    request: CallRequest,
    call: () => Promise<CallAttempt>,
    options: { refreshAfterMs?: number } = {},
  ): Promise<CachedCallResult> {
    const fingerprint = callRequestFingerprint(request);
    const pending = inFlight.get(fingerprint);
    if (pending !== undefined) return pending;
    const run = (async () => {
      const standing = deps.cache.standingOutcome(
        await deps.cache.readCallResult(request),
        deps.now(),
      );
      if (standing !== undefined) return fromOutcome(standing);
      const queued = queue.then(() =>
        callService(request, call, options.refreshAfterMs),
      );
      queue = queued.catch(() => undefined);
      return queued;
    })();
    inFlight.set(fingerprint, run);
    try {
      return await run;
    } finally {
      inFlight.delete(fingerprint);
    }
  }

  async function binaryFile(outcome: CallOutcome): Promise<StoredBinaryFile> {
    if (outcome.file === undefined)
      throw new Error(`A ${deps.service} outcome names no file.`);
    const stored = await deps.cache.readBinaryFile(outcome.file);
    if (stored === undefined)
      throw new Error(
        `A ${deps.service} outcome names a file the cache does not hold: ${outcome.file}`,
      );
    return stored;
  }

  async function jsonResponse(outcome: CallOutcome): Promise<unknown> {
    if (outcome.file === undefined) return outcome.response;
    return JSON.parse((await binaryFile(outcome)).bytes.toString("utf8"));
  }

  return {
    service: deps.service,
    cachedCall,
    binaryFile,
    jsonResponse,
    skips: (): ServiceSkips | undefined => skips,
  };
}

export type HttpAnswer =
  | { kind: "answer"; status: number; headers: Headers; body: Buffer }
  | { kind: "outage"; message: string };

export async function httpGet(
  fetchFn: typeof fetch,
  url: string,
  options: { headers?: Record<string, string>; timeoutMs: number },
): Promise<HttpAnswer> {
  try {
    const response = await fetchFn(url, {
      headers: options.headers,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    return {
      kind: "answer",
      status: response.status,
      headers: response.headers,
      body: Buffer.from(await response.arrayBuffer()),
    };
  } catch (error) {
    return {
      kind: "outage",
      message: `no answer from ${new URL(url).host} (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

export function retryAfterSeconds(
  headers: { get(name: string): string | null },
  now: Date,
): number | undefined {
  const value = headers.get("retry-after");
  if (value === null || value.trim() === "") return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

// Design section 4: 429 and 5xx are the service's failure; any other status
// that is not a success is a failure of the one item asked for.
export function httpFailure(
  answer: Extract<HttpAnswer, { kind: "answer" }>,
  url: string,
  now: Date,
): Extract<CallAttempt, { kind: "item-failure" | "outage" }> | undefined {
  if (answer.status >= 200 && answer.status < 300) return undefined;
  if (answer.status === 429 || answer.status >= 500) {
    const seconds = retryAfterSeconds(answer.headers, now);
    return {
      kind: "outage",
      message: `HTTP ${answer.status} from ${new URL(url).host}`,
      httpStatus: answer.status,
      ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }),
    };
  }
  return {
    kind: "item-failure",
    message: `HTTP ${answer.status} for ${url}`,
    httpStatus: answer.status,
  };
}

export function formatServiceSkips(skips: readonly ServiceSkips[]): string[] {
  return skips.map((entry) =>
    entry.downAt === undefined
      ? `${entry.service}: ${entry.skipped} call(s) skipped while waiting after an earlier outage. Try again after ${entry.retryAfter}.`
      : `${entry.service}: went down at ${entry.downAt}; ${entry.skipped} call(s) skipped. Try again after ${entry.retryAfter}.`,
  );
}
