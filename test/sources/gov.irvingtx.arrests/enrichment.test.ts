import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  enrichBookings,
  parseAcsIncome,
  type GeographyEvidence,
} from "../../../sources/gov.irvingtx.arrests/enrichment.js";
const header = [
  "NAME",
  "B19013_001E",
  "B19013_001M",
  "B19013_001EA",
  "B19013_001MA",
  "state",
  "county",
  "tract",
];
function evidence(): GeographyEvidence {
  return {
    addressTracts: {
      [createHash("sha256")
        .update("10 HOME ST, TEST, TX")
        .digest("hex")
        .slice(0, 24)]: {
        status: "matched",
        quality: "Exact",
        geoid: "48113000100",
      },
    },
    acsRows: [
      [header, ["Tract", "54321", "1234", null, null, "48", "113", "000100"]],
    ],
    beatGeojson: {
      type: "FeatureCollection",
      features: [
        {
          properties: { Code: "54", BattalionC: "PD2", IsActive: 1 },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [2, 0],
                [2, 2],
                [0, 2],
                [0, 0],
              ],
            ],
          },
        },
      ],
    },
    arrestLocationRows: [
      {
        "arrest location": "ARREST SITE",
        Latitude: "1",
        Longitude: "1",
        Geocode_Method: "official exact address",
        Geocode_Quality: "HIGH",
      },
    ],
  };
}
const row = {
  Booking_No: "one",
  Booking_Address: "10 HOME ST, TEST, TX",
  "arrest location": "ARREST SITE",
  District: "unrelated",
};
describe("private source geographic enrichment", () => {
  it("classifies patrol polygons independently of the enclosing OTHER coverage class", () => {
    const e = evidence();
    e.beatGeojson.features.push({
      properties: { Code: "9999", BattalionC: "OTHER", IsActive: 1 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-1, -1],
            [3, -1],
            [3, 3],
            [-1, 3],
            [-1, -1],
          ],
        ],
      },
    });
    expect(enrichBookings([row], e).one).toMatchObject({
      beat: "54",
      beatStatus: "matched",
    });
  });
  it("does not assign a beat inside a polygon hole and supports MultiPolygon parts", () => {
    const e = evidence();
    e.beatGeojson.features[0]!.geometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
        [
          [0.5, 0.5],
          [1.5, 0.5],
          [1.5, 1.5],
          [0.5, 1.5],
          [0.5, 0.5],
        ],
      ],
    };
    expect(enrichBookings([row], e).one?.beatStatus).toBe(
      "outside_polygon_coverage",
    );
    e.beatGeojson.features[0]!.geometry = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [3, 3],
            [4, 3],
            [4, 4],
            [3, 4],
            [3, 3],
          ],
        ],
        [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
      ],
    };
    expect(enrichBookings([row], e).one?.beat).toBe("54");
  });
  it("rejects malformed reliable coordinates and missing provenance", () => {
    const e = evidence();
    e.arrestLocationRows[0]!.Latitude = "";
    expect(() => enrichBookings([row], e)).toThrow(/Invalid reliable/);
    e.arrestLocationRows[0]!.Latitude = "1";
    e.arrestLocationRows[0]!.Geocode_Method = "";
    expect(() => enrichBookings([row], e)).toThrow(/Invalid reliable/);
  });

  it("joins exact arrest evidence for beat and residential evidence for exact income", () => {
    expect(enrichBookings([row, row], evidence())).toEqual({
      one: {
        beat: "54",
        beatStatus: "matched",
        incomeTract: "48113000100",
        income: {
          estimate: 54321,
          marginOfError: 1234,
          annotation: null,
          marginOfErrorAnnotation: null,
          topcoded: false,
        },
        incomeStatus: "matched",
      },
    });
  });
  it("retains conflicting observed residences and arrest sites without choosing row order", () => {
    const rows = [
      row,
      {
        ...row,
        Booking_Address: "OTHER HOME",
        "arrest location": "OTHER ARREST",
      },
    ];
    expect(enrichBookings(rows, evidence()).one).toMatchObject({
      beat: null,
      beatStatus: "conflicting_arrest_locations",
      income: null,
      incomeTract: null,
      incomeStatus: "conflicting_residential_addresses",
    });
    expect(enrichBookings([...rows].reverse(), evidence())).toEqual(
      enrichBookings(rows, evidence()),
    );
  });
  it.each(["LOW", "UNMATCHED", "UNUSABLE"])(
    "does not turn %s coordinate evidence into beat",
    (quality) => {
      const e = evidence();
      e.arrestLocationRows[0]!.Geocode_Quality = quality;
      expect(enrichBookings([row], e).one).toMatchObject({
        beat: null,
        beatStatus: "unreliable_geocode",
      });
    },
  );
  it("never treats District or a home address as an arrest beat", () => {
    expect(
      enrichBookings([{ ...row, "arrest location": "" }], evidence()).one,
    ).toMatchObject({
      beat: null,
      beatStatus: "missing_arrest_location",
      incomeStatus: "matched",
    });
  });
  it("keeps boundary and overlapping polygon matches ambiguous", () => {
    const e = evidence();
    e.arrestLocationRows[0]!.Longitude = "0";
    expect(enrichBookings([row], e).one).toMatchObject({
      beat: null,
      beatStatus: "ambiguous_polygon_match",
    });
    e.arrestLocationRows[0]!.Longitude = "1";
    e.beatGeojson.features.push({
      ...e.beatGeojson.features[0]!,
      properties: { Code: "53", BattalionC: "PD2", IsActive: 1 },
    });
    expect(enrichBookings([row], e).one?.beatStatus).toBe(
      "ambiguous_polygon_match",
    );
  });
  it("distinguishes official outside-city and OTHER shapes from patrol beats", () => {
    const e = evidence();
    e.beatGeojson.features[0]!.properties = {
      Code: "9901",
      BattalionC: "FB",
      IsActive: 1,
    };
    expect(enrichBookings([row], e).one).toMatchObject({
      beat: null,
      beatStatus: "outside_irving",
    });
    e.beatGeojson.features[0]!.properties = {
      Code: "9999",
      BattalionC: "OTHER",
      IsActive: 1,
    };
    expect(enrichBookings([row], e).one?.beatStatus).toBe("other_polygon");
  });
  it("preserves missing and rejected home evidence as statuses", () => {
    const e = evidence();
    Object.values(e.addressTracts)[0]!.status = "geocoder_state_mismatch";
    expect(enrichBookings([row], e).one?.incomeStatus).toBe(
      "geocoder_state_mismatch",
    );
    expect(
      enrichBookings([{ ...row, Booking_Address: "NULL" }], e).one
        ?.incomeStatus,
    ).toBe("missing_residential_address");
  });
  it("retains raw ACS annotations, negative sentinels and topcoded lower bounds", () => {
    const d = parseAcsIncome([
      [
        header,
        [
          "Tract",
          "250001",
          "-555555555",
          "250,000+",
          "*****",
          "48",
          "113",
          "000100",
        ],
        [
          "Unavailable",
          "-666666666",
          "-222222222",
          null,
          "**",
          "48",
          "113",
          "000200",
        ],
      ],
    ]);
    expect(d).toEqual({
      "48113000100": {
        estimate: 250000,
        marginOfError: null,
        annotation: "250,000+",
        marginOfErrorAnnotation: "*****",
        topcoded: true,
      },
      "48113000200": {
        estimate: null,
        marginOfError: null,
        annotation: null,
        marginOfErrorAnnotation: "**",
        topcoded: false,
      },
    });
  });
  it("rejects conflicting ACS rows and invalid geocoder evidence rather than guessing", () => {
    const e = evidence();
    e.acsRows.push([
      header,
      ["Tract", "1", "1", null, null, "48", "113", "000100"],
    ]);
    expect(() => enrichBookings([row], e)).toThrow(/Conflicting ACS/);
    const pending = evidence();
    Object.values(pending.addressTracts)[0]!.status = "pending";
    expect(() => enrichBookings([row], pending)).toThrow(/pending/);
  });
});
