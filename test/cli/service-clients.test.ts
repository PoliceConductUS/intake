import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { buildServiceClients } from "../../src/cli/service-clients.js";
import { withParameterStoreSecrets } from "../../src/cli/parameter-store-env.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(answer: (url: string) => Response) {
  const calls: { url: string; headers: Headers }[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return answer(String(input));
  });
  return calls;
}

test("a client takes its key from Parameter Store at its first call, and its results are kept under the source's namespace", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "intake-clients-"));
  const read = vi.fn(() => "stored-token\n");
  const calls = stubFetch(() =>
    Response.json({ results: [{ entry_number: 1 }], next: null }),
  );
  const clients = buildServiceClients({
    workspace,
    namespace: "com/courtlistener/www/api",
    commandId: "command-1",
    env: withParameterStoreSecrets(
      { COURTLISTENER_API_TOKEN: "stale-local-copy" },
      read,
    ),
  });
  expect(read).not.toHaveBeenCalled();

  const result = await clients.courtListener.docketEntries("123");

  expect(result).toMatchObject({
    status: "succeeded",
    entries: [{ entry_number: 1 }],
    outcome: { commandId: "command-1" },
  });
  expect(read.mock.calls).toEqual([
    ["/policeconduct/secrets/COURTLISTENER_API_TOKEN"],
  ]);
  expect(calls.map((call) => call.headers.get("authorization"))).toEqual([
    "Token stored-token",
    "Token stored-token",
  ]);
  expect(result.status === "succeeded" && result.outcome.intakeVersion).toMatch(
    /^[a-f0-9]{40}$/,
  );
  expect(
    await readdir(
      path.join(
        workspace,
        "state/intake/namespaces/com/courtlistener/www/api/CallResult",
      ),
    ),
  ).toHaveLength(1);
});

test("with keepCachedCallResults a stale success is used and nothing is asked of the service", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "intake-clients-"));
  const input = {
    workspace,
    namespace: "com/courtlistener/www/api",
    env: { COURTLISTENER_API_TOKEN: "token" },
  };
  stubFetch(() =>
    Response.json({ results: [{ entry_number: 1 }], next: null }),
  );
  await buildServiceClients({
    ...input,
    commandId: "command-1",
  }).courtListener.docketEntries("123", { refreshAfterMs: -1 });

  const stale = stubFetch(() =>
    Response.json({ results: [{ entry_number: 2 }], next: null }),
  );
  const kept = await buildServiceClients({
    ...input,
    commandId: "command-2",
    keepCachedCallResults: true,
  }).courtListener.docketEntries("123");
  expect(kept.status === "succeeded" && kept.entries).toEqual([
    { entry_number: 1 },
  ]);
  expect(stale).toEqual([]);

  const refreshed = await buildServiceClients({
    ...input,
    commandId: "command-3",
  }).courtListener.docketEntries("123");
  expect(refreshed.status === "succeeded" && refreshed.entries).toEqual([
    { entry_number: 2 },
  ]);
});
