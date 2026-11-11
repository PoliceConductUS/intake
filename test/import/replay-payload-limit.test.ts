import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { DatabaseMutations } from "../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { executeDatabaseMutations } from "../../src/cli/replay/database-mutations/execute.js";

const batches = vi.hoisted(() => [] as Record<string, unknown>[][]);
vi.mock("../../src/cli/database/entities.js", () => ({
  createDatabaseRecords: async (
    _client: unknown,
    _table: string,
    rows: Record<string, unknown>[],
    key: string,
  ) => {
    batches.push(rows);
    return new Set(rows.map((row) => String(row[key])));
  },
}));

test("bounds create payloads without losing or reordering large records", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "replay-payload-"));
  try {
    batches.length = 0;
    const sizes = [600_000, 600_000, 1_100_000, 10];
    const file = await DatabaseMutations.write(
      root,
      DatabaseMutations.new({
        metadata: { name: "payload-limit", namespace: "test" },
        spec: {
          mutations: sizes.map((size, i) => ({
            kind: "LocationPathGeometryCreate",
            name: `geometry-${i}`,
            spec: {
              location_path_id: `path-${i}`,
              sourceLocationPathKey: `place:${i}`,
              geometry:
                " ".repeat(size) + '{"type":"Point","coordinates":[0,0]}',
            },
          })),
        },
      }),
    );
    await executeDatabaseMutations(
      {
        connect: async () => {},
        end: async () => {},
        query: async () => {
          throw new Error("unexpected query");
        },
      },
      file.path,
    );
    expect(batches.map((batch) => batch.length)).toEqual([1, 1, 1, 1]);
    expect(batches.flat().map((row) => row.location_path_id)).toEqual(
      sizes.map((_, i) => `path-${i}`),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
