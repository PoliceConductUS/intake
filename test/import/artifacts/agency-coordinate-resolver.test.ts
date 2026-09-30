import { describe, expect, it, vi } from "vitest";
import { parse as parseCsv } from "csv-parse/sync";
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
  it("coalesces the same normalized address and preserves each caller's agency ID", async () => {
    const fetcher = vi.fn(
      async () => new Response('"medina-isd","","Match","","","-99.25,29.8"'),
    );
    const resolver = createCensusAgencyCoordinateResolver(fetcher);
    const first = resolver([request]);
    const second = resolver([
      {
        ...request,
        rowId: "another-agency",
        address: "1  Bobcat Lane",
        zipCode: "78055-1234",
      },
    ]);
    await expect(first).resolves.toEqual([
      { rowId: "medina-isd", latitude: 29.8, longitude: -99.25 },
    ]);
    await expect(second).resolves.toEqual([
      { rowId: "another-agency", latitude: 29.8, longitude: -99.25 },
    ]);
    await resolver([request]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("batches 2949 concurrent callers and returns each caller's coordinates with only one request active", async () => {
    let active = 0;
    let peak = 0;
    const batchSizes: number[] = [];
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        active++;
        peak = Math.max(peak, active);
        const form = init!.body as FormData;
        const rows = parseCsv(
          await (form.get("addressFile") as Blob).text(),
        ) as string[][];
        batchSizes.push(rows.length);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active--;
        return new Response(
          rows
            .map(
              ([id]) =>
                `"${id}","","Match","","","-99.25,${Number(id) / 1000}"`,
            )
            .join("\n"),
        );
      },
    );
    const resolver = createCensusAgencyCoordinateResolver(fetcher);
    const results = await Promise.all(
      Array.from({ length: 2949 }, (_, i) =>
        resolver([
          { ...request, rowId: String(i), address: `${i} Main Street` },
        ]),
      ),
    );
    expect(batchSizes).toEqual([1000, 1000, 949]);
    expect(peak).toBe(1);
    expect(results).toEqual(
      Array.from({ length: 2949 }, (_, i) => [
        { rowId: String(i), latitude: i / 1000, longitude: -99.25 },
      ]),
    );
  });

  it("queues callers arriving during an unmatched address attempt without overlapping requests", async () => {
    let release!: () => void;
    let started!: () => void;
    const singleStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const batch = String(url).includes("addressbatch");
      calls.push(batch ? "batch" : "single");
      if (calls.length === 1) return new Response('"medina-isd","","No_Match"');
      if (!batch) {
        started();
        await gate;
        return Response.json({ result: { addressMatches: [] } });
      }
      return new Response('"second","","Match","","","-99.25,29.8"');
    });
    const resolver = createCensusAgencyCoordinateResolver(fetcher);
    const first = resolver([request]);
    await singleStarted;
    const second = resolver([
      { ...request, rowId: "second", address: "2 Main Street" },
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toEqual(["batch", "single"]);
    release();
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([
      { rowId: "second", latitude: 29.8, longitude: -99.25 },
    ]);
    expect(calls).toEqual(["batch", "single", "batch"]);
  });

  it("rejects every pending caller after a request failure without starting more requests", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const resolver = createCensusAgencyCoordinateResolver(fetcher);
    const results = await Promise.allSettled(
      Array.from({ length: 1001 }, (_, i) =>
        resolver([
          { ...request, rowId: String(i), address: `${i} Main Street` },
        ]),
      ),
    );
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(resolver([request])).rejects.toThrow("fetch failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

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
    await expect(result).rejects.toThrow(
      /^Census geocoder request failed: HTTP 503 Service Unavailable\n/,
    );
    await expect(result).rejects.toThrow("Affected agencies (2):\n");
    await expect(result).rejects.toThrow("\n  - medina-isd");
    await expect(result).rejects.toThrow("\n  - second-agency");
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
