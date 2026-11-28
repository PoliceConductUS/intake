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
import { readLogRecords, wasLogOpen } from "../command-log.js";

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

const silent = { info: () => {} };

describe("resolveLocalInputs", () => {
  it("resolves a single file to its basename", async () => {
    const dir = await tempDir("from-local-file-");
    await writeFile(path.join(dir, "roster.xlsx"), "x");
    const items = await resolveLocalInputs(["roster.xlsx"], dir, silent);
    expect(items).toEqual([
      {
        source: path.join(dir, "roster.xlsx"),
        destinationRelative: "roster.xlsx",
      },
    ]);
  });

  it("resolves a folder to its files, preserving structure and logging each dotfile left out", async () => {
    const dir = await tempDir("from-local-folder-");
    await mkdir(path.join(dir, "in", "nested"), { recursive: true });
    await mkdir(path.join(dir, "in", ".cache"));
    await writeFile(path.join(dir, "in", "a.json"), "a");
    await writeFile(path.join(dir, "in", "nested", "b.json"), "b");
    await writeFile(path.join(dir, "in", ".DS_Store"), "junk");
    await writeFile(path.join(dir, "in", "nested", ".hidden.json"), "h");
    await writeFile(path.join(dir, "in", ".cache", "inside.json"), "i");
    const messages: string[] = [];
    const items = await resolveLocalInputs(["in"], dir, {
      info: (message) => messages.push(message),
    });
    expect(items.map((item) => item.destinationRelative).sort()).toEqual([
      "a.json",
      path.join("nested", "b.json"),
    ]);
    expect(messages.sort()).toEqual([
      `--from-local: left out dotfile ${path.join(dir, "in", ".DS_Store")}`,
      `--from-local: left out dotfile ${path.join(dir, "in", ".cache")}`,
      `--from-local: left out dotfile ${path.join(dir, "in", "nested", ".hidden.json")}`,
    ]);
  });

  it("expands a glob to matching files by basename", async () => {
    const dir = await tempDir("from-local-glob-");
    await writeFile(path.join(dir, "one.csv"), "1");
    await writeFile(path.join(dir, "two.csv"), "2");
    await writeFile(path.join(dir, "skip.txt"), "3");
    const items = await resolveLocalInputs(["*.csv"], dir, silent);
    expect(items.map((item) => item.destinationRelative).sort()).toEqual([
      "one.csv",
      "two.csv",
    ]);
  });

  it("fails loud with a plain 'no such file' message for a non-glob path typo", async () => {
    const dir = await tempDir("from-local-typo-");
    await expect(
      resolveLocalInputs(["roster.xls"], dir, silent),
    ).rejects.toThrow(/no such file or folder: roster\.xls/);
  });

  it("fails loud when a glob matches nothing", async () => {
    const dir = await tempDir("from-local-none-");
    await expect(
      resolveLocalInputs(["missing-*.csv"], dir, silent),
    ).rejects.toThrow(/glob matched nothing/);
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
        silent,
      ),
    ).rejects.toThrow(/collide on destination name: same\.json/);
  });
});

describe("acquireFromLocal", () => {
  it("runs required acquisition on staged inputs and preserves failed work without promotion", async () => {
    const workspace = await tempDir("local-acquire-failed-");
    const inputs = await tempDir("local-acquire-input-");
    await writeFile(path.join(inputs, "cached.pdf"), "cached");
    const state = path.join(workspace, "state", "test");
    const { writeCommandPointer } =
      await import("../../../src/cli/state/command-pointer.js");
    await writeCommandPointer(state, "acquire", { latest: "previous" });
    const printed: string[] = [];
    await expect(
      acquireFromLocal("test", ["cached.pdf"], {
        env: { INTAKE_WORKSPACE: workspace },
        workspace,
        state,
        cwd: inputs,
        createCommandDirectory: fakeCreateCommandDirectory("failed"),
        writeCommandPointer,
        terminal: { write: (text) => printed.push(text) },
        acquire: async ({ sourceDir, logger }) => {
          logger?.info("analysing cached.pdf");
          expect(
            await readFile(path.join(sourceDir, "cached.pdf"), "utf8"),
          ).toBe("cached");
          throw new Error("analysis incomplete");
        },
        data: { agencies: async () => ({ items: [] }) },
      }),
    ).rejects.toThrow("analysis incomplete");
    await expect(
      readFile(path.join(workspace, "command/failed/test/acquire-complete")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readCommandPointer(state, "acquire")).toEqual({
      latest: "previous",
      resume: path.join("command", "failed", "test", "output"),
    });
    expect(printed).toEqual(["analysing cached.pdf\n"]);
    const records = await readLogRecords(
      path.join(workspace, "command/failed/failed.log"),
    );
    expect(records.map((record) => record.msg)).toEqual([
      "analysing cached.pdf",
      undefined,
    ]);
    expect(records.at(-1)).toMatchObject({
      level: 50,
      error: {
        message: "analysis incomplete",
        stack: expect.stringContaining("Error: analysis incomplete\n    at "),
      },
    });
    expect(
      await wasLogOpen(path.join(workspace, "command/failed/failed.log")),
    ).toBe(false);
  });

  it("copies inputs into the command output and points the acquire pointer at it", async () => {
    const workspace = await tempDir("from-local-ws-");
    const inputs = await tempDir("from-local-src-");
    await writeFile(path.join(inputs, "PublicInfo.xlsx"), "workbook-bytes");
    const state = path.join(workspace, "state", "gov/texas/tcole");

    const printed: string[] = [];
    await acquireFromLocal("gov/texas/tcole", ["PublicInfo.xlsx"], {
      env: { INTAKE_WORKSPACE: workspace },
      workspace,
      state,
      cwd: inputs,
      createCommandDirectory: fakeCreateCommandDirectory("2026-08-25-abc"),
      acquire: undefined,
      data: { agencies: async () => ({ items: [] }) },
      // real pointer writer
      writeCommandPointer: (
        await import("../../../src/cli/state/command-pointer.js")
      ).writeCommandPointer,
      terminal: { write: (text) => printed.push(text) },
    });

    // File landed in command/<id>/<source>/output/, byte-identical.
    const copied = await readFile(
      path.join(
        workspace,
        "command",
        "2026-08-25-abc",
        "gov/texas/tcole",
        "output",
        "PublicInfo.xlsx",
      ),
      "utf8",
    );
    expect(copied).toBe("workbook-bytes");

    // The acquire pointer resolves to that output dir — exactly what the run reads.
    const pointer = await readCommandPointer(state, "acquire");
    expect(pointer.latest).toBe(
      path.join("command", "2026-08-25-abc", "gov/texas/tcole", "output"),
    );

    expect(
      await readFile(
        path.join(workspace, pointer.latest!, "../acquire-complete"),
        "utf8",
      ),
    ).toBe("");
    // The pointer file is valid YAML with the latest key.
    const raw = parseYaml(
      await readFile(path.join(state, "acquire.yaml"), "utf8"),
    );
    expect(raw.latest).toBe(pointer.latest);
    const staged = `gov/texas/tcole: staged 1 local input file(s) at ${path.join("command", "2026-08-25-abc", "gov/texas/tcole", "output")}`;
    expect(printed).toEqual([`${staged}\n`]);
    expect(
      (
        await readLogRecords(
          path.join(workspace, "command/2026-08-25-abc/2026-08-25-abc.log"),
        )
      ).map((record) => record.msg),
    ).toEqual([staged]);
    expect(
      await wasLogOpen(
        path.join(workspace, "command/2026-08-25-abc/2026-08-25-abc.log"),
      ),
    ).toBe(false);
  });
});
