import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { runIntake } from "../../../src/cli/index.js";
import { writeCommandPointer } from "../../../src/cli/state/command-pointer.js";
import {
  sourceHasAcquiredInput,
  transformOneSource,
} from "../../../src/cli/data/source-pipeline.js";

vi.mock("../../../src/cli/data/source-pipeline.js", async (original) => ({
  ...(await original<
    typeof import("../../../src/cli/data/source-pipeline.js")
  >()),
  orderedSourceIds: vi.fn(async () => ["a/acquired", "b/unacquired", "c/ok"]),
  transformOneSource: vi.fn(),
}));

const dirs: string[] = [];
const savedWorkspace = process.env.INTAKE_WORKSPACE;
afterEach(async () => {
  vi.clearAllMocks();
  if (savedWorkspace === undefined) delete process.env.INTAKE_WORKSPACE;
  else process.env.INTAKE_WORKSPACE = savedWorkspace;
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function workspaceWithAcquired(sources: string[]): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), "transform-all-"));
  dirs.push(workspace);
  for (const source of sources) {
    await writeCommandPointer(
      path.join(workspace, "state", source),
      "acquire",
      { latest: `command/x/${source}/output` },
    );
  }
  return workspace;
}

test("a source is acquired only when its acquire pointer names a latest output", async () => {
  const workspace = await workspaceWithAcquired(["a/acquired"]);
  const env = { INTAKE_WORKSPACE: workspace };
  expect(await sourceHasAcquiredInput("a/acquired", env)).toBe(true);
  expect(await sourceHasAcquiredInput("b/unacquired", env)).toBe(false);
});

test("data transform with no source skips only unacquired sources and exits 1 on a thrown failure", async () => {
  process.env.INTAKE_WORKSPACE = await workspaceWithAcquired([
    "a/acquired",
    "c/ok",
  ]);
  vi.mocked(transformOneSource).mockImplementation(async (id) => {
    if (id === "a/acquired") throw new Error("database is unreachable");
    return { artifactsPath: `/artifacts/${id}` };
  });

  const result = await runIntake(["data", "transform"]);

  expect(vi.mocked(transformOneSource).mock.calls.map(([id]) => id)).toEqual([
    "a/acquired",
    "c/ok",
  ]);
  expect(result).toEqual({
    exitCode: 1,
    stderr:
      "data: transformed 1 source(s):\n  + c/ok\n" +
      "skipped: b/unacquired (no acquired input)\n" +
      "errored: a/acquired (database is unreachable)\n",
  });
});
