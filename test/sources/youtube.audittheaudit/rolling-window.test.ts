import { describe, it, expect } from "vitest";
import {
  isInWindow,
  rollingWindow,
  windowYears,
  yearSearchWindow,
} from "../../../sources/youtube.audittheaudit/rolling-window.js";

const window = {
  startsAt: "2021-10-24T12:00:00.000Z",
  endsAt: "2026-10-24T12:00:00.000Z",
};

describe("rollingWindow", () => {
  it("is the five years ending at the run", () => {
    expect(rollingWindow(new Date("2026-10-24T12:00:00.000Z"))).toEqual(window);
  });

  it("moves with the run, so the period is rolling", () => {
    expect(rollingWindow(new Date("2026-10-25T12:00:00.000Z"))).toEqual({
      startsAt: "2021-10-25T12:00:00.000Z",
      endsAt: "2026-10-25T12:00:00.000Z",
    });
  });
});

describe("windowYears", () => {
  it("lists every calendar year the window touches, newest first", () => {
    expect(windowYears(window)).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
  });
});

describe("yearSearchWindow", () => {
  it("bounds a fully-contained year to that year", () => {
    expect(yearSearchWindow(2024, window)).toEqual({
      publishedAfter: "2024-01-01T00:00:00.000Z",
      publishedBefore: "2025-01-01T00:00:00.000Z",
    });
  });

  it("clamps the oldest year to the start of the window", () => {
    expect(yearSearchWindow(2021, window)).toEqual({
      publishedAfter: window.startsAt,
      publishedBefore: "2022-01-01T00:00:00.000Z",
    });
  });

  it("clamps the open year to the run instant", () => {
    expect(yearSearchWindow(2026, window)).toEqual({
      publishedAfter: "2026-01-01T00:00:00.000Z",
      publishedBefore: window.endsAt,
    });
  });
});

describe("isInWindow", () => {
  it("includes an instant inside the window and both bounds", () => {
    expect(isInWindow("2024-03-05T12:00:00Z", window)).toBe(true);
    expect(isInWindow(window.startsAt, window)).toBe(true);
    expect(isInWindow(window.endsAt, window)).toBe(true);
  });

  it("excludes an instant on either side of the window", () => {
    expect(isInWindow("2021-10-24T11:59:59Z", window)).toBe(false);
    expect(isInWindow("2026-10-24T12:00:01Z", window)).toBe(false);
    expect(isInWindow("2016-01-01T00:00:00Z", window)).toBe(false);
  });

  it("excludes a publication time that is not an instant", () => {
    expect(isInWindow("", window)).toBe(false);
    expect(isInWindow("sometime in 2024", window)).toBe(false);
  });
});
