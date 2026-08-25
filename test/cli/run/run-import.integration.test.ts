import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runIntake } from "../../../src/cli/index.js";
import type { CommandResult } from "../../../src/shared/cli/types.js";

// End-to-end test of `intake run gov.azpost.roster --dry-run` through the real
// CLI entry point (`runIntake`). gov.azpost.roster is disabled (produces is
// empty), so the run planner skips it: it never parses input, never builds an
// envelope, and never reaches the import command. The run reports it as skipped
// and exits 0. Re-enable this source (and rewrite this test) once it produces
// Agency + AgencyPersonnel — see gov.azpost.roster/run.ts.
describe("intake run gov.azpost.roster (disabled)", () => {
  let workspace: string;
  let previousWorkspace: string | undefined;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "intake-run-"));
    previousWorkspace = process.env.INTAKE_WORKSPACE;
    process.env.INTAKE_WORKSPACE = workspace;
  });

  afterEach(async () => {
    if (previousWorkspace === undefined) {
      delete process.env.INTAKE_WORKSPACE;
    } else {
      process.env.INTAKE_WORKSPACE = previousWorkspace;
    }
    await rm(workspace, { recursive: true, force: true });
  });

  it("skips the disabled source without running the import", async () => {
    let importCalled = false;
    const runImportArtifactsCommand = async (): Promise<CommandResult> => {
      importCalled = true;
      return { exitCode: 0 };
    };

    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    try {
      const result = await runIntake(["run", "gov.azpost.roster", "--dry-run"], {
        runImportArtifactsCommand,
      });

      expect(result.exitCode).toBe(0);
      expect(importCalled).toBe(false);

      const messages = stderr.mock.calls.map((call) => String(call[0]));
      expect(messages.some((line) => /skipped: gov\.azpost\.roster/.test(line))).toBe(
        true,
      );
    } finally {
      stderr.mockRestore();
    }
  });

  it("fails loud when a source has not been acquired (no acquire, no run)", async () => {
    // Fresh workspace: gov.tx.tcole has no acquire pointer. There is no
    // <source-id>/source/ fallback, so the run must refuse rather than silently
    // find nothing.
    let importCalled = false;
    const result = await runIntake(["run", "gov.tx.tcole", "--dry-run"], {
      runImportArtifactsCommand: async (): Promise<CommandResult> => {
        importCalled = true;
        return { exitCode: 0 };
      },
    });

    expect(result.exitCode).toBe(1);
    expect(importCalled).toBe(false);
    expect(result.stderr ?? "").toMatch(
      /gov\.tx\.tcole has no acquired input.*intake acquire gov\.tx\.tcole/s,
    );
  });
});
