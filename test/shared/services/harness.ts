import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCallCache } from "../../../src/cli/state/call-cache/index.js";
import type { CallRequest } from "../../../src/shared/io/CallResult.js";
import type { ClientDeps } from "../../../src/shared/services/client-base.js";
import type { ServiceClients } from "../../../src/shared/services/index.js";

export const NAMESPACE = "com/example/source";
export const START = "2026-11-17T12:00:00.000Z";

export type Harness = {
  rootDir: string;
  deps: ClientDeps;
  sleeps: number[];
  advance(milliseconds: number): void;
  outcomes(request: CallRequest): Promise<
    {
      status: string;
      retryAfter?: string;
      error?: { kind: string; message: string };
      [key: string]: unknown;
    }[]
  >;
  callResultCount(): Promise<number>;
  binaryFileNames(): Promise<string[]>;
  nextCommand(options?: { keepSucceeded?: boolean }): ClientDeps;
};

export async function harness(
  options: { keepSucceeded?: boolean; rootDir?: string } = {},
): Promise<Harness> {
  const rootDir =
    options.rootDir ??
    (await mkdtemp(path.join(tmpdir(), "intake-service-client-")));
  let time = Date.parse(START);
  const sleeps: number[] = [];
  const cacheFor = (keepSucceeded?: boolean) =>
    createCallCache({ rootDir, namespace: NAMESPACE, keepSucceeded });
  const depsFor = (commandId: string, keepSucceeded?: boolean): ClientDeps => ({
    cache: cacheFor(keepSucceeded),
    commandId,
    intakeVersion: () => "test-version",
    now: () => new Date(time),
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      time += milliseconds;
    },
  });
  const kindDirectory = (kind: string) =>
    path.join(rootDir, "state/intake/namespaces", NAMESPACE, kind);
  const names = async (kind: string) => {
    try {
      return (await readdir(kindDirectory(kind))).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  };
  let commands = 1;
  return {
    rootDir,
    deps: depsFor("command-1", options.keepSucceeded),
    sleeps,
    advance: (milliseconds) => {
      time += milliseconds;
    },
    outcomes: async (request) =>
      (await cacheFor().readCallResult(request))?.spec.outcomes ?? [],
    callResultCount: async () => (await names("CallResult")).length,
    binaryFileNames: () => names("BinaryFile"),
    nextCommand: (next = {}) => {
      commands += 1;
      return depsFor(`command-${commands}`, next.keepSucceeded);
    },
  };
}

export type FakeAnswer =
  | { status: number; body?: string | Buffer; headers?: Record<string, string> }
  | Error;

export function fakeFetch(
  answer: (url: string, init?: RequestInit) => FakeAnswer,
): { fetch: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    calls,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url, init });
      const result = answer(url, init);
      if (result instanceof Error) throw result;
      return new Response(
        result.status === 204 || result.status === 304
          ? null
          : typeof result.body === "string"
            ? result.body
            : new Uint8Array(result.body ?? []),
        { status: result.status, headers: result.headers },
      );
    }) as typeof fetch,
  };
}

export function unusedServiceClients(): ServiceClients {
  const unused = <Client extends object>(name: string): Client =>
    new Proxy({} as Client, {
      get(_target, method) {
        throw new Error(
          `This test gave no ${name} client, and ${name}.${String(method)} was used.`,
        );
      },
    });
  return {
    courtListener: unused("courtListener"),
    inference: unused("inference"),
    download: unused("download"),
    pdfText: unused("pdfText"),
    skips: () => [],
  };
}
