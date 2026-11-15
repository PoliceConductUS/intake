import { createHash } from "node:crypto";
import type { BookingEnrichment } from "./arrest.js";

export type GeographyEvidence = {
  addressTracts: Record<
    string,
    { status: string; quality?: string; geoid?: string }
  >;
  acsRows: (string | null)[][][];
  beatGeojson: {
    type: "FeatureCollection";
    features: {
      properties: { Code: string; BattalionC: string; IsActive: number };
      geometry: {
        type: "Polygon" | "MultiPolygon";
        coordinates: number[][][] | number[][][][];
      };
    }[];
  };
  arrestLocationRows: Record<string, string>[];
};

function clean(value: string | undefined): string {
  const result = (value ?? "").trim();
  return result.toUpperCase() === "NULL" ? "" : result;
}

export function parseAcsIncome(
  rows: GeographyEvidence["acsRows"],
): Record<string, NonNullable<BookingEnrichment["income"]>> {
  const result: Record<string, NonNullable<BookingEnrichment["income"]>> = {};
  for (const table of rows) {
    const header = table[0];
    const fields = [
      "B19013_001E",
      "B19013_001M",
      "B19013_001EA",
      "B19013_001MA",
      "state",
      "county",
      "tract",
    ];
    if (!header || fields.some((field) => !header.includes(field)))
      throw new Error("Invalid ACS table header");
    for (const values of table.slice(1)) {
      if (values.length !== header.length)
        throw new Error("Invalid ACS row width");
      const value = (field: string) => values[header.indexOf(field)] ?? null;
      const geoid = `${value("state")}${value("county")}${value("tract")}`;
      if (!/^\d{11}$/.test(geoid))
        throw new Error("Invalid ACS tract identity");
      const number = (field: string) => {
        const raw = value(field);
        if (raw === null) return null;
        if (!/^-?\d+$/.test(raw)) throw new Error("Invalid ACS income value");
        const n = Number(raw);
        return n >= 0 ? n : null;
      };
      const annotation = value("B19013_001EA");
      const topcoded = annotation === "250,000+";
      const income = {
        estimate: topcoded ? 250000 : number("B19013_001E"),
        marginOfError: number("B19013_001M"),
        annotation,
        marginOfErrorAnnotation: value("B19013_001MA"),
        topcoded,
      };
      if (
        result[geoid] &&
        JSON.stringify(result[geoid]) !== JSON.stringify(income)
      )
        throw new Error("Conflicting ACS tract income");
      result[geoid] = income;
    }
  }
  return result;
}

// Returns boundary separately so neither shared edges nor multiple polygons are guessed.
function ringMatch(
  x: number,
  y: number,
  ring: number[][],
): "inside" | "outside" | "boundary" {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]!;
    const [bx, by] = ring[i]!;
    if (
      ax === undefined ||
      ay === undefined ||
      bx === undefined ||
      by === undefined
    )
      throw new Error("Invalid beat polygon coordinate");
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (
      Math.abs(cross) <= 1e-12 &&
      x >= Math.min(ax, bx) &&
      x <= Math.max(ax, bx) &&
      y >= Math.min(ay, by) &&
      y <= Math.max(ay, by)
    )
      return "boundary";
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside ? "inside" : "outside";
}

function polygonMatch(
  x: number,
  y: number,
  rings: number[][][],
): "inside" | "outside" | "boundary" {
  if (!rings[0]) throw new Error("Empty beat polygon");
  const outer = ringMatch(x, y, rings[0]);
  if (outer !== "inside") return outer;
  for (const hole of rings.slice(1)) {
    const match = ringMatch(x, y, hole);
    if (match === "boundary") return match;
    if (match === "inside") return "outside";
  }
  return "inside";
}

