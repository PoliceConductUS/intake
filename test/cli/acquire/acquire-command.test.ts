import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it, expect, vi } from "vitest";
import { acquireSource } from "../../../src/cli/acquire/index.js";

const fixtureSourcesRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/sources",
);

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

async function makeSourceDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "intake-acquire-"));
  tempDirs.push(dir);
  return path.join(dir, "source");
}

describe("acquireSource", () => {
  it("invokes the source's acquire, which writes raw inputs into sourceDir", async () => {
    const sourceDir = await makeSourceDir();
    const logged: string[] = [];
    const result = await acquireSource("acquire-source", {
      sourcesRoot: fixtureSourcesRoot,
      env: {},
      loadSourceAcquire: (await import(
        "../../../src/cli/run/load-source-module.js"
      )).loadSourceAcquire,
      sourceDir,
      state: "/state",
      logger: { info: (m) => logged.push(m) },
    });

    expect(result.exitCode).toBe(0);
    const written = await readFile(path.join(sourceDir, "roster.json"), "utf8");
    expect(JSON.parse(written)).toEqual({ acquired: true });
    expect(logged).toContain("acquire-source: wrote roster.json");
  });

  it("returns exit 1 when the source does not support acquire", async () => {
    const result = await acquireSource("ok-source", {
      sourcesRoot: fixtureSourcesRoot,
      env: {},
      loadSourceAcquire: (await import(
        "../../../src/cli/run/load-source-module.js"
      )).loadSourceAcquire,
      sourceDir: await makeSourceDir(),
      state: "/state",
      logger: { info: () => {} },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/does not support acquire/);
  });

  it("returns exit 1 and surfaces the error when acquire throws", async () => {
    const result = await acquireSource("boom-source", {
      sourcesRoot: fixtureSourcesRoot,
      env: {},
      loadSourceAcquire: vi.fn(async () => async () => {
        throw new Error("network down");
      }),
      sourceDir: await makeSourceDir(),
      state: "/state",
      logger: { info: () => {} },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/network down/);
  });
});
