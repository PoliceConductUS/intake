import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import {
  acquireFromLocal,
  resolveLocalInputs,
} from "../../../src/cli/acquire/acquire-from-local.js";
import { readCommandPointer } from "../../../src/cli/state/command-pointer.js";
import { parse as parseYaml } from "yaml";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// Mirrors the real command layout: command/<id>/<namespace>/output.
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

describe("resolveLocalInputs", () => {
  it("resolves a single file to its basename", async () => {
    const dir = await tempDir("from-local-file-");
    await writeFile(path.join(dir, "roster.xlsx"), "x");
    const items = await resolveLocalInputs(["roster.xlsx"], dir);
    expect(items).toEqual([
      {
        source: path.join(dir, "roster.xlsx"),
        destinationRelative: "roster.xlsx",
      },
    ]);
  });

  it("resolves a folder to its files, preserving structure and skipping dotfiles", async () => {
    const dir = await tempDir("from-local-folder-");
    await mkdir(path.join(dir, "in", "nested"), { recursive: true });
    await writeFile(path.join(dir, "in", "a.json"), "a");
    await writeFile(path.join(dir, "in", "nested", "b.json"), "b");
    await writeFile(path.join(dir, "in", ".DS_Store"), "junk");
    const items = await resolveLocalInputs(["in"], dir);
    expect(items.map((item) => item.destinationRelative).sort()).toEqual([
      "a.json",
      path.join("nested", "b.json"),
    ]);
  });

  it("expands a glob to matching files by basename", async () => {
    const dir = await tempDir("from-local-glob-");
    await writeFile(path.join(dir, "one.csv"), "1");
    await writeFile(path.join(dir, "two.csv"), "2");
    await writeFile(path.join(dir, "skip.txt"), "3");
    const items = await resolveLocalInputs(["*.csv"], dir);
    expect(items.map((item) => item.destinationRelative).sort()).toEqual([
      "one.csv",
      "two.csv",
    ]);
  });

  it("fails loud when an argument matches nothing", async () => {
    const dir = await tempDir("from-local-none-");
    await expect(resolveLocalInputs(["missing-*.csv"], dir)).rejects.toThrow(
      /matched no file, folder, or glob/,
    );
  });

  it("fails loud on a destination-name collision", async () => {
    const dir = await tempDir("from-local-collide-");
    await mkdir(path.join(dir, "a"), { recursive: true });
    await mkdir(path.join(dir, "b"), { recursive: true });
    await writeFile(path.join(dir, "a", "same.json"), "a");
    await writeFile(path.join(dir, "b", "same.json"), "b");
    await expect(
      resolveLocalInputs(
        [path.join("a", "same.json"), path.join("b", "same.json")],
        dir,
      ),
    ).rejects.toThrow(/collide on destination name: same\.json/);
  });
});

describe("acquireFromLocal", () => {
  it("copies inputs into the command output and points the acquire pointer at it", async () => {
    const workspace = await tempDir("from-local-ws-");
    const inputs = await tempDir("from-local-src-");
    await writeFile(path.join(inputs, "PublicInfo.xlsx"), "workbook-bytes");
    const state = path.join(workspace, "state", "gov.tx.tcole");

    const messages: string[] = [];
    await acquireFromLocal("gov.tx.tcole", ["PublicInfo.xlsx"], {
      env: { INTAKE_WORKSPACE: workspace },
      workspace,
      state,
      cwd: inputs,
      createCommandDirectory: fakeCreateCommandDirectory("2026-08-25-abc"),
      // real pointer writer
      writeCommandPointer: (
        await import("../../../src/cli/state/command-pointer.js")
      ).writeCommandPointer,
      logger: { info: (m) => messages.push(m) },
    });

    // File landed in command/<id>/<source>/output/, byte-identical.
    const copied = await readFile(
      path.join(
        workspace,
        "command",
        "2026-08-25-abc",
        "gov.tx.tcole",
        "output",
        "PublicInfo.xlsx",
      ),
      "utf8",
    );
    expect(copied).toBe("workbook-bytes");

    // The acquire pointer resolves to that output dir — exactly what the run reads.
    const pointer = await readCommandPointer(state, "acquire");
    expect(pointer.latest).toBe(
      path.join("command", "2026-08-25-abc", "gov.tx.tcole", "output"),
    );

    // The pointer file is valid YAML with the latest key.
    const raw = parseYaml(
      await readFile(path.join(state, "acquire.yaml"), "utf8"),
    );
    expect(raw.latest).toBe(pointer.latest);
    expect(messages.some((m) => /staged 1 local input file/.test(m))).toBe(
      true,
    );
  });
});
