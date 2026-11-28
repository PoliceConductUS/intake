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

  it("fails when INTAKE_WORKSPACE is blank", () => {
    expect(() => intakeWorkspace({ INTAKE_WORKSPACE: " " })).toThrow(
      "INTAKE_WORKSPACE is required: the absolute path of an existing workspace folder.",
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

  it("ignores INTAKE_WORKSPACE_TEST", async () => {
    const ignored = await tempDir();
    const workspace = await tempDir();
    const missing = path.join(workspace, "absent");
    expect(
      intakeWorkspace({
        INTAKE_WORKSPACE_TEST: ignored,
        INTAKE_WORKSPACE: workspace,
      }),
    ).toBe(workspace);
    for (const env of [
      { INTAKE_WORKSPACE_TEST: ignored },
      { INTAKE_WORKSPACE_TEST: ignored, INTAKE_WORKSPACE: " " },
    ])
      expect(() => intakeWorkspace(env)).toThrow(
        "INTAKE_WORKSPACE is required: the absolute path of an existing workspace folder.",
      );
    expect(() =>
      intakeWorkspace({
        INTAKE_WORKSPACE_TEST: ignored,
        INTAKE_WORKSPACE: "relative/workspace",
      }),
    ).toThrow("INTAKE_WORKSPACE must be an absolute path: relative/workspace");
    expect(() =>
      intakeWorkspace({
        INTAKE_WORKSPACE_TEST: ignored,
        INTAKE_WORKSPACE: missing,
      }),
    ).toThrow(`INTAKE_WORKSPACE ${missing} is not an existing folder.`);
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

  it.each(["inf", "", "INFO "])(
    "fails on LOG_LEVEL %j before creating the folder, naming the value",
    async (level) => {
      const workspace = await tempDir();
      await expect(
        createCommandDirectory({
          INTAKE_WORKSPACE: workspace,
          LOG_LEVEL: level,
        }),
      ).rejects.toThrow(
        `LOG_LEVEL ${JSON.stringify(level)} is not a log level. Use one of: fatal, error, warn, info, debug, trace, silent.`,
      );
      await expect(stat(path.join(workspace, "command"))).rejects.toMatchObject(
        { code: "ENOENT" },
      );
    },
  );

  it("accepts each log level", async () => {
    const workspace = await tempDir();
    for (const level of [
      "fatal",
      "error",
      "warn",
      "info",
      "debug",
      "trace",
      "silent",
    ])
      await createCommandDirectory({
        INTAKE_WORKSPACE: workspace,
        LOG_LEVEL: level,
      });
  });
});
