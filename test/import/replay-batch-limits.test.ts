import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { DatabaseMutations } from "../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { executeDatabaseMutations } from "../../src/cli/replay/database-mutations/execute.js";

test.each([
  {
    name: "large geometry payloads",
    rows: 3,
    padding: 2 * 1024 * 1024,
    expected: 3,
  },
  { name: "many small rows", rows: 1001, padding: 0, expected: 2 },
  { name: "one oversized row", rows: 1, padding: 5 * 1024 * 1024, expected: 1 },
])(
  "bounds insert statements for $name without losing records",
  async ({ rows, padding, expected }) => {
    const root = await mkdtemp(path.join(tmpdir(), "bounded-replay-"));
    try {
      const boundary = JSON.stringify({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        source_note: "é".repeat(padding / 2),
      });
      const written = await DatabaseMutations.write(
        root,
        DatabaseMutations.new({
          metadata: { name: "bounded", namespace: "synthetic" },
          spec: {
            mutations: Array.from({ length: rows }, (_, i) => ({
              kind: "LocationPathGeometryCreate",
              name: `geometry-${i}`,
              spec: {
                location_path_id: `geometry-${i}`,
                geometry: boundary,
                sourceLocationPathKey: `geometry-${i}`,
              },
            })),
          },
        }),
      );
      const batches: unknown[][] = [];
      await executeDatabaseMutations(
        {
          connect: async () => {},
          end: async () => {},
          query: async (sql, params) => {
            expect(sql).toContain("insert into public.location_path_geometry");
            const values = [...(params ?? [])];
            batches.push(values);
            return {
              rows: values
                .filter((_, i) => i % 2 === 0)
                .map((id) => ({ location_path_id: id })),
            };
          },
        },
        written.path,
      );
      expect(batches).toHaveLength(expected);
      expect(batches.flat().filter((_, i) => i % 2 === 0)).toEqual(
        Array.from({ length: rows }, (_, i) => `geometry-${i}`),
      );
      for (const batch of batches) {
        expect(batch.length / 2).toBeLessThanOrEqual(1000);
        if (batch.length > 2)
          expect(
            batch.reduce<number>(
              (sum, value) => sum + Buffer.byteLength(String(value)),
              0,
            ),
          ).toBeLessThanOrEqual(4 * 1024 * 1024);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
