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
  it.each(["batch", "single"])(
    "identifies the %s request and nested network cause",
    async (stage) => {
      const connectionError = Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
        address: "192.0.2.1",
        port: 443,
      });
      const failure = new TypeError("fetch failed", {
        cause: new AggregateError([connectionError], ""),
      });
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        if (stage === "single" && String(url).includes("addressbatch"))
          return new Response('"medina-isd","1 Bobcat Lane","No_Match"');
        throw failure;
      });
      const result = createCensusAgencyCoordinateResolver(fetcher)([
        { ...request, sourceName: "tcole-agency-123" },
      ]);
      await expect(result).rejects.toMatchObject({ cause: failure });
      await expect(result).rejects.toThrow(
        stage === "batch"
          ? "POST https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
          : "GET https://geocoding.geo.census.gov/geocoder/geographies/address",
      );
      for (const detail of [
        request.rowId,
        request.name,
        request.address,
        request.city,
        request.state,
        request.zipCode,
        "tcole-agency-123",
        "fetch failed",
        "ECONNREFUSED",
        "192.0.2.1",
        "443",
      ])
        await expect(result).rejects.toThrow(detail);
    },
  );

  it("identifies every agency in a failed batch", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("", { status: 503, statusText: "Service Unavailable" }),
    );
    const result = createCensusAgencyCoordinateResolver(fetcher)([
      request,
      { ...request, rowId: "second-agency", address: "2 Main Street" },
    ]);
    for (const detail of [
      "POST",
      "addressbatch",
      "503 Service Unavailable",
      request.rowId,
      "second-agency",
      "2 Main Street",
    ])
      await expect(result).rejects.toThrow(detail);
  });

  it("retains request context when reading the response body fails", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("connection terminated"));
            },
          }),
        ),
    );
    const result = createCensusAgencyCoordinateResolver(fetcher)([request]);
    for (const detail of [
      "addressbatch",
      request.rowId,
      "connection terminated",
    ])
      await expect(result).rejects.toThrow(detail);
  });

  it("identifies the agency and endpoint on timeout", async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const result = createCensusAgencyCoordinateResolver(fetcher, {
      requestTimeoutMs: 5,
    })([request]);
    for (const detail of [
      "timed out after 5 ms",
      "addressbatch",
      request.rowId,
      request.address,
    ])
      await expect(result).rejects.toThrow(detail);
  });

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
