import { expect, test } from "vitest";
import { DataContext } from "../../../src/cli/import/artifacts/data-context.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import { EmptyDatabaseClient } from "../../cli/database/empty-database-client.js";
import { fakeSourceNameLedger } from "../../cli/state/fake-source-name-ledger.js";

for (const level of ["state", "administrative_area", "place"] as const) {
  for (const origin of ["supplied", "cache", "address", "memory"] as const) {
    test(`${origin} agency location ${level} is ${level === "place" ? "accepted" : "rejected"}`, async () => {
      const location = {
        location_path_id: "location-id",
        level,
        resolution_class: "primary",
      };
      class Client extends EmptyDatabaseClient {
        async query(sql = "") {
          return {
            rows:
              sql.includes("ST_Covers") ||
              sql.includes("where location_path_id = $1")
                ? [location]
                : [],
          };
        }
      }
      const writes: unknown[] = [];
      const context = new DataContext({
        client: new Client(),
        ledger: fakeSourceNameLedger({
          agencies: { airport: { canonicalId: "agency-id" } },
          personnel: {},
          agencyPersonnel: {},
          locationPaths: {},
        }),
        resolveAddress: async () => ({ latitude: 44.89, longitude: -93.22 }),
        resolvedPropertyStore: {
          read: async (input) =>
            origin === "cache" && input.targetProperty === "location_path_id"
              ? "location-id"
              : undefined,
          write: async (input) => {
            writes.push(input);
          },
        },
      });
      if (origin === "memory")
        context.cacheLocation("agency", "agency-id", {
          locationPathId: "location-id",
          addressLatitude: 44.89,
          addressLongitude: -93.22,
        });
      const facade = context.facadeFromSource("Agency", {
        apiVersion: INTAKE_API_VERSION,
        namespace: "mn-post",
        name: "airport",
        spec: {
          name: "Metropolitan Airports Commission",
          address: "4300 Glumack Dr",
          city: "St. Paul",
          state: "MN",
          zip_code: "55111",
          latitude: 44.89,
          longitude: -93.22,
          ...(origin === "supplied" ? { location_path_id: "location-id" } : {}),
        },
      });
      const result = facade.value("location_path_id");
      if (level === "place") await expect(result).resolves.toBe("location-id");
      else {
        await expect(result).rejects.toThrow(
          /must reference an existing place/,
        );
        expect(writes).toEqual([]);
      }
    });
  }
}
