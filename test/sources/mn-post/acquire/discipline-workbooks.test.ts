import { describe, it, expect } from "vitest";
import {
  parseDisciplineRows,
  parseHistoryRows,
} from "../../../../sources/mn-post/acquire/discipline-workbooks.js";

describe("discipline workbook rows", () => {
  it("preserves numeric license identity and row provenance, excluding total", () => {
    expect(
      parseDisciplineRows([
        {
          sourceRow: 2,
          values: ["A Person", 123, "Revoked", "1/1/2020", true],
        },
        { sourceRow: 3, values: ["Total", null, null, null, 1] },
      ]),
    ).toEqual([
      { licenseNumber: "123", name: "A Person", sourceRow: 2, history: [] },
    ]);
  });
  it("rejects repeated license rows", () =>
    expect(() =>
      parseDisciplineRows([
        { sourceRow: 2, values: ["A", 123, "Revoked", "1/1/2000", true] },
        { sourceRow: 3, values: ["B", 123, "Revoked", "1/1/2000", true] },
      ]),
    ).toThrow(/duplicate/i));
  it("carries grouped history licenses and resets at subtotals", () => {
    const rows = [
      {
        sourceRow: 2,
        values: [
          null,
          "123",
          null,
          "Person",
          "A",
          "First",
          "Terminated",
          "1/2/2000",
          "Former",
          "3/4/2001",
        ],
      },
      {
        sourceRow: 3,
        values: [
          null,
          null,
          null,
          "Person",
          "A",
          "Second",
          "Terminated",
          "5/6/2002",
          "Former",
          "7/8/2003",
        ],
      },
      { sourceRow: 4, values: [null, "Subtotal"] },
      {
        sourceRow: 5,
        values: [
          null,
          "999",
          null,
          "Other",
          "B",
          "Other",
          "Terminated",
          "1/1/2000",
          "Former",
          "1/1/2001",
        ],
      },
    ];
    expect(parseHistoryRows(rows, new Set(["123"]))).toEqual(
      new Map([
        [
          "123",
          [
            {
              sourceRow: 2,
              agencyName: "First",
              startDate: "2000-01-02",
              endDate: "2001-03-04",
            },
            {
              sourceRow: 3,
              agencyName: "Second",
              startDate: "2002-05-06",
              endDate: "2003-07-08",
            },
          ],
        ],
      ]),
    );
    expect(() =>
      parseHistoryRows([...rows.slice(0, 3), rows[1]], new Set(["123"])),
    ).toThrow(/license/i);
  });
  it("rejects missing history dates", () =>
    expect(() =>
      parseHistoryRows(
        [
          {
            sourceRow: 2,
            values: [
              null,
              "123",
              null,
              "Person",
              "A",
              "First",
              "Terminated",
              null,
              "Former",
              "3/4/2001",
            ],
          },
        ],
        new Set(["123"]),
      ),
    ).toThrow(/date/i));
});

it("reads all 571 supplied discipline licenses and their 153 former employment rows", async () => {
  const { readDisciplineWorkbooks } =
    await import("../../../../sources/mn-post/acquire/discipline-workbooks.js");
  const people = await readDisciplineWorkbooks(
    new URL("../../../../sources/mn-post/", import.meta.url).pathname,
  );
  expect(people).toHaveLength(571);
  expect(new Set(people.map((person) => person.licenseNumber)).size).toBe(571);
  expect(
    people.reduce((count, person) => count + person.history.length, 0),
  ).toBe(153);
});

it("rejects discipline rows without an affirmative source flag", () => {
  for (const flag of [undefined, false, "true"])
    expect(() =>
      parseDisciplineRows([
        { sourceRow: 2, values: ["A", 123, "Revoked", "1/1/2000", flag] },
      ]),
    ).toThrow(/disciplin/i);
});

it("rejects changed workbook column headers before reading source rows", async () => {
  const { validateWorkbookHeader } =
    await import("../../../../sources/mn-post/acquire/discipline-workbooks.js");
  expect(() =>
    validateWorkbookHeader(["Licensee Full Name", "WRONG COLUMN"], {
      0: "Licensee Full Name",
      1: "License - POST: Number",
    }),
  ).toThrow(/header/);
});
