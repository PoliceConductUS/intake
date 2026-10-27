import { expect, test, vi } from "vitest";
import { IdentityRestoration } from "../../../src/shared/io/IdentityRestoration.js";
import { restoreDatabaseIdentity } from "../../../src/cli/database/restore-identity.js";
const event = IdentityRestoration.new({
  metadata: { name: "event", namespace: "test" },
  spec: {
    entityKind: "Agency",
    sourceName: "source",
    expectedCurrentId: "wrong",
    originalId: "original",
    reason: "Restore original",
    evidence: "Published URL",
  },
});
function client(rows: Record<string, unknown>[][]) {
  const query = vi.fn(async (_sql: string, _values?: readonly unknown[]) => ({
    rows: rows.shift() ?? [],
  }));
  return { connect: async () => {}, end: async () => {}, query };
}
test("restores only the expected row and refuses a target collision", async () => {
  const db = client([[], [{ id: "wrong" }], [{ id: "original" }]]);
  await restoreDatabaseIdentity(db, event);
  expect(db.query.mock.calls).toHaveLength(3);
  expect(db.query.mock.calls[0]![1]).toEqual(["public.agency"]);
  expect(db.query.mock.calls[1]![0]).toContain("from public.agency where");
  expect(db.query.mock.calls[2]![0]).toContain("update public.agency set");
  const collision = client([[], [{ id: "wrong" }, { id: "original" }]]);
  await expect(restoreDatabaseIdentity(collision, event)).rejects.toThrow(
    "collision",
  );
  expect(collision.query.mock.calls).toHaveLength(2);
});
test("rejects noncascade incoming references before writes", async () => {
  const db = client([[{ conname: "incoming_fk" }]]);
  await expect(restoreDatabaseIdentity(db, event)).rejects.toThrow(
    "ON UPDATE CASCADE",
  );
  expect(db.query.mock.calls).toHaveLength(1);
});
test("rejects missing current row and a zero row update", async () => {
  await expect(
    restoreDatabaseIdentity(client([[], []]), event),
  ).rejects.toThrow("missing");
  await expect(
    restoreDatabaseIdentity(client([[], [{ id: "wrong" }], []]), event),
  ).rejects.toThrow("exactly one");
});
