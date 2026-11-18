import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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

  it("fails when the variable is unset", () => {
    expect(() => intakeWorkspace({})).toThrow(
      "INTAKE_WORKSPACE is required: the absolute path of an existing workspace folder.",
    );
  });

  it("fails when the variable is blank, naming the variable in use", () => {
    expect(() =>
      intakeWorkspace({ INTAKE_WORKSPACE_TEST: " ", INTAKE_WORKSPACE: "/" }),
    ).toThrow(
      "INTAKE_WORKSPACE_TEST is required: the absolute path of an existing workspace folder.",
    );
  });

  it("fails on a relative path that names an existing folder", async () => {
    const workspace = await tempDir();
    const relative = path.relative(process.cwd(), workspace);
    expect(() => intakeWorkspace({ INTAKE_WORKSPACE: relative })).toThrow(
      `INTAKE_WORKSPACE must be an absolute path: ${relative}`,
    );
  });

  it("fails on a relative path that names nothing", () => {
    expect(() =>
      intakeWorkspace({ INTAKE_WORKSPACE: "../intake-workspace/dev" }),
    ).toThrow(
      "INTAKE_WORKSPACE must be an absolute path: ../intake-workspace/dev",
    );
  });

  it("fails on a missing path", async () => {
    const missing = path.join(await tempDir(), "absent");
    expect(() => intakeWorkspace({ INTAKE_WORKSPACE: missing })).toThrow(
      `INTAKE_WORKSPACE ${missing} is not an existing folder.`,
    );
  });

  it("fails on a path that names a file", async () => {
    const file = path.join(await tempDir(), "workspace.txt");
    await writeFile(file, "");
    expect(() => intakeWorkspace({ INTAKE_WORKSPACE: file })).toThrow(
      `INTAKE_WORKSPACE ${file} is not an existing folder.`,
    );
  });

  it("fails on a path it cannot read, naming the variable and the value", async () => {
    const locked = path.join(await tempDir(), "locked");
    await mkdir(locked);
    const workspace = path.join(locked, "workspace");
    await chmod(locked, 0o000);
    try {
      expect(() => intakeWorkspace({ INTAKE_WORKSPACE: workspace })).toThrow(
        `INTAKE_WORKSPACE ${workspace} cannot be read: EACCES`,
      );
    } finally {
      await chmod(locked, 0o700);
    }
  });

  it("names INTAKE_WORKSPACE_TEST when that is the path in use", async () => {
    const missing = path.join(await tempDir(), "absent");
    const existing = await tempDir();
    expect(() =>
      intakeWorkspace({
        INTAKE_WORKSPACE_TEST: missing,
        INTAKE_WORKSPACE: existing,
      }),
    ).toThrow(`INTAKE_WORKSPACE_TEST ${missing} is not an existing folder.`);
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
