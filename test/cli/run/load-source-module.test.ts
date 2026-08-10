import { describe, it, expect } from "vitest";
import { loadSourceModule } from "../../../src/cli/run/load-source-module.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sourcesRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/sources",
);

describe("loadSourceModule", () => {
  it("loads a module exporting run", async () => {
    const run = await loadSourceModule("ok-source", sourcesRoot);
    expect(typeof run).toBe("function");
  });

  it("fails clearly for an unknown source id", async () => {
    await expect(loadSourceModule("missing", sourcesRoot)).rejects.toThrow(
      /missing/,
    );
  });

  it("fails when the module has no run export", async () => {
    await expect(loadSourceModule("no-run", sourcesRoot)).rejects.toThrow(
      /run/,
    );
  });

  it("rejects a source id containing path traversal", async () => {
    await expect(loadSourceModule("../evil", sourcesRoot)).rejects.toThrow(
      /invalid source id/i,
    );
  });
});
