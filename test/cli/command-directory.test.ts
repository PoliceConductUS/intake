import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCommandDirectory,
  intakeWorkspace,
} from "../../src/cli/command-directory.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "intake-workspace-"));
  tempDirs.push(dir);
  return dir;
}

describe("intakeWorkspace", () => {
  it("returns an existing folder", async () => {
    const workspace = await tempDir();
    expect(intakeWorkspace({ INTAKE_WORKSPACE: workspace })).toBe(workspace);
  });

  it("fails on a missing path, naming it as given and as resolved", async () => {
    const missing = path.join(await tempDir(), "absent");
    expect(() => intakeWorkspace({ INTAKE_WORKSPACE: missing })).toThrow(
      `INTAKE_WORKSPACE ${missing} (resolved: ${missing}) is not an existing folder.`,
    );
  });

  it("fails on a path that names a file", async () => {
    const file = path.join(await tempDir(), "workspace.txt");
    await writeFile(file, "");
    expect(() => intakeWorkspace({ INTAKE_WORKSPACE: file })).toThrow(
      `INTAKE_WORKSPACE ${file} (resolved: ${file}) is not an existing folder.`,
    );
  });

  it("fails on a relative path that resolves to nothing", () => {
    const relative = "../intake-workspace-that-does-not-exist/dev";
    const resolved = path.join(
      path.dirname(process.cwd()),
      "intake-workspace-that-does-not-exist",
      "dev",
    );
    expect(() => intakeWorkspace({ INTAKE_WORKSPACE: relative })).toThrow(
      `INTAKE_WORKSPACE ${relative} (resolved: ${resolved}) is not an existing folder.`,
    );
  });

  it("names INTAKE_WORKSPACE_TEST when that is the path in use", async () => {
    const missing = path.join(await tempDir(), "absent");
    const existing = await tempDir();
    expect(() =>
      intakeWorkspace({
        INTAKE_WORKSPACE_TEST: missing,
        INTAKE_WORKSPACE: existing,
      }),
    ).toThrow(
      `INTAKE_WORKSPACE_TEST ${missing} (resolved: ${missing}) is not an existing folder.`,
    );
  });
});

describe("createCommandDirectory", () => {
  it("does not create a missing workspace", async () => {
    const missing = path.join(await tempDir(), "absent");
    await expect(
      createCommandDirectory({ INTAKE_WORKSPACE: missing }),
    ).rejects.toThrow("is not an existing folder.");
    await expect(stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
