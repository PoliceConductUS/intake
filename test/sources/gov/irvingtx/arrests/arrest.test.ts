import { describe, it, expect } from "vitest";
import {
  clean,
  normalizeWorkbook,
  buildProfile,
  parseNormalizedArrest,
} from "../../../../../sources/gov/irvingtx/arrests/arrest.js";
import { enrichBookings } from "../../../../../sources/gov/irvingtx/arrests/enrichment.js";
const row = {
  Booking_No: "1",
  Arrest_Officer_Name: "JONES,MATTHEW",
  Arrest_Date: "2020-01-01",
  Arrest_Time: "00:17:00",
  District: "3",
};
const charge = {
  Booking_No: "1",
  Charge: "A",
  Charge_Literal: "THEFT",
  Level: "MC",
};
const enrichment = {
  "1": {
    beat: "12",
    beatStatus: "matched",
    incomeTract: "123",
    income: {
      estimate: 50000,
      marginOfError: 1000,
      annotation: null,
      marginOfErrorAnnotation: null,
      topcoded: false,
    },
    incomeStatus: "matched",
  },
};
describe("complete booking normalization and aggregation", () => {
  it("counts repeated booking rows once and preserves all charge rows and distinct tuples", () => {
    const { arrests, audit } = normalizeWorkbook(
      [row, row],
      [
        charge,
        charge,
        { ...charge, Charge_Literal: "OTHER", Level: "MB" },
        { ...charge, Booking_No: "orphan" },
      ],
      [],
      enrichment,
    );
    expect(arrests).toHaveLength(1);
    expect(arrests[0]?.charges).toHaveLength(3);
    expect(audit).toMatchObject({ sourceArrestRows: 2, orphanChargeRows: 1 });
    const profile = buildProfile(arrests);
    expect(profile.coverage).toMatchObject({
      totalArrests: 1,
      sourceArrestRows: 2,
      chargeRows: 3,
      distinctChargeRecords: 2,
    });
    expect(profile.breakdowns.charge_rows_by_offense).toEqual({
      THEFT: 2,
      OTHER: 1,
    });
    expect(profile.breakdowns.distinct_charge_records_by_offense).toEqual({
      THEFT: 1,
      OTHER: 1,
    });
    expect(profile.breakdowns.arrests_by_offense).toEqual({
      THEFT: 1,
      OTHER: 1,
    });
    expect(profile.breakdowns.cells).toMatchObject([
      {
        month: "2020-01",
        beat: "12",
        incomeTract: "123",
        arrests: 1,
        chargeRows: 3,
        distinctChargeRecords: 2,
      },
    ]);
    expect(JSON.stringify(profile)).not.toContain("bookingNo");
    expect(JSON.stringify(profile)).not.toContain("MATTHEW");
  });
  it("retains missing joins and offense multiplicity without invented charges", () => {
    const result = normalizeWorkbook(
      [row, { ...row, Booking_No: "2" }],
      [],
      [{ Booking_No: "1", Offense: "X", Description: "THEFT", Offenses: "1" }],
      { ...enrichment, "2": enrichment["1"] },
    );
    expect(result.arrests[1]?.charges).toEqual([]);
    expect(buildProfile(result.arrests).coverage).toMatchObject({
      totalArrests: 2,
      arrestsWithLinkedCharges: 0,
      offenseRows: 1,
      arrestsWithLinkedOffenses: 1,
    });
  });
  it("rejects incomplete charge and offense source contracts", () => {
    expect(() =>
      normalizeWorkbook(
        [row],
        [{ Booking_No: "1", Charge: "A" }],
        [],
        enrichment,
      ),
    ).toThrow();
    expect(() =>
      normalizeWorkbook(
        [row],
        [],
        [{ Booking_No: "1", Offense: "X" }],
        enrichment,
      ),
    ).toThrow();
  });
  it("requires explicit enrichment for every booking", () => {
    expect(() => normalizeWorkbook([row], [], [], {})).toThrow(/enrichment/);
  });
  it("rejects conflicting booking dimensions and the old first-charge shape", () => {
    expect(() =>
      normalizeWorkbook([row, { ...row, District: "4" }], [], [], enrichment),
    ).toThrow(/conflicting/);
    expect(() =>
      parseNormalizedArrest({
        officerNames: [],
        offense: "THEFT",
        chargeLevel: "MC",
      }),
    ).toThrow();
  });
  it("treats only the exact text NULL as blank, after trimming", () => {
    expect(clean(" NULL ")).toBe("");
    expect(clean(undefined)).toBe("");
    expect(clean(" 12 MAIN ST ")).toBe("12 MAIN ST");
    expect(clean("null")).toBe("null");
    expect(clean("Null")).toBe("Null");
  });
  it("keys a padded Booking_No the same way in enrichment and normalization", () => {
    const padded = { ...row, Booking_No: " 1 " };
    const { arrests } = normalizeWorkbook(
      [padded],
      [{ ...charge, Booking_No: "1 " }],
      [],
      enrichBookings(
        [{ ...padded, Booking_Address: "NULL", "arrest location": "NULL" }],
        {
          addressTracts: {},
          acsRows: [],
          arrestLocationRows: [],
          beatGeojson: { type: "FeatureCollection", features: [] },
        },
      ),
    );
    expect(arrests.map((arrest) => arrest.bookingNo)).toEqual(["1"]);
    expect(arrests[0]!.charges).toHaveLength(1);
  });
  it("throws for a charge row whose Booking_No is NULL", () => {
    expect(() =>
      normalizeWorkbook(
        [row],
        [{ ...charge, Booking_No: "NULL" }],
        [],
        enrichment,
      ),
    ).toThrow("gov/irvingtx/arrests: Charges row 2 has no Booking_No");
  });
});
