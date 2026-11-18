import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runIntake } from "../../../src/cli/index.js";
import { orderedSourceIds } from "../../../src/cli/data/source-pipeline.js";

// The data pipeline's transform/order behavior through the real CLI. Replaces the
// old `intake run` integration test: `run` is gone, split into `data transform`
// (produce) and `data generate` (diff → chain).
describe("data transform / source ordering", () => {
  let workspace: string;
  let previousWorkspace: string | undefined;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "intake-transform-"));
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

  it("excludes a disabled source (produces nothing) from the update order", async () => {
    // gov/az/post/roster is disabled (produces is empty), so planSourceOrder drops
    // it — `data update` never transforms it. Re-enable and rewrite once it
    // produces Agency + AgencyPersonnel (see gov/az/post/roster/transform.ts).
    const order = await orderedSourceIds();
    expect(order).not.toContain("gov/az/post/roster");
  });

  it("fails loud when a source has not been acquired", async () => {
    // Fresh workspace: gov/texas/tcole has no acquire pointer, and there is no
    // <source-id>/source/ fallback — so transform must refuse rather than silently
    // find nothing.
    const result = await runIntake(["data", "transform", "gov/texas/tcole"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr ?? "").toMatch(
      /gov\/texas\/tcole has no acquired input.*intake data acquire gov\/texas\/tcole/s,
    );
  });

  it("fails every-source transform on a missing workspace instead of skipping each source", async () => {
    const missing = path.join(workspace, "absent");
    process.env.INTAKE_WORKSPACE = missing;

    const result = await runIntake(["data", "transform"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr ?? "").toContain(
      `INTAKE_WORKSPACE ${missing} is not an existing folder.`,
    );
    expect(result.stderr ?? "").not.toContain("skipped");
  });
});
