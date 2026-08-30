import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
        hierarchyUrl: "h",
      }),
    ).toEqual(["s", "a", "p", "st", "ct", "pt1", "pt2", "h"]);
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
      }),
    ).toEqual(["s", "a", "p", "st", "ct"]);
  });
});

describe("downloadGazetteerSources", () => {
  it("writes each url to disk under its filename", async () => {
    const dir = await makeDir();
    const fetchBytes = vi.fn(async (url: string) =>
      new TextEncoder().encode(`bytes:${url}`),
    );
    await downloadGazetteerSources({
      sourceDir: dir,
      urls: ["https://x/a.zip", "https://x/sub/b.zip"],
      fetchBytes,
      logger: { info: () => {} },
    });
    expect((await readdir(dir)).sort()).toEqual(["a.zip", "b.zip"]);
    expect(
      new TextDecoder().decode(await readFile(path.join(dir, "a.zip"))),
    ).toBe("bytes:https://x/a.zip");
  });

  it("skips files already on disk so an interrupted run resumes", async () => {
    const dir = await makeDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "a.zip"), "kept");
    const fetchBytes = vi.fn(async () => new Uint8Array([1]));
    await downloadGazetteerSources({
      sourceDir: dir,
      urls: ["https://x/a.zip", "https://x/b.zip"],
      fetchBytes,
      logger: { info: () => {} },
    });
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(fetchBytes).toHaveBeenCalledWith("https://x/b.zip");
    expect(await readFile(path.join(dir, "a.zip"), "utf8")).toBe("kept");
  });
});
