import { expect, test, vi } from "vitest";
import { CurrentRowReader } from "../../../src/cli/import/artifacts/current-row-reader.js";

test("shared coalescing preserves multi-table reads, missing rows, and memoization", async () => {
  const personnel = { id: "same-id", first_name: "Ada" };
  const agency = { id: "same-id", name: "Police Department" };
  const query = vi.fn(async () => ({
    rows: [
      { __batch: 1, __row: agency },
      { __batch: 0, __row: personnel },
    ],
  }));
  const reader = new CurrentRowReader({
    connect: async () => {},
    end: async () => {},
    query,
  });
  const person = reader.getById("Personnel", "same-id");
  const department = reader.getById("Agency", "same-id");
  const missing = reader.getById("Personnel", "missing");
  expect(reader.getById("Personnel", "same-id")).toBe(person);
  await expect(Promise.all([person, department, missing])).resolves.toEqual([
    personnel,
    agency,
    undefined,
  ]);
  expect(query).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining(" union all "),
    [["same-id", "missing"], ["same-id"]],
  );
  await expect(reader.getById("Agency", "same-id")).resolves.toEqual(agency);
  await expect(reader.getById("Personnel", "missing")).resolves.toBeUndefined();
  expect(query).toHaveBeenCalledTimes(1);
});
