import { describe, it, expect } from "vitest";
import { latLngFromAddress } from "../../../src/cli/import/artifacts/facades/geocode-resolvers.js";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";
import { typedInputFingerprint } from "../../../src/cli/state/resolved-property/index.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import { fakeSourceNameLedger } from "../../cli/state/fake-source-name-ledger.js";
import { EmptyDatabaseClient } from "../../cli/database/empty-database-client.js";
import { resolveImportAddress } from "../../../src/cli/import/artifacts/agency-address-resolution.js";

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

it.each(["stale", "absent", "partial"])(
  "reports the coordinate cache state after failed PO-box resolution (%s)",
  async (stored) => {
    const raw = {
      name: "ANDERSON CO. CONST. PCT. 1",
      address: "P.O. Box 952",
      city: "Elkhart",
      state: "TX",
      zip_code: "75839",
    };
    const oldFingerprint = typedInputFingerprint({
      state: "tx",
      city: "elkhart",
      zipCode: "75839",
      address: "p.o. box 952",
      administrativeAreaName: undefined,
      administrativeAreaSlug: undefined,
    });
    const writes: unknown[] = [];
    const context = new DataContext({
      client: new EmptyDatabaseClient(),
      ledger: fakeSourceNameLedger({
        agencies: { "1101": { canonicalId: "cm76wpxay0008vrvgb79ptov8" } },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      }),
      resolvedPropertyStore: {
        read: async (key) =>
          stored === "partial" && key.targetProperty === "longitude"
            ? -95.5789576
            : stored === "stale" &&
                (key.inputFingerprint === undefined ||
                  key.inputFingerprint === oldFingerprint)
              ? key.targetProperty === "latitude"
                ? 31.6279683
                : -95.5789576
              : undefined,
        write: async (value) => {
          writes.push(value);
        },
      },
      resolveAddress: (input) =>
        resolveImportAddress(input, {
          resolveAgencyCoordinates: async () => [],
        }),
    });
    const facade = context.facadeFromSource("Agency", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "1101",
    });
    facade.merge(raw);
    const result = facade.value("latitude");
    for (const detail of [
      "cm76wpxay0008vrvgb79ptov8",
      "gov.tx.tcole",
      "1101",
      raw.name,
      raw.address,
      "Elkhart",
      "TX",
      "75839",
      "physical",
      "location_path_id",
      "--force",
      "npm run cli -- cache get gov.tx.tcole Agency 1101 latitude",
      "npm run cli -- cache get gov.tx.tcole Agency 1101 longitude",
      "npm run cli -- cache set gov.tx.tcole Agency 1101 latitude",
      "npm run cli -- cache set gov.tx.tcole Agency 1101 longitude",
    ])
      await expect(result).rejects.toThrow(detail);
    if (stored === "stale") {
      await expect(result).rejects.toThrow(
        "latitude: cached value 31.6279683 was not reused",
      );
      await expect(result).rejects.toThrow(
        "longitude: cached value -95.5789576 was not reused",
      );
      await expect(result).rejects.toThrow(
        "address or resolution policy changed (input fingerprint mismatch)",
      );
      await expect(result).rejects.toThrow("cache get shows stored entries");
      await expect(result).rejects.toThrow("cache set --force");
    } else {
      await expect(result).rejects.toThrow("latitude: no cached value exists");
      await expect(result).rejects.toThrow(
        stored === "partial"
          ? "longitude: cached value -95.5789576 is reusable"
          : "longitude: no cached value exists",
      );
      await expect(result).rejects.not.toThrow("input fingerprint mismatch");
    }
    expect(writes).toEqual([]);
  },
);

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
    policy: "place-containment-v3-no-postal-exceptions",
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
      policy: "place-containment-v2-local-jurisdictions",
      zipCode: "75447",
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
            rows: hasPlace
              ? [
                  {
                    location_path_id: "containing-place",
                    resolution_class: "primary",
                  },
                ]
              : [],
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
