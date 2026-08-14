import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIntake } from "../../../src/cli/index.js";
import { Artifacts } from "../../../src/shared/io/index.js";
import type { CommandResult } from "../../../src/shared/cli/types.js";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/azpost/officer-list-sample.xlsx",
);

// End-to-end test of `intake run gov.azpost.roster --dry-run` through the real
// CLI entry point (`runIntake`). The workbook is staged in the source's
// namespace input folder ($INTAKE_WORKSPACE/<source-id>/source/); the run
// command discovers it there (no path argument). It exercises the real
// source module discovery, the real xlsx parser, the real Artifacts
// envelope builder, and the real Artifacts writer/reader against a real
// temp workspace. Only the last dependency in the pipeline -
// `runImportArtifactsCommand`, which requires a live database even for
// `--dry-run` because mutation planning reads current DB state - is
// stubbed out. The stub captures the artifacts path it was handed so the
// test can read the envelope back and assert on its contents, proving the
// new parse -> dedup/map -> manifest -> envelope build -> envelope write
// path end-to-end without needing a database.
describe("intake run gov.azpost.roster (dry-run)", () => {
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

  it("writes an Artifacts envelope with Personnel records keyed by POST ID", async () => {
    let capturedArtifactsPath: string | undefined;
    let capturedOptions:
      | { dryImport?: boolean; excludedRecords?: unknown }
      | undefined;
    const runImportArtifactsCommand = async (
      artifactsRef: string,
      dependencies?: { dryImport?: boolean; excludedRecords?: unknown },
    ): Promise<CommandResult> => {
      capturedArtifactsPath = artifactsRef;
      capturedOptions = dependencies;
      return { exitCode: 0 };
    };

    // Stage the workbook in the source's namespace input folder — the run
    // command reads inputs from $INTAKE_WORKSPACE/<source-id>/source/.
    const sourceInputDir = path.join(workspace, "gov.azpost.roster", "source");
    await mkdir(sourceInputDir, { recursive: true });
    await cp(fixture, path.join(sourceInputDir, "officer-list-sample.xlsx"));

    const result = await runIntake(["run", "gov.azpost.roster", "--dry-run"], {
      runImportArtifactsCommand,
    });

    expect(result.exitCode).toBe(0);
    // gov.azpost.roster has no `excluded.yaml`, so the loaded exclusion set
    // is empty; the composition root still threads it through.
    expect(capturedOptions).toEqual({
      dryImport: true,
      excludedRecords: new Map(),
    });
    expect(capturedArtifactsPath).toBeDefined();

    const envelope = await Artifacts.read(capturedArtifactsPath as string);

    expect(envelope.metadata.namespace).toBe("gov.azpost.roster");
    expect(envelope.metadata.name).toMatch(
      /^gov\.azpost\.roster-[0-9a-f]{16}$/,
    );

    expect(envelope.spec.artifacts).toHaveLength(1);
    const personnel = envelope.spec.artifacts[0];
    expect(personnel?.kind).toBe("Personnel");

    // Fixture rows: 1001 once, 1002 duplicated (dedup to one record), and a
    // blank POST ID row that must be skipped for lack of a stable id.
    expect(Object.keys(personnel?.spec.records ?? {}).sort()).toEqual([
      "1001",
      "1002",
    ]);
    expect(personnel?.spec.records["1001"]).toMatchObject({
      id: "1001",
      first_name: "Skip",
      last_name: "Woodward",
      middle_name: "L",
    });
    expect(personnel?.spec.records["1002"]).toMatchObject({
      id: "1002",
      first_name: "Marc",
      last_name: "Denney",
      middle_name: "E",
    });
  });
});
