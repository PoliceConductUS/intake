import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { Artifacts } from "../../../src/shared/io/index.js";
import { completeTransform } from "../../../src/cli/state/transform-completion.js";
import { generateOneSource } from "../../../src/cli/data/source-pipeline.js";
import { runImportArtifactsCommand } from "../../../src/cli/import/artifacts/index.js";
import { generateEntry } from "../../../src/cli/data/chain.js";
vi.mock("../../../src/cli/import/artifacts/index.js", () => ({
  runImportArtifactsCommand: vi.fn(),
}));
vi.mock("../../../src/cli/data/chain.js", () => ({
  generateEntry: vi.fn(async () => ({ mutationCount: 0 })),
}));
it("generation uses this import's explicit mutation output even with older saved mutations", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "current-mutations-"));
  try {
    const { path: artifactsPath } = await Artifacts.write(
      path.join(workspace, "transform"),
      Artifacts.new({
        metadata: { namespace: "test", name: "current" },
        spec: { artifacts: [] },
      }),
    );
    await completeTransform(
      path.join(workspace, "state", "test"),
      artifactsPath,
      null,
    );
    const old = path.join(workspace, "command", "old", "test", "output");
    await mkdir(old, { recursive: true });
    await writeFile(path.join(old, "old.DatabaseMutations.yaml"), "old");
    const current = path.join(workspace, "current.DatabaseMutations.yaml");
    vi.mocked(runImportArtifactsCommand).mockResolvedValue({
      exitCode: 0,
      databaseMutationsPath: current,
    });
    expect(
      await generateOneSource("test", { INTAKE_WORKSPACE_TEST: workspace }),
    ).toEqual({ mutationCount: 0 });
    expect(generateEntry).toHaveBeenCalledWith(current);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
