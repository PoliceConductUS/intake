import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { assertNoExistingImport } from "../../../src/cli/import/artifacts/existing-import.js";
import { Artifacts } from "../../../src/shared/io/index.js";

let workspace: string;
beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "existing-import-"));
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function check(): Promise<void> {
  const { path: artifactsPath } = await Artifacts.write(
    path.join(workspace, "transform"),
    Artifacts.new({
      metadata: { namespace: "test", name: "current" },
      spec: { artifacts: [] },
    }),
  );
  await assertNoExistingImport(await Artifacts.read(artifactsPath), {
    env: { INTAKE_WORKSPACE: workspace },
  });
}

test("passes when the workspace has no command directory yet", async () => {
  await expect(check()).resolves.toBeUndefined();
});

test("fails when the command root cannot be listed", async () => {
  await writeFile(path.join(workspace, "command"), "not a directory");

  await expect(check()).rejects.toThrow("ENOTDIR");
});

test("fails when a command directory cannot be listed", async () => {
  const unreadable = path.join(workspace, "command", "run-1");
  await mkdir(unreadable, { recursive: true });
  await chmod(unreadable, 0o000);
  try {
    await expect(check()).rejects.toThrow("EACCES");
  } finally {
    await chmod(unreadable, 0o700);
  }
});
