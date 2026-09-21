import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  downloadGazetteerSources,
  gazetteerSourceUrls,
} from "../../../sources/us-census-gazetteer/acquire/download.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "census-dl-"));
  tempDirs.push(dir);
  return dir;
}

describe("gazetteerSourceUrls", () => {
  it("orders the sources and includes the hierarchy url when present", () => {
    expect(
      gazetteerSourceUrls({
        year: "2024",
        stateUrl: "s",
        administrativeAreaUrl: "a",
        placesUrl: "p",
        stateTigerUrl: "st",
        countyTigerUrl: "ct",
        placeTigerUrls: ["pt1", "pt2"],
        countySubdivisionTigerUrls: ["cs"],
        consolidatedCityTigerUrls: ["cc"],
        hierarchyUrl: "h",
      }),
    ).toEqual(["s", "a", "p", "st", "ct", "pt1", "pt2", "cs", "cc", "h"]);
  });

  it("omits the hierarchy url when absent", () => {
    expect(
      gazetteerSourceUrls({
        year: "2024",
        stateUrl: "s",
        administrativeAreaUrl: "a",
        placesUrl: "p",
        stateTigerUrl: "st",
        countyTigerUrl: "ct",
        placeTigerUrls: [],
        countySubdivisionTigerUrls: [],
        consolidatedCityTigerUrls: [],
      }),
    ).toEqual(["s", "a", "p", "st", "ct"]);
  });
});

describe("downloadGazetteerSources", () => {
  const fixture = fileURLToPath(
    new URL("../../fixtures/gazetteer/sample.zip", import.meta.url),
  );
  it("writes each url to disk under its filename", async () => {
    const dir = await makeDir();
    const fetchBytes = vi.fn(async (url: string) =>
      new TextEncoder().encode(`bytes:${url}`),
    );
    await downloadGazetteerSources({
      sourceDir: dir,
      urls: ["https://x/a.zip", "https://x/sub/b.zip"],
      fetchBytes,
      fetchRange: async () => {
        throw new Error("No existing file to compare");
      },
      logger: { info: () => {} },
    });
    expect((await readdir(dir)).sort()).toEqual(["a.zip", "b.zip"]);
    expect(
      new TextDecoder().decode(await readFile(path.join(dir, "a.zip"))),
    ).toBe("bytes:https://x/a.zip");
  });

  it("reuses a verified file from the previous completed acquisition", async () => {
    const dir = await makeDir();
    const prior = await makeDir();
    const zip = await readFile(fixture);
    await writeFile(path.join(prior, "a.zip"), zip);
    await downloadGazetteerSources({
      sourceDir: dir,
      previousSourceDirs: [prior],
      urls: ["https://x/a.zip"],
      fetchRange: async () => ({
        bytes: zip,
        totalSize: zip.length,
        full: false,
      }),
      fetchBytes: async () => {
        throw new Error("Unchanged ZIP was downloaded");
      },
      logger: { info: () => {} },
    });
    expect(await readFile(path.join(dir, "a.zip"))).toEqual(zip);
    expect(await readFile(path.join(prior, "a.zip"))).toEqual(zip);
  });

  it.each(["changed", "damaged", "truncated"])(
    "replaces a %s local ZIP while preserving the earlier acquisition",
    async (kind) => {
      const dir = await makeDir();
      const prior = await makeDir();
      const zip = await readFile(fixture);
      const local = Buffer.from(zip);
      const dataOffset = 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      local[kind === "changed" ? local.length - 23 : dataOffset] ^= 1;
      const existing =
        kind === "truncated" ? local.subarray(0, local.length - 5) : local;
      await writeFile(path.join(prior, "a.zip"), existing);
      await writeFile(path.join(dir, "a.zip"), existing);
      await downloadGazetteerSources({
        sourceDir: dir,
        previousSourceDirs: [prior],
        urls: ["https://x/a.zip"],
        // Only the remote central-directory tail: corruption earlier in the local
        // payload must also be detected by validating the local entry CRCs.
        fetchRange: async () => ({
          bytes: zip.subarray(zip.readUInt32LE(zip.length - 6)),
          totalSize: zip.length,
          full: false,
        }),
        fetchBytes: async () => zip,
        logger: { info: () => {} },
      });
      expect(await readFile(path.join(dir, "a.zip"))).toEqual(zip);
      expect(await readFile(path.join(prior, "a.zip"))).toEqual(existing);
    },
  );

  it("uses a full response to a range request without downloading twice", async () => {
    const dir = await makeDir();
    const zip = await readFile(fixture);
    await writeFile(path.join(dir, "a.zip"), "outdated");
    await downloadGazetteerSources({
      sourceDir: dir,
      urls: ["https://x/a.zip"],
      fetchRange: async () => ({
        bytes: zip,
        totalSize: zip.length,
        full: true,
      }),
      fetchBytes: async () => {
        throw new Error("Downloaded twice");
      },
      logger: { info: () => {} },
    });
    expect(await readFile(path.join(dir, "a.zip"))).toEqual(zip);
  });

  it("does not replace a local file when fetching its replacement fails", async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, "a.zip"), "old");
    await expect(
      downloadGazetteerSources({
        sourceDir: dir,
        urls: ["https://x/a.zip"],
        fetchRange: async () => ({
          bytes: new Uint8Array([1]),
          totalSize: 1,
          full: false,
        }),
        fetchBytes: async () => {
          throw new Error("download interrupted");
        },
        logger: { info: () => {} },
      }),
    ).rejects.toThrow("download interrupted");
    expect(await readFile(path.join(dir, "a.zip"), "utf8")).toBe("old");
  });

  it("excludes ZIPs left by a resumed attempt using a different vintage", async () => {
    const dir = await makeDir();
    await writeFile(
      path.join(dir, "2026_Gaz_state_national.zip"),
      "previous attempt",
    );
    await downloadGazetteerSources({
      sourceDir: dir,
      urls: ["https://x/2025_Gaz_state_national.zip"],
      fetchRange: async () => {
        throw new Error("No existing file to compare");
      },
      fetchBytes: async () => new Uint8Array([1]),
      logger: { info: () => {} },
    });
    expect(await readdir(dir)).toEqual(["2025_Gaz_state_national.zip"]);
  });
});
