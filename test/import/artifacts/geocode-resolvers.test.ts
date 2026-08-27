import { describe, it, expect } from "vitest";
import { latLngFromAddress } from "../../../src/cli/import/artifacts/facades/geocode-resolvers.js";

const AGENCY_CONFIG = {
  entityType: "agency",
  from: {
    state: "state",
    place: "city",
    zipCode: "zip_code",
    address: "address",
    name: "name",
    location: "location",
  },
  set: {
    latitude: "latitude",
    longitude: "longitude",
    locationPathId: "location_path_id",
  },
} as const;

// A fake facade + counting geocode backend. `existing` seeds the existing-row
// stability path; `raw` seeds source values. The geocode returns fixed values and
// counts calls, so the test can prove it runs at most once for all three outputs.
function fakeContext(
  raw: Record<string, unknown>,
  existing?: Record<string, unknown>,
) {
  let geocodeCalls = 0;
  const context = {
    facade: {
      value: async (property: string) => (property === "id" ? "a1" : undefined),
      raw: (property: string) => raw[property],
    },
    source: { namespace: "n", name: "r" },
    backend: {
      resolveAgencyLocation: async () => {
        geocodeCalls += 1;
        return {
          locationPathId: "lp-1",
          addressLatitude: 30.5,
          addressLongitude: -97.7,
        };
      },
      existingRow: async () => existing,
    },
  } as never;
  return { context, geocodeCalls: () => geocodeCalls };
}

describe("latLngFromAddress", () => {
  it("sets all three outputs from a single geocode", async () => {
    const resolvers = latLngFromAddress(AGENCY_CONFIG);
    const { context, geocodeCalls } = fakeContext({
      city: "Austin",
      state: "TX",
      address: "1 Main St",
      zip_code: "78701",
      name: "Austin PD",
    });

    const lat = await resolvers.latitude.resolve(context, () => "l");
    const lng = await resolvers.longitude.resolve(context, () => "l");
    const path = await resolvers.location_path_id.resolve(context, () => "l");

    expect(lat).toBe(30.5);
    expect(lng).toBe(-97.7);
    expect(path).toBe("lp-1");
    // The whole point: three outputs, one geocode — a shared resolution memoized
    // on the facade, so the second and third reads never re-run it.
    expect(geocodeCalls()).toBe(1);
  });

  it("prefers source values and never geocodes when they are present", async () => {
    const resolvers = latLngFromAddress(AGENCY_CONFIG);
    const { context, geocodeCalls } = fakeContext({
      latitude: 10,
      longitude: 20,
      location_path_id: "lp-source",
    });

    expect(await resolvers.latitude.resolve(context, () => "l")).toBe(10);
    expect(await resolvers.longitude.resolve(context, () => "l")).toBe(20);
    expect(await resolvers.location_path_id.resolve(context, () => "l")).toBe(
      "lp-source",
    );
    expect(geocodeCalls()).toBe(0);
  });

  it("keeps an existing row's location rather than re-geocoding it", async () => {
    const resolvers = latLngFromAddress(AGENCY_CONFIG);
    const { context, geocodeCalls } = fakeContext(
      { city: "Austin", state: "TX" },
      { latitude: 1.5, longitude: 2.5, location_path_id: "lp-existing" },
    );

    expect(await resolvers.latitude.resolve(context, () => "l")).toBe(1.5);
    expect(await resolvers.location_path_id.resolve(context, () => "l")).toBe(
      "lp-existing",
    );
    expect(geocodeCalls()).toBe(0);
  });
});
