import { EntityFacade } from "../../../src/cli/import/artifacts/facades/entity-facade.js";
import { Resolver } from "../../../src/cli/import/artifacts/resolver-kit.js";
import { describe, it, expect } from "vitest";
import { latLngFromAddress } from "../../../src/cli/import/artifacts/facades/geocode-resolvers.js";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";
import { typedInputFingerprint } from "../../../src/cli/state/resolved-property/index.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import { fakeSourceNameLedger } from "../../cli/state/fake-source-name-ledger.js";
import { EmptyDatabaseClient } from "../../cli/database/empty-database-client.js";
import { resolveImportAddress } from "../../../src/cli/import/artifacts/agency-address-resolution.js";
import { createCensusAgencyCoordinateResolver } from "../../../src/cli/import/artifacts/agency-coordinate-resolver.js";

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

it.each(["network", "http", "timeout", "body"])(
  "does not suggest a latitude cache correction for a Census %s failure",
  async (failure) => {
    const resolveAgencyCoordinates = createCensusAgencyCoordinateResolver(
      async (_url, init) => {
        if (failure === "http") return new Response("", { status: 503 });
        if (failure === "timeout")
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        if (failure === "body")
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("connection terminated"));
              },
            }),
          );
        throw new TypeError("fetch failed");
      },
      { requestTimeoutMs: 5 },
    );
    const context = new DataContext({
      client: new EmptyDatabaseClient(),
      ledger: fakeSourceNameLedger({
        agencies: { "5904": { canonicalId: "central-isd" } },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      }),
      resolvedPropertyStore: {
        read: async () => undefined,
        write: async () => {},
      },
      resolveAddress: (input) =>
        resolveImportAddress(input, { resolveAgencyCoordinates }),
    });
    const facade = context.facadeFromSource("Agency", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "gov.tx.tcole",
      name: "5904",
    });
    facade.merge({
      name: "CENTRAL INDEPENDENT SCHOOL DISTRICT",
      address: "7622 US HWY 69 N",
      city: "POLLOK",
      state: "TX",
      zip_code: "75969",
    });
    const result = facade.value("latitude");
    await expect(result).rejects.toThrow("Census geocoder request failed:");
    await expect(result).rejects.not.toThrow("Cache correction:");
    await expect(result).rejects.not.toThrow("cache set");
    await expect(result).rejects.toThrow("Retry the command");
  },
);

it("reports source identity and usable cache correction instructions when a changed PO-box address cannot resolve", async () => {
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
    address: "p.o. box 951",
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
        key.inputFingerprint === oldFingerprint
          ? key.targetProperty === "latitude"
            ? 31.6279683
            : -95.5789576
          : undefined,
      write: async (value) => {
        writes.push(value);
      },
    },
    resolveAddress: (input) =>
      resolveImportAddress(input, { resolveAgencyCoordinates: async () => [] }),
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
  const error = await result.catch((error: Error) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(
    "Google Maps — name: https://www.google.com/maps/search/?api=1&query=ANDERSON%20CO.%20CONST.%20PCT.%201\n" +
      "Google Maps — address: https://www.google.com/maps/search/?api=1&query=P.O.%20Box%20952%2C%20Elkhart%2C%20TX%2075839",
  );
  expect(writes).toEqual([]);
});

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

it.each([
  ["unchanged", "1 Main St", 30.5, -97.7, 0],
  ["formatting only", "  1 MAIN  ST  ", 30.5, -97.7, 0],
  ["changed", "2 Main St", 31, -98, 1],
] as const)(
  "%s address determines coordinate reuse",
  async (_, address, latitude, longitude, calls) => {
    const fingerprint = typedInputFingerprint({
      state: "tx",
      city: "austin",
      zipCode: "78701",
      address: "1 main st",
      administrativeAreaName: undefined,
      administrativeAreaSlug: undefined,
    });
    const entries = new Map<string, unknown>([
      [`latitude:${fingerprint}`, 30.5],
      [`longitude:${fingerprint}`, -97.7],
    ]);
    let geocodes = 0;
    const facade = new EntityFacade<Record<string, unknown>, never>(
      "Agency",
      [],
      {
        id: new Resolver(async () => "agency-1"),
        ...latLngFromAddress(AGENCY_CONFIG),
      },
      {} as never,
      {
        source: { namespace: "test", name: "agency-1" },
        backend: {
          resolveAgencyLocation: async () => {
            geocodes++;
            return {
              addressLatitude: 31,
              addressLongitude: -98,
              locationPathId: "place-1",
            };
          },
        } as never,
        cacheableProperties: ["latitude", "longitude"],
        cache: {
          read: async (key) =>
            entries.get(`${key.property}:${key.inputFingerprint}`),
          write: async (key, value) => {
            entries.set(`${key.property}:${key.inputFingerprint}`, value);
          },
        },
      },
    );
    facade.merge({ address, city: "Austin", state: "TX", zip_code: "78701" });
    expect(await facade.value("latitude")).toBe(latitude);
    expect(await facade.value("longitude")).toBe(longitude);
    expect(geocodes).toBe(calls);
    expect(entries.get(`latitude:${fingerprint}`)).toBe(30.5);
    expect(entries.get(`longitude:${fingerprint}`)).toBe(-97.7);
    expect(entries.size).toBe(calls === 0 ? 2 : 4);
  },
);

it.each([
  [
    "unchanged",
    31.92152071267,
    "TENNESSEE COLONY",
    "75861-3332",
    "cached-place",
    0,
  ],
  [
    "ZIP-only change",
    31.92152071267,
    "TENNESSEE COLONY",
    "75861",
    "cached-place",
    0,
  ],
  ["changed point", 31.922, "TENNESSEE COLONY", "75861-3332", "new-place", 1],
  ["changed city", 31.92152071267, "OTHER CITY", "75861-3332", "new-place", 1],
] as const)(
  "%s determines location cache reuse",
  async (_, latitude, city, zip, expected, calls) => {
    const entries = new Map<string, unknown>([
      [
        "12f45d609ecec22b94f5e5ff20493b53758b38e4be792035c87089c695ef2c4d",
        "cached-place",
      ],
    ]);
    let resolutions = 0;
    const facade = new EntityFacade<Record<string, unknown>, never>(
      "Agency",
      [],
      {
        id: new Resolver(async () => "agency-1"),
        ...latLngFromAddress(AGENCY_CONFIG),
      },
      {} as never,
      {
        source: { namespace: "test", name: "agency-1" },
        backend: {
          resolveAgencyLocation: async () => {
            resolutions++;
            return {
              locationPathId: "new-place",
              addressLatitude: latitude,
              addressLongitude: -95.923838477526,
            };
          },
        } as never,
        cacheableProperties: ["location_path_id"],
        cache: {
          read: async (key) => entries.get(key.inputFingerprint!),
          write: async (key, value) => {
            entries.set(key.inputFingerprint!, value);
          },
        },
      },
    );
    facade.merge({
      latitude,
      longitude: -95.923838477526,
      city,
      state: "TX",
      zip_code: zip,
    });
    expect(await facade.value("location_path_id")).toBe(expected);
    expect(resolutions).toBe(calls);
    expect(entries.size).toBe(calls === 0 ? 1 : 2);
  },
);

it.each([true, false])(
  "resolves a changed point using cached coordinates (containing place: %s)",
  async (hasPlace) => {
    const latitude = 33.76749429006,
      longitude = -96.10511487177;
    const oldFingerprint = typedInputFingerprint({
      latitude: latitude + 1,
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
        // A changed point must reuse its cached coordinates without geocoding again.
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
