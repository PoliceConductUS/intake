import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it, expect, vi } from "vitest";
import { acquireSource } from "../../../src/cli/acquire/index.js";
import { loadSourceAcquire } from "../../../src/cli/run/load-source-module.js";
import { parse as parseYaml } from "yaml";

const fixtureSourcesRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/sources",
);

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "intake-acquire-"));
  tempDirs.push(dir);
  return dir;
}

// A createCommandDirectory that mirrors the real command layout under the
// workspace, so the pointer paths the test asserts are workspace-relative.
function fakeCreateCommandDirectory(commandId: string) {
  return async (
    env: Record<string, string | undefined>,
    options: { namespace?: string } = {},
  ) => {
    const commandDirectory = path.join(
      env.INTAKE_WORKSPACE as string,
      "command",
      commandId,
    );
    const outputDirectory = path.join(
      commandDirectory,
      options.namespace ?? "intake",
      "output",
    );
    await mkdir(outputDirectory, { recursive: true });
    return {
      commandDirectory,
      commandName: commandId,
      commandPath: "",
      outputDirectory,
    };
  };
}

function baseDeps(workspace: string, overrides = {}) {
  return {
    sourcesRoot: fixtureSourcesRoot,
    env: { INTAKE_WORKSPACE: workspace },
    workspace,
    state: path.join(workspace, "state", "acquire-source"),
    loadSourceAcquire,
    createCommandDirectory: fakeCreateCommandDirectory("cmd-1"),
    logger: { info: () => {} },
    ...overrides,
  };
}

describe("acquireSource", () => {
  it("writes the source's output under the command and points latest at it", async () => {
    const workspace = await makeWorkspace();
    const result = await acquireSource("acquire-source", baseDeps(workspace));

    expect(result.exitCode).toBe(0);
    const outputRel = "command/cmd-1/acquire-source/output";
    expect(
      JSON.parse(
        await readFile(path.join(workspace, outputRel, "roster.json"), "utf8"),
      ),
    ).toEqual({ acquired: true });

    const pointer = parseYaml(
      await readFile(
        path.join(workspace, "state", "acquire-source", "acquire.yaml"),
        "utf8",
      ),
    );
    expect(pointer).toEqual({ latest: outputRel });
  });

  it("resumes a prior in-progress acquire and reports how to start fresh", async () => {
    const workspace = await makeWorkspace();
    const state = path.join(workspace, "state", "acquire-source");
    const priorOutput = path.join(
      workspace,
      "command",
      "cmd-0",
      "acquire-source",
      "output",
    );
    await mkdir(priorOutput, { recursive: true });
    await writeFile(path.join(priorOutput, "carried.txt"), "kept");
    await mkdir(state, { recursive: true });
    await writeFile(
      path.join(state, "acquire.yaml"),
      "resume: command/cmd-0/acquire-source/output\n",
    );

    const logged: string[] = [];
    const result = await acquireSource(
      "acquire-source",
      baseDeps(workspace, { logger: { info: (m: string) => logged.push(m) } }),
    );

    expect(result.exitCode).toBe(0);
    const outputDir = path.join(
      workspace,
      "command",
      "cmd-1",
      "acquire-source",
      "output",
    );
    expect(await readFile(path.join(outputDir, "carried.txt"), "utf8")).toBe(
      "kept",
    );
    expect(logged.some((m) => /resuming the previous acquire/.test(m))).toBe(
      true,
    );
    expect(logged.some((m) => /start fresh/.test(m))).toBe(true);
  });

  it("returns exit 1 when the source does not support acquire", async () => {
    const workspace = await makeWorkspace();
    const result = await acquireSource(
      "ok-source",
      baseDeps(workspace, {
        state: path.join(workspace, "state", "ok-source"),
      }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/does not support acquire/);
  });

  it("returns exit 1 and surfaces the error when acquire throws", async () => {
    const workspace = await makeWorkspace();
    const result = await acquireSource(
      "boom-source",
      baseDeps(workspace, {
        loadSourceAcquire: vi.fn(async () => async () => {
          throw new Error("network down");
        }),
      }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/network down/);
  });
});
