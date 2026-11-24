import { expect, it } from "vitest";
import { accountingTotals } from "../../../src/cli/transform/accounting.js";

it("gives the four numbers when every row is accounted for", () => {
  expect(
    accountingTotals("test/source", [
      {
        input: "Officers",
        read: 100,
        emitted: 90,
        reported: 4,
        notSelected: { "no known officer": 5, "before minimum year": 1 },
      },
    ]),
  ).toBe(
    "test/source: row accounting: Officers: read 100, emitted 90, reported 4, not selected 6 (no known officer=5, before minimum year=1)",
  );
});

it("fails naming the input and the difference when a row has no outcome", () => {
  expect(() =>
    accountingTotals("test/source", [
      {
        input: "Officers",
        read: 100,
        emitted: 99,
        reported: 0,
        notSelected: {},
      },
    ]),
  ).toThrow(
    "Source test/source row accounting for Officers: read 100, accounted for 99, difference 1.",
  );
});

it("counts a row that feeds several records once", () => {
  expect(
    accountingTotals("test/source", [
      { input: "Officers", read: 2, emitted: 2, reported: 0, notSelected: {} },
    ]),
  ).toBe(
    "test/source: row accounting: Officers: read 2, emitted 2, reported 0, not selected 0",
  );
  expect(() =>
    accountingTotals("test/source", [
      { input: "Officers", read: 2, emitted: 6, reported: 0, notSelected: {} },
    ]),
  ).toThrow("difference -4");
});

it("fails when a source states no accounting or a value that is not a count", () => {
  expect(() => accountingTotals("test/source", undefined)).toThrow(
    "Source test/source did not state its row accounting.",
  );
  expect(() =>
    accountingTotals("test/source", [
      {
        input: "Officers",
        read: 1.5,
        emitted: 1,
        reported: 0,
        notSelected: {},
      },
    ]),
  ).toThrow("read is not a count: 1.5");
});

it("states no rows for a source with no input of its own", () => {
  expect(accountingTotals("org/policeconduct/manual", [])).toBe(
    "org/policeconduct/manual: row accounting: no rows",
  );
});
