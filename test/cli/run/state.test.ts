import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sourceStateDir } from "../../../src/cli/run/state.js";

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "intake-source-state-"));
}

describe("sourceStateDir", () => {
  it("ensures and returns the per-source persistent state directory", async () => {
    const workspace = await tempDir();
    const dir = await sourceStateDir({ INTAKE_WORKSPACE: workspace }, "gov.x");

    expect(dir).toBe(path.join(workspace, "state", "gov.x"));
    const stats = await stat(dir);
    expect(stats.isDirectory()).toBe(true);
  });

  it("is stable across two calls", async () => {
    const workspace = await tempDir();
    const first = await sourceStateDir(
      { INTAKE_WORKSPACE: workspace },
      "gov.x",
    );
    const second = await sourceStateDir(
      { INTAKE_WORKSPACE: workspace },
      "gov.x",
    );

    expect(second).toBe(first);
    const stats = await stat(second);
    expect(stats.isDirectory()).toBe(true);
  });

  it("throws clearly when INTAKE_WORKSPACE is unset", async () => {
    await expect(sourceStateDir({}, "gov.x")).rejects.toThrow(
      /INTAKE_WORKSPACE/,
    );
  });
});
