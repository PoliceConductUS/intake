// The real, keyed, retrying YouTube Data API fetch an acquire phase injects into
// `createYoutubeApi`. It lives outside the client so the client stays
// deterministic and testable, and so every channel source retries, logs, and
// stops on quota identically rather than each re-deriving the policy.

import { appendFile } from "node:fs/promises";
import {
  isQuotaExhaustedBody,
  quotaResetHint,
  YoutubeQuotaError,
} from "./youtube.js";

const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60_000;

export type DataApiFetchDeps = {
  /** The source id, used to prefix every error so a failure names its source. */
  sourceId: string;
  apiKey: string;
  /** JSONL audit log: every request and its verbatim response body. */
  apiLogPath: string;
  logger?: { info: (message: string) => void };
  /** Injected in tests; production uses the global fetch and a real sleep. */
  fetch?: (url: string) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
};

export function createDataApiFetch(
  deps: DataApiFetchDeps,
): (url: string) => Promise<Record<string, unknown>> {
  const log = deps.logger ?? { info() {} };
  const doFetch = deps.fetch ?? ((url: string) => fetch(url));
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return async (url) => {
    const keyed = `${url}${url.includes("?") ? "&" : "?"}key=${deps.apiKey}`;
    for (let attempt = 0; ; attempt += 1) {
      const response = await doFetch(keyed);
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      await appendFile(
        // codeql[js/http-to-file-access] This fixed JSONL file preserves the source response for audit; downstream transforms parse JSON and never execute it.
        deps.apiLogPath,
        `${JSON.stringify({ at: new Date().toISOString(), url, status: response.status, body })}\n`,
      );
      if (response.ok) return body as Record<string, unknown>;
      if (isQuotaExhaustedBody(body)) {
        throw new YoutubeQuotaError(
          `${deps.sourceId}: YouTube quota exhausted (${response.status}); ${quotaResetHint(body, new Date())}. Stopping (resumes next run).`,
        );
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        throw new Error(`${deps.sourceId}: ${response.status} for ${url}`);
      }
      const waitMs = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
      log.info(
        `${deps.sourceId}: ${response.status}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES}).`,
      );
      await sleep(waitMs);
    }
  };
}
