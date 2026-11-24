import type { StoredBinaryFile } from "../io/BinaryFile.js";
import type { CallOutcome, CallRequest } from "../io/CallResult.js";
import {
  createServiceClientBase,
  httpFailure,
  httpGet,
  type ClientDeps,
  type ItemFailure,
  type ServiceClientBase,
  type ServiceSkips,
} from "./client-base.js";

export type DownloadResult =
  | { status: "succeeded"; file: StoredBinaryFile; outcome: CallOutcome }
  | { status: "failed"; error: ItemFailure; outcome: CallOutcome }
  | { status: "skipped"; service: string; retryAfter: string };

export type DownloadClient = {
  download(
    url: string,
    options?: { fetch?: typeof fetch; refreshAfterMs?: number },
  ): Promise<DownloadResult>;
  skips(): ServiceSkips[];
};

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "application/json": "json",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/html": "html",
  "text/plain": "txt",
  "text/csv": "csv",
};

export function downloadRequest(url: string): CallRequest {
  return { service: "download", operation: "get", url };
}

function fileExtension(contentType: string, url: string): string {
  const known = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (known !== undefined) return known;
  const fromPath = /\.([A-Za-z0-9]{1,8})$/.exec(new URL(url).pathname)?.[1];
  return fromPath?.toLowerCase() ?? "bin";
}

export function createDownloadClient(
  deps: ClientDeps & { fetch: typeof fetch; timeoutMs?: number },
): DownloadClient {
  const timeoutMs = deps.timeoutMs ?? 60_000;
  const hosts = new Map<string, ServiceClientBase>();

  function hostBase(url: string, fetchFn: typeof fetch): ServiceClientBase {
    const { origin, host } = new URL(url);
    let base = hosts.get(host);
    if (base === undefined) {
      base = createServiceClientBase({
        ...deps,
        service: `download ${host}`,
        check: async () => {
          const answer = await httpGet(fetchFn, `${origin}/`, { timeoutMs });
          return answer.kind === "answer"
            ? { ok: true }
            : { ok: false, reason: answer.message };
        },
      });
      hosts.set(host, base);
    }
    return base;
  }

  return {
    async download(url, options = {}) {
      const fetchFn = options.fetch ?? deps.fetch;
      const base = hostBase(url, fetchFn);
      const result = await base.cachedCall(
        downloadRequest(url),
        async () => {
          const answer = await httpGet(fetchFn, url, { timeoutMs });
          if (answer.kind === "outage") return answer;
          const failure = httpFailure(answer, url, deps.now());
          if (failure !== undefined) return failure;
          const contentType =
            answer.headers
              .get("content-type")
              ?.split(";")[0]
              .trim()
              .toLowerCase() || "application/octet-stream";
          return {
            kind: "file",
            bytes: answer.body,
            contentType,
            extension: fileExtension(contentType, url),
            httpStatus: answer.status,
          };
        },
        { refreshAfterMs: options.refreshAfterMs },
      );
      if (result.status !== "succeeded") return result;
      return {
        status: "succeeded",
        file: await base.binaryFile(result.outcome),
        outcome: result.outcome,
      };
    },
    skips: () =>
      [...hosts.values()].flatMap((base) => {
        const skips = base.skips();
        return skips === undefined ? [] : [skips];
      }),
  };
}