export function enrichBookings(
  rows: Record<string, string>[],
  evidence: GeographyEvidence,
): Record<string, BookingEnrichment> {
  const incomeByTract = parseAcsIncome(evidence.acsRows);
  const locations = new Map<string, Record<string, string>[]>();
  for (const row of evidence.arrestLocationRows) {
    const key = row["arrest location"] ?? "";
    locations.set(key, [...(locations.get(key) ?? []), row]);
  }
  const bookings = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const booking = clean(row.Booking_No);
    if (!booking) throw new Error("Missing booking identity");
    bookings.set(booking, [...(bookings.get(booking) ?? []), row]);
  }
  const result: Record<string, BookingEnrichment> = {};
  for (const [booking, sourceRows] of bookings) {
    const item: BookingEnrichment = {
      beat: null,
      beatStatus: "missing_arrest_location",
      incomeTract: null,
      income: null,
      incomeStatus: "missing_residential_address",
    };
    const arrestLocations = new Set(
      sourceRows.map((row) => clean(row["arrest location"])),
    );
    if (arrestLocations.size > 1)
      item.beatStatus = "conflicting_arrest_locations";
    else if ([...arrestLocations][0]) {
      const raw = sourceRows[0]!["arrest location"]!;
      const audits = locations.get(raw) ?? [];
      if (!audits.length) item.beatStatus = "missing_geocode_evidence";
      else if (audits.length !== 1)
        item.beatStatus = "conflicting_geocode_evidence";
      else {
        const audit = audits[0]!;
        const x = Number(audit.Longitude),
          y = Number(audit.Latitude);
        if (!["HIGH", "MEDIUM"].includes(audit.Geocode_Quality ?? ""))
          item.beatStatus = "unreliable_geocode";
        else if (
          !clean(audit.Geocode_Method) ||
          !clean(audit.Longitude) ||
          !clean(audit.Latitude) ||
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          Math.abs(x) > 180 ||
          Math.abs(y) > 90
        )
          throw new Error("Invalid reliable arrest geocode evidence");
        else {
          const patrol: GeographyEvidence["beatGeojson"]["features"] = [];
          const coverage: GeographyEvidence["beatGeojson"]["features"] = [];
          let patrolBoundary = false;
          let coverageBoundary = false;
          // The official layer defines overlapping classes: PD1/PD2 patrol
          // beats and outside-city/OTHER coverage. OTHER encloses Irving;
          // its overlap never makes a unique patrol beat ambiguous.
          for (const feature of evidence.beatGeojson.features) {
            const isPatrol =
              feature.properties.BattalionC === "PD1" ||
              feature.properties.BattalionC === "PD2";
            const polygons =
              feature.geometry.type === "Polygon"
                ? [feature.geometry.coordinates as number[][][]]
                : (feature.geometry.coordinates as number[][][][]);
            const matches = polygons.map((polygon) =>
              polygonMatch(x, y, polygon),
            );
            if (matches.includes("boundary")) {
              if (isPatrol) patrolBoundary = true;
              else coverageBoundary = true;
            }
            if (matches.includes("inside"))
              (isPatrol ? patrol : coverage).push(feature);
          }
          const matched = patrol.length || patrolBoundary ? patrol : coverage;
          const boundary =
            patrol.length || patrolBoundary ? patrolBoundary : coverageBoundary;
          if (boundary || matched.length > 1)
            item.beatStatus = "ambiguous_polygon_match";
          else if (!matched.length)
            item.beatStatus = "outside_polygon_coverage";
          else {
            const fields = matched[0]!.properties;
            if (fields.IsActive !== 1) item.beatStatus = "inactive_polygon";
            else if (
              fields.BattalionC === "PD1" ||
              fields.BattalionC === "PD2"
            ) {
              item.beat = fields.Code;
              item.beatStatus = "matched";
            } else
              item.beatStatus =
                fields.BattalionC === "OTHER"
                  ? "other_polygon"
                  : "outside_irving";
          }
        }
      }
    }
    const addresses = new Set(
      sourceRows.map((row) => clean(row.Booking_Address)),
    );
    if (addresses.size > 1)
      item.incomeStatus = "conflicting_residential_addresses";
    else {
      const address = [...addresses][0];
      if (address) {
        const id = createHash("sha256")
          .update(address)
          .digest("hex")
          .slice(0, 24);
        const match = evidence.addressTracts[id];
        if (!match) item.incomeStatus = "missing_residential_geocode_evidence";
        else if (match.status === "pending")
          throw new Error("Residential geocode is pending");
        else if (match.status !== "matched") item.incomeStatus = match.status;
        else {
          if (!match.geoid || !/^\d{11}$/.test(match.geoid) || !match.quality)
            throw new Error("Invalid matched residential tract evidence");
          item.incomeTract = match.geoid;
          item.income = incomeByTract[match.geoid] ?? null;
          item.incomeStatus =
            item.income === null
              ? "missing_acs_tract"
              : item.income.estimate === null
                ? "unavailable_acs_income"
                : "matched";
        }
      }
    }
    result[booking] = item;
  }
  return result;
}
