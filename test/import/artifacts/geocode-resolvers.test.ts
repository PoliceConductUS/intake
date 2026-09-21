import { describe, it, expect } from "vitest";
import { latLngFromAddress } from "../../../src/cli/import/artifacts/facades/geocode-resolvers.js";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";
import { typedInputFingerprint } from "../../../src/cli/state/resolved-property/index.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import { fakeSourceNameLedger } from "../../cli/state/fake-source-name-ledger.js";
import { EmptyDatabaseClient } from "../../cli/database/empty-database-client.js";

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

  it("does not reuse an existing row's unverified coordinates or inferred place on a cache miss", async () => {
    const resolvers = latLngFromAddress(AGENCY_CONFIG);
    const { context, geocodeCalls } = fakeContext(
      { city: "Austin", state: "TX" },
      { latitude: 1.5, longitude: 2.5, location_path_id: "lp-existing" },
    );

    expect(await resolvers.latitude.resolve(context, () => "l")).toBe(30.5);
    expect(await resolvers.location_path_id.resolve(context, () => "l")).toBe(
      "lp-1",
    );
    expect(geocodeCalls()).toBe(1);
  });
});

it("invalidates coordinate caches produced by the former centroid fallback policy", async () => {
  const resolvers = latLngFromAddress(AGENCY_CONFIG);
  const { context } = fakeContext({
    address: "1 Bobcat Lane",
    city: "Medina",
    state: "TX",
    zip_code: "78055",
  });
  expect(await resolvers.latitude.cacheInput(context)).toMatchObject({
    policy: "address-point-v1",
  });
  expect(await resolvers.longitude.cacheInput(context)).toMatchObject({
    policy: "address-point-v1",
  });
});

it("keys derived locations by the corrected policy and postal ZIP", async () => {
  const resolver = latLngFromAddress(AGENCY_CONFIG).location_path_id;
  const a = fakeContext({ city: "Saint Paul", state: "MN", zip_code: "55111" });
  const b = fakeContext({ city: "Saint Paul", state: "MN", zip_code: "55101" });
  const input = await resolver.cacheInput(a.context);
  expect(input).toMatchObject({
    policy: "place-containment-v1",
    zipCode: "55111",
  });
  expect(input).not.toEqual(await resolver.cacheInput(b.context));
});

it.each([true, false])(
  "revalidates an old cached and persisted place using cached coordinates (containing place: %s)",
  async (hasPlace) => {
    const latitude = 33.76749429006,
      longitude = -96.10511487177;
    const oldFingerprint = typedInputFingerprint({
      latitude,
      longitude,
      city: "ivanhoe",
      state: "tx",
    });
    const writes: unknown[] = [];
    class Client extends EmptyDatabaseClient {
      async query(sql = "") {
        if (sql.includes("ST_Covers"))
          return {
            rows: hasPlace ? [{ location_path_id: "containing-place" }] : [],
          };
        return {
          rows: [{ id: "sam-rayburn", location_path_id: "wrong-ivanhoe" }],
        };
      }
    }
    const context = new DataContext({
      client: new Client(),
      ledger: fakeSourceNameLedger({
        agencies: { source: { canonicalId: "sam-rayburn" } },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      }),
      resolvedPropertyStore: {
        read: async (key) =>
          key.targetProperty === "latitude"
            ? latitude
            : key.targetProperty === "longitude"
              ? longitude
              : key.inputFingerprint === oldFingerprint
                ? "wrong-ivanhoe"
                : undefined,
        write: async (entry) => {
          writes.push(entry);
        },
      },
      resolveAddress: async (input) => {
        // Existing coordinates live only in the property cache. A policy change
        // must use them rather than silently request another geocode.
        expect(input).toMatchObject({
          latitude,
          longitude,
          entityId: "sam-rayburn",
          sourceName: "source",
        });
        return { latitude: input.latitude!, longitude: input.longitude! };
      },
    });
    const facade = context.facadeFromSource("Agency", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "source",
    });
    facade.merge({
      name: "Sam Rayburn ISD Police Department",
      address: "9363 E. FM 273",
      city: "Ivanhoe",
      state: "TX",
      zip_code: "75447",
    });
    if (hasPlace) {
      await expect(facade.value("location_path_id")).resolves.toBe(
        "containing-place",
      );
      expect(writes).toEqual([
        expect.objectContaining({
          targetProperty: "location_path_id",
          value: "containing-place",
        }),
      ]);
    } else {
      await expect(facade.value("location_path_id")).rejects.toThrow(
        "no place location_path_geometry boundary contains",
      );
      expect(writes).toEqual([]);
    }
  },
);
