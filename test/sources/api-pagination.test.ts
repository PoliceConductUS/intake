import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { acquire as clearinghouse } from "../../sources/net/clearinghouse/api/acquire.js";
import { unusedServiceClients } from "../shared/services/harness.js";

it.each([
  {
    acquire: clearinghouse,
    origin: "https://clearinghouse.net",
    key: "CLEARING_HOUSE_API_TOKEN",
  },
])(
  "keeps authenticated pagination on $origin",
  async ({ acquire, origin, key }) => {
    const dir = await mkdtemp(path.join(tmpdir(), "api-pagination-"));
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ results: [], next: origin + "/?page=2" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          results: [],
          next: "https://untrusted.example/page/3",
        }),
      )
      .mockResolvedValue(Response.json({ results: [], next: null }));
    try {
      await acquire({
        clients: unusedServiceClients(),
        sourceDir: dir,
        state: dir,
        env: { [key]: "fixture" },
        data: {
          agencies: async () => ({
            items: [
              {
                agencyId: "fixture",
                name: "Example Police",
                state: "MN",
                place: null,
                county: null,
              },
            ],
          }),
        },
      });
      expect(
        fetch.mock.calls.map(([url]) => new URL(String(url)).origin),
      ).toEqual([origin, origin]);
      expect(fetch.mock.calls[1]).toEqual([
        origin + "/?page=2",
        { headers: { Authorization: "Token fixture" } },
      ]);
    } finally {
      fetch.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
