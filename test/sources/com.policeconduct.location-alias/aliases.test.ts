import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import {
  appendAlias,
  locationPathFromUrl,
  readLatestAliases,
} from "../../../sources/com.policeconduct.location-alias/aliases.js";
import { run } from "../../../sources/com.policeconduct.location-alias/run.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});
async function stateDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "loc-alias-"));
  tempDirs.push(dir);
  return dir;
}

describe("locationPathFromUrl", () => {
  it("extracts the location path from a full URL or a bare path", () => {
    expect(
      locationPathFromUrl(
        "https://policeconduct.org/mn/ramsey-county/st-paul/",
      ),
    ).toBe("/mn/ramsey-county/st-paul/");
    // Bare path, missing/extra slashes normalized.
    expect(locationPathFromUrl("mn/ramsey-county/saint-paul")).toBe(
      "/mn/ramsey-county/saint-paul/",
    );
  });
});

describe("alias chain", () => {
  it("accumulates across appends and chains each output to the previous", async () => {
    const state = await stateDir();

    const first = await appendAlias(state, {
      alias_path: "/mn/ramsey-county/st-paul/",
      location_path_id: "/mn/ramsey-county/saint-paul/",
    });
    expect(first.previous).toBeNull();
    expect(first.aliases).toHaveLength(1);

    const second = await appendAlias(state, {
      alias_path: "/tx/bexar-county/san-antone/",
      location_path_id: "/tx/bexar-county/san-antonio/",
    });
    // The second output points back at the first (path + sha), and carries both.
    expect(second.previous).not.toBeNull();
    expect(second.aliases.map((a) => a.alias_path)).toEqual([
      "/mn/ramsey-county/st-paul/",
      "/tx/bexar-county/san-antone/",
    ]);

    // The latest read returns the accumulated list.
    const latest = await readLatestAliases(state);
    expect(latest.aliases).toHaveLength(2);

    // run emits one LocationPathAlias record per alias, keyed by alias_path.
    const manifest = await run({
      paths: [],
      readXlsx: async () => [],
      state,
      emit: async () => {},
    } as never);
    const [artifact] = manifest.artifacts;
    expect(artifact.kind).toBe("LocationPathAliases");
    expect(artifact.records["/mn/ramsey-county/st-paul/"]).toEqual({
      spec: {
        alias_path: "/mn/ramsey-county/st-paul/",
        location_path_id: "/mn/ramsey-county/saint-paul/",
      },
    });
  });

  it("dedupes by alias_path — a repeated alias updates its target", async () => {
    const state = await stateDir();
    await appendAlias(state, {
      alias_path: "/mn/ramsey-county/st-paul/",
      location_path_id: "/wrong/",
    });
    const updated = await appendAlias(state, {
      alias_path: "/mn/ramsey-county/st-paul/",
      location_path_id: "/mn/ramsey-county/saint-paul/",
    });
    expect(updated.aliases).toHaveLength(1);
    expect(updated.aliases[0].location_path_id).toBe(
      "/mn/ramsey-county/saint-paul/",
    );
  });

  it("fails loud when the latest output was edited out of band", async () => {
    const state = await stateDir();
    await appendAlias(state, {
      alias_path: "/a/b/c/",
      location_path_id: "/a/b/canonical/",
    });
    // Tamper with the latest output file (sha no longer matches the pointer).
    const dir = path.join(state, "location-aliases");
    const outputFile = (await readdir(dir)).find(
      (name) => name !== "latest.json",
    )!;
    await writeFile(
      path.join(dir, outputFile),
      (await readFile(path.join(dir, outputFile), "utf8")) + "\n",
    );

    await expect(readLatestAliases(state)).rejects.toThrow(/sha mismatch/);
  });
});
