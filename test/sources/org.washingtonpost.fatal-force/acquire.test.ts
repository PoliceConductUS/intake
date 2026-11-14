import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { acquire } from "../../../sources/org.washingtonpost.fatal-force/acquire.js";
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});
test("preserves pinned bytes and provenance across acquisitions; rejects corrupt saved evidence", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fatal-force-test-"));
  dirs.push(dir);
  const fetch = vi.fn(
    async () => new Response("id,name\n1,Synthetic Agency\n"),
  );
  vi.stubGlobal("fetch", fetch);
  const deps = {
    sourceDir: dir,
    state: dir,
    env: {},
    data: { agencies: async () => ({ items: [] }) },
  };
  await acquire(deps);
  const first = await readFile(path.join(dir, "provenance.json"), "utf8");
  expect(fetch).toHaveBeenCalledTimes(2);
  await acquire(deps);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await readFile(path.join(dir, "provenance.json"), "utf8")).toBe(first);
  await writeFile(path.join(dir, "fatal-police-shootings-data.csv"), "corrupt");
  await expect(acquire(deps)).rejects.toThrow(/checksum/);
});
test("rejects moving refs before accessing the network", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    acquire({
      sourceDir: "unused",
      state: "unused",
      env: { FATAL_FORCE_COMMIT: "master" },
      data: { agencies: async () => ({ items: [] }) },
    }),
  ).rejects.toThrow(/commit/);
  expect(fetch).not.toHaveBeenCalled();
});
