import { describe, it, expect } from "vitest";
import {
  buildBreakdowns,
  coverageOf,
  deriveArrest,
  type ArrestRow,
  type Charge,
  type NormalizedArrest,
} from "../../../sources/gov.irvingtx.arrests/arrest.js";

const charges: Record<string, Charge> = {
  "2000002": { offense: "PUBLIC INTOXICATION", level: "MC" },
  "2000004": { offense: "DRIVING WHILE INTOXICATED", level: "MB" },
};
const chargeByBooking = (booking: string): Charge | undefined =>
  charges[booking];

function row(overrides: ArrestRow): ArrestRow {
  return {
    Arrest_Officer_Name: "JONES,MATTHEW",
    Arrest_Date: "2020-01-01T00:00:00.000Z",
    Arrest_Time: "00:17:00",
    District: "3",
    Booking_No: "2000002",
    // PII columns that must never appear in the derived record:
    Booking_Name: "BERRIOS,BENJAMIN",
    Booking_Address: "2606 FUQUA RD, ROWLETT",
    ...overrides,
  };
}

describe("deriveArrest", () => {
  it("derives dimensions, reorders the officer name, and drops arrestee PII", () => {
    const arrest = deriveArrest(row({}), chargeByBooking);
    expect(arrest).toEqual<NormalizedArrest>({
      officerNames: ["MATTHEW JONES"],
      year: "2020",
      month: "2020-01",
      isoWeek: "2020-W01",
      dayOfWeek: "Wed",
      hour: "00",
      district: "3",
      offense: "PUBLIC INTOXICATION",
      chargeLevel: "MC",
    });
    const asJson = JSON.stringify(arrest);
    expect(asJson).not.toContain("BERRIOS");
    expect(asJson).not.toContain("FUQUA");
  });

  it("treats NULL / blank fields as no-officer or unknown", () => {
    expect(
      deriveArrest(row({ Arrest_Officer_Name: "NULL" }), chargeByBooking)
        .officerNames,
    ).toEqual([]);
    expect(
      deriveArrest(row({ District: "NULL" }), chargeByBooking).district,
    ).toBe("unknown");
    expect(
      deriveArrest(row({ Booking_No: "9999" }), chargeByBooking).offense,
    ).toBe("unknown");
    expect(
      deriveArrest(row({ Arrest_Date: "bad" }), chargeByBooking).year,
    ).toBe("unknown");
  });
});

describe("buildBreakdowns", () => {
  const arrests: NormalizedArrest[] = [
    deriveArrest(
      row({ Arrest_Date: "2020-01-01T00:00:00Z", Booking_No: "2000002" }),
      chargeByBooking,
    ),
    deriveArrest(
      row({ Arrest_Date: "2021-06-01T00:00:00Z", Booking_No: "2000004" }),
      chargeByBooking,
    ),
    deriveArrest(
      row({ Arrest_Date: "2021-06-02T00:00:00Z", Booking_No: "2000002" }),
      chargeByBooking,
    ),
  ];

  it("counts each dimension by bucket", () => {
    const breakdowns = buildBreakdowns(arrests);
    expect(breakdowns.by_year).toEqual({ "2020": 1, "2021": 2 });
    expect(breakdowns.by_offense).toEqual({
      "PUBLIC INTOXICATION": 2,
      "DRIVING WHILE INTOXICATED": 1,
    });
    expect(breakdowns.by_charge_level).toEqual({ MC: 2, MB: 1 });
  });

  it("omits a dimension whose values are entirely unknown", () => {
    const noDistrict = arrests.map((a) => ({ ...a, district: "unknown" }));
    expect(buildBreakdowns(noDistrict)).not.toHaveProperty("by_district");
  });
});

describe("coverageOf", () => {
  it("reports totals and the month range", () => {
    expect(
      coverageOf([
        deriveArrest(
          row({ Arrest_Date: "2021-06-15T00:00:00Z" }),
          chargeByBooking,
        ),
        deriveArrest(
          row({ Arrest_Date: "2020-01-01T00:00:00Z" }),
          chargeByBooking,
        ),
      ]),
    ).toEqual({ totalArrests: 2, firstMonth: "2020-01", lastMonth: "2021-06" });
  });
});
