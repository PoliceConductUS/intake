import { describe, expect, it, vi } from "vitest";
import { createCensusAgencyCoordinateResolver } from "../../../src/cli/import/artifacts/agency-coordinate-resolver.js";

const request = {
  rowId: "medina-isd",
  name: "Medina ISD Police Department",
  address: "1 Bobcat Lane",
  city: "Medina",
  state: "TX",
  zipCode: "78055",
};

describe("agency address coordinates", () => {
  it("leaves an unmatched address unresolved instead of using place or ZIP centroids", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("addressbatch"))
        return new Response('"medina-isd","1 Bobcat Lane","No_Match"');
      if (String(url).includes("/geographies/address?"))
        return Response.json({ result: { addressMatches: [] } });
      return Response.json({
        features: [
          { attributes: { CENTLAT: 26.9289548, CENTLON: -99.2614176 } },
        ],
      });
    });
    await expect(
      createCensusAgencyCoordinateResolver(fetcher)([request]),
    ).resolves.toEqual([]);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toHaveLength(2);
  });

  it("retains a successful street-address retry after a batch miss", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("addressbatch")
        ? new Response('"medina-isd","1 Bobcat Lane","No_Match"')
        : Response.json({
            result: {
              addressMatches: [{ coordinates: { x: -99.25, y: 29.8 } }],
            },
          }),
    );
    await expect(
      createCensusAgencyCoordinateResolver(fetcher)([request]),
    ).resolves.toEqual([
      { rowId: "medina-isd", latitude: 29.8, longitude: -99.25 },
    ]);
  });
});
