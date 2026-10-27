import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { IdentityRestoration } from "../../../src/shared/io/IdentityRestoration.js";
import {
  generateIdentityRestorationEntry,
  listEntries,
  applyPending,
  assertAtHead,
} from "../../../src/cli/data/chain.js";
import { createSourceNameToCanonicalIdLedger } from "../../../src/cli/state/source-name-to-canonical-id/index.js";
import { assertIdentityRestorationComplete } from "../../../src/cli/state/source-name-to-canonical-id/restore.js";
import { SourceNameToCanonicalId } from "../../../src/cli/state/source-name-to-canonical-id/SourceNameToCanonicalId.js";
import { resolveSourceNameToCanonicalIdPath } from "../../../src/cli/state/source-name-to-canonical-id/index.js";

async function setup() {
  const workspace = await mkdtemp(path.join(tmpdir(), "restore-chain-"));
  const root = path.join(workspace, "data");
  const ledger = createSourceNameToCanonicalIdLedger({ rootDir: workspace });
  await ledger.findOrCreate("test", "Agency", "source", async () => "wrong");
  const event = IdentityRestoration.new({
    metadata: { name: "restore", namespace: "test" },
    spec: {
      entityKind: "Agency",
      sourceName: "source",
      expectedCurrentId: "wrong",
      originalId: "original",
      reason: "Restore public identity",
      evidence: "Published URL",
    },
  });
  const applied: { version: string; checksum: string }[] = [];
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    if (sql === "select version from public.data_mutation_applied")
      return { rows: applied };
    if (sql === "select version, checksum from public.data_mutation_applied")
      return { rows: applied };
    if (sql.includes("max(version)"))
      return { rows: [{ version: "20261006000000" }] };
    if (sql.includes("pg_constraint")) return { rows: [] };
    if (sql.startsWith('select "id"')) return { rows: [{ id: "wrong" }] };
    if (sql.startsWith("update public.")) return { rows: [{ id: "original" }] };
    if (sql.startsWith("insert into public.data_mutation_applied"))
      applied.push({
        version: String(values![0]),
        checksum: String(values![2]),
      });
    return { rows: [] };
  });
  const client = { query, connect: async () => {}, end: async () => {} };
  return { workspace, root, ledger, event, client };
}

test("appends restoration without changing identities, then applies and records it", async () => {
  const { root, workspace, ledger, event, client } = await setup();
  const result = await generateIdentityRestorationEntry(client, event, root);
  expect(result.version).toBe("000001");
  expect(await ledger.read("test", "Agency", "source")).toBe("wrong");
  expect((await listEntries(root))[0]!.kind).toBe("IdentityRestoration");
  expect(await applyPending(client, { root })).toEqual([
    { version: "000001", mutationCount: 1 },
  ]);
  await assertIdentityRestorationComplete(event, workspace);
  const calls = client.query.mock.calls.map((call) => call[0]);
  expect(calls.indexOf("begin")).toBeLessThan(
    calls.findIndex((sql) => sql.startsWith("update public.")),
  );
  expect(calls).toContain("commit");
});

test("recovers a committed event with only forward mapping updated; generation blocks until recovery", async () => {
  const { root, workspace, event, client } = await setup();
  await generateIdentityRestorationEntry(client, event, root);
  await applyPending(client, { root });
  // Model interrupted/reverted forward persistence: reverse remains original.
  await SourceNameToCanonicalId.write(
    path.join(
      resolveSourceNameToCanonicalIdPath("test", { rootDir: workspace }),
      "Agency",
    ),
    SourceNameToCanonicalId.new({
      metadata: { name: "source", namespace: "test" },
      spec: { kind: "Agency", canonicalId: "wrong" },
    }),
  );
  await expect(assertAtHead(client, root)).rejects.toThrow("incomplete");
  const before = client.query.mock.calls.filter((call) =>
    call[0].startsWith("update public."),
  ).length;
  expect(await applyPending(client, { root })).toEqual([]);
  expect(
    client.query.mock.calls.filter((call) =>
      call[0].startsWith("update public."),
    ),
  ).toHaveLength(before);
  await assertAtHead(client, root);
});

test("replays restoration after database reconstruction with the completed durable mapping", async () => {
  const { root, event, client, workspace } = await setup();
  await generateIdentityRestorationEntry(client, event, root);
  await applyPending(client, { root });
  // A reconstructed DB has no applied receipts but retains the canonical ledger.
  const originalQuery = client.query.getMockImplementation()!;
  client.query.mockImplementation(async (sql, values) =>
    sql === "select version from public.data_mutation_applied" ||
    sql === "select version, checksum from public.data_mutation_applied"
      ? { rows: [] }
      : originalQuery(sql, values),
  );
  expect(await applyPending(client, { root })).toEqual([
    { version: "000001", mutationCount: 1 },
  ]);
  await assertIdentityRestorationComplete(event, workspace);
});

test("rolls back a failed DB restoration and leaves erroneous mapping untouched", async () => {
  const { root, ledger, event, client } = await setup();
  await generateIdentityRestorationEntry(client, event, root);
  const originalQuery = client.query.getMockImplementation()!;
  client.query.mockImplementation(async (sql, values) => {
    if (sql.startsWith("update public.")) throw new Error("DB failure");
    return originalQuery(sql, values);
  });
  await expect(applyPending(client, { root })).rejects.toThrow("DB failure");
  expect(client.query.mock.calls.map((call) => call[0])).toContain("rollback");
  expect(await ledger.read("test", "Agency", "source")).toBe("wrong");
});

test("refuses ledger recovery from an edited already-applied restoration", async () => {
  const { root, event, client } = await setup();
  const generated = await generateIdentityRestorationEntry(client, event, root);
  await applyPending(client, { root });
  const changed = await IdentityRestoration.read(generated.written);
  await IdentityRestoration.write(
    path.dirname(generated.written),
    IdentityRestoration.new({
      ...changed,
      spec: { ...changed.spec, reason: "Edited after apply" },
    }),
  );
  await expect(applyPending(client, { root })).rejects.toThrow(
    "checksum drift",
  );
});
