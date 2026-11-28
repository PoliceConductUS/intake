import { expect, test } from "vitest";
import { createDatabaseRecords } from "../../../src/cli/database/entities.js";
import type { DatabaseClient } from "../../../src/cli/database/index.js";

function recordingClient(rows: Record<string, unknown>[]) {
  const queries: { text: string; values: unknown[] }[] = [];
  const client: DatabaseClient = {
    connect: async () => {},
    end: async () => {},
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values: values ?? [] });
      return { rows };
    },
  };
  return { client, queries };
}

test("inserts with a plain insert so the database rejects a duplicate key", async () => {
  const { client, queries } = recordingClient([{ id: "a" }, { id: "b" }]);

  const inserted = await createDatabaseRecords(
    client,
    "public.agency",
    [
      { id: "a", name: "A", slug: undefined },
      { id: "b", name: "B" },
    ],
    "id",
  );

  expect(queries).toEqual([
    {
      text: "insert into public.agency (id, name) values ($1, $2), ($3, $4) returning id",
      values: ["a", "A", "b", "B"],
    },
  ]);
  expect(inserted).toEqual(new Set(["a", "b"]));
});

test.each([
  ["an extra column", { id: "b", name: "B", slug: "b" }, "extra slug"],
  ["a missing column", { id: "b" }, "missing name"],
])(
  "fails without a query when a record has %s",
  async (_label, second, difference) => {
    const { client, queries } = recordingClient([]);

    await expect(
      createDatabaseRecords(
        client,
        "public.agency",
        [{ id: "a", name: "A" }, second],
        "id",
      ),
    ).rejects.toThrow(
      `Cannot insert into public.agency: record 1 (id b) does not have the columns of record 0 (${difference}).`,
    );
    expect(queries).toEqual([]);
  },
);
