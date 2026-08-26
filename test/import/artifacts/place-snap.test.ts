import { describe, it, expect } from "vitest";
import { LocationPathDataContext } from "../../../src/cli/import/artifacts/location-resolution.js";

// A fake DB client that answers the three query shapes getPlaceContainingPoint
// issues, driven by a per-level point-in-polygon map, a place-by-id map, and a
// place-by-(state,slug) map.
function fakeContext(options: {
  containing: Partial<Record<"place" | "administrative_area", unknown[]>>;
  byId?: Record<string, unknown>;
  byStateSlug?: unknown[];
  nearest?: unknown;
}) {
  const client = {
    query: async (text: string, values: readonly unknown[] = []) => {
      if (text.includes("<->")) {
        return { rows: options.nearest === undefined ? [] : [options.nearest] };
      }
      if (text.includes("ST_Covers")) {
        const level = values[2] as "place" | "administrative_area";
        return { rows: options.containing[level] ?? [] };
      }
      if (text.includes("place_slug = $2")) {
        return { rows: options.byStateSlug ?? [] };
      }
      if (text.includes("where location_path_id = $1")) {
        const row = options.byId?.[values[0] as string];
        return { rows: row === undefined ? [] : [row] };
      }
      return { rows: [] };
    },
  };
  return new LocationPathDataContext({
    databaseClient: () => client,
  } as never);
}

const county = {
  location_path_id: "bexar",
  path: "/tx/bexar-county/",
  level: "administrative_area",
};

describe("getPlaceContainingPoint place snap (ADR: agency location must be a place)", () => {
  it("returns the containing place when the point is inside a place polygon", async () => {
    const context = fakeContext({
      containing: {
        place: [
          { location_path_id: "sa", path: "/tx/bexar-county/san-antonio/" },
        ],
      },
    });
    await expect(
      context.getPlaceContainingPoint({
        latitude: 29.4,
        longitude: -98.5,
        subject: "Agency a",
        place: "San Antonio",
        stateSlug: "TX",
      }),
    ).resolves.toBe("sa");
  });

  it("snaps to the address city's place in the point's county when no place contains the point", async () => {
    const context = fakeContext({
      containing: { place: [], administrative_area: [county] },
      byId: { bexar: county },
      byStateSlug: [
        {
          location_path_id: "sa",
          path: "/tx/bexar-county/san-antonio/",
          level: "place",
        },
      ],
    });
    await expect(
      context.getPlaceContainingPoint({
        latitude: 29.4,
        longitude: -98.5,
        subject: "Agency a",
        place: "San Antonio",
        stateSlug: "TX",
      }),
    ).resolves.toBe("sa");
  });

  it("uses the lone statewide match when the point fell in the wrong county", async () => {
    const randall = {
      location_path_id: "randall",
      path: "/tx/randall-county/",
      level: "administrative_area",
    };
    const context = fakeContext({
      containing: { place: [], administrative_area: [randall] },
      byId: { randall },
      // Amarillo's place lives under potter-county, not the point's randall-county.
      byStateSlug: [
        {
          location_path_id: "amarillo",
          path: "/tx/potter-county/amarillo/",
          level: "place",
        },
      ],
    });
    await expect(
      context.getPlaceContainingPoint({
        latitude: 35,
        longitude: -101.9,
        subject: "Agency a",
        place: "Amarillo",
        stateSlug: "TX",
      }),
    ).resolves.toBe("amarillo");
  });

  it("falls back to the nearest place when the city names no place (typo/unincorporated)", async () => {
    // The address is the office building's location, so the nearest place is a
    // valid answer — no fail-loud.
    const context = fakeContext({
      containing: { place: [], administrative_area: [county] },
      byId: { bexar: county },
      byStateSlug: [],
      nearest: {
        location_path_id: "nearest-town",
        path: "/tx/austin-county/some-town/",
      },
    });
    await expect(
      context.getPlaceContainingPoint({
        latitude: 1,
        longitude: 1,
        subject: "Agency a",
        place: "Bleiblerville",
        stateSlug: "TX",
      }),
    ).resolves.toBe("nearest-town");
  });
});
