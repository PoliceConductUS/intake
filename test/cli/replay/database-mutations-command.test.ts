import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runReplayDatabaseMutationsCommand } from "../../../src/cli/replay/database-mutations/index.js";

test("an invalid DatabaseMutations file fails before a command directory is created", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "replay-command-"));
  try {
    const workspace = path.join(root, "workspace");
    const file = path.join(root, "broken.DatabaseMutations.yaml");
    await writeFile(file, "kind: [unterminated");
    let replayed = false;

    const result = await runReplayDatabaseMutationsCommand(file, {
      env: { INTAKE_WORKSPACE: workspace },
      terminal: false,
      replayDatabaseMutations: async () => {
        replayed = true;
        return { ok: false, error: new Error("should not run") };
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(file);
    expect(replayed).toBe(false);
    await expect(readdir(workspace)).rejects.toThrow("ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
