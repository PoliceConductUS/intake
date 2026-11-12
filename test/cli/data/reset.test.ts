import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { resetData } from "../../../src/cli/data/reset.js";

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixture() {
  const workspace = await mkdtemp(path.join(tmpdir(), "data-reset-"));
  workspaces.push(workspace);
  const chain = path.join(workspace, "data", "mutations");
  await mkdir(chain, { recursive: true });
  await writeFile(path.join(chain, "old.txt"), "old generated data");
  const state = path.join(workspace, "intake", "state");
  await mkdir(state, { recursive: true });
  await writeFile(
    path.join(state, "keep.txt"),
    "identity, slug, and manual state",
  );
  const calls: string[] = [];
  const deps = {
    env: {
      INTAKE_WORKSPACE: workspace,
      DATABASE_URL: "postgresql://localhost/test",
    },
    logger: { info: vi.fn() },
    orderedSourceIds: async () => ["places", "agencies"],
    acquiredInputs: async (_source: string): Promise<string[] | null> => null,
    sourceProduces: async (_source: string): Promise<"LocationPaths"[]> => [],
    resetDatabase: vi.fn(async () => {
      calls.push("schema reset");
      expect(await readFile(path.join(chain, "old.txt"), "utf8")).toBe(
        "old generated data",
      );
    }),
    runDataCommand: vi.fn(
      async (
        args: readonly string[],
        _context?: {
          useInitialAgencyRoots: boolean;
          finalizeMutations?: unknown;
        },
      ) => {
        calls.push(args.join(" "));
        expect(await readdir(chain).catch(() => [])).toEqual([]);
        return { exitCode: 0 };
      },
    ),
  };
  return { workspace, chain, state, calls, deps };
}

test("no-acquire rebuilds in dependency order, applies manual records, and retains inputs and state", async () => {
  const f = await fixture();
  const result = await resetData({ acquire: false }, f.deps);
  expect(result.exitCode).toBe(0);
  expect(
    f.deps.runDataCommand.mock.calls
      .filter(([args]) => args[1] === "generate")
      .every(([, context]) => context?.useInitialAgencyRoots === true),
  ).toBe(true);
  expect(f.calls).toEqual([
    "schema reset",
    "data transform places",
    "data generate places",
    "data up",
    "data transform agencies",
    "data generate agencies",
    "data up",
    "data transform org.policeconduct.manual",
    "data generate org.policeconduct.manual",
    "data up",
  ]);
  expect(await readFile(path.join(f.state, "keep.txt"), "utf8")).toBe(
    "identity, slug, and manual state",
  );
  const [command] = await readdir(path.join(f.workspace, "command"));
  expect(
    await readFile(
      path.join(
        f.workspace,
        "command",
        command!,
        "intake",
        "output",
        "previous-mutations",
        "old.txt",
      ),
      "utf8",
    ),
  ).toBe("old generated data");
});

test("default reset acquires automatic sources but never starts a manual interview", async () => {
  const f = await fixture();
  expect((await resetData({ acquire: true }, f.deps)).exitCode).toBe(0);
  expect(f.calls.filter((call) => call.startsWith("data acquire"))).toEqual([
    "data acquire places",
    "data acquire agencies",
  ]);
  expect(f.calls.indexOf("data acquire agencies")).toBeGreaterThan(
    f.calls.indexOf("data up"),
  );
});

test("applies manual geography after the location producer and before agencies", async () => {
  const f = await fixture();
  const deps = {
    ...f.deps,
    sourceProduces: async (source: string): Promise<"LocationPaths"[]> =>
      source === "places" ? ["LocationPaths"] : [],
    prepareManualLocations: async () => {
      f.calls.push("manual geography");
      return { exitCode: 0 };
    },
  };
  expect((await resetData({ acquire: false }, deps)).exitCode).toBe(0);
  expect(f.calls.slice(1, 10)).toEqual([
    "data transform places",
    "data generate places",
    "data up",
    "manual geography",
    "data generate org.policeconduct.manual",
    "data up",
    "data transform agencies",
    "data generate agencies",
    "data up",
  ]);
});

test("generation failure stops the rebuild instead of replaying old mutations", async () => {
  const f = await fixture();
  f.deps.runDataCommand.mockImplementation(async (args) => {
    f.calls.push(args.join(" "));
    return args.join(" ") === "data generate agencies"
      ? { exitCode: 1, stderr: "no place boundary contains the address" }
      : { exitCode: 0 };
  });
  const result = await resetData({ acquire: false }, f.deps);
  expect(result).toMatchObject({
    exitCode: 1,
    stderr: expect.stringContaining("data generate agencies"),
  });
  expect(result.stderr).toContain("no place boundary contains the address");
  expect(result.stderr).toContain("incomplete");
  expect(f.calls.at(-1)).toBe("data generate agencies");
});

test("schema failure retains the active chain and does not start sources", async () => {
  const f = await fixture();
  f.deps.resetDatabase.mockRejectedValue(new Error("schema reset failed"));
  expect((await resetData({ acquire: false }, f.deps)).exitCode).toBe(1);
  expect(f.deps.runDataCommand).not.toHaveBeenCalled();
  expect(await readFile(path.join(f.chain, "old.txt"), "utf8")).toBe(
    "old generated data",
  );
});

test("replays retained snapshots oldest first, retaining older-only rows and restoring the pointer", async () => {
  const f = await fixture();
  const { writeCommandPointer, readCommandPointer } =
    await import("../../../src/cli/state/command-pointer.js");
  const state = path.join(f.workspace, "state", "agencies");
  await writeCommandPointer(state, "acquire", { latest: "newer" });
  const rows = new Map<string, string>();
  const selected: string[] = [];
  const result = await resetData(
    { acquire: false },
    {
      ...f.deps,
      orderedSourceIds: async () => ["agencies"],
      acquiredInputs: async (source: string) =>
        source === "agencies" ? ["older", "newer"] : null,
      runDataCommand: async (args: readonly string[]) => {
        if (args[1] === "transform" && args[2] === "agencies") {
          const { latest } = await readCommandPointer(state, "acquire");
          selected.push(latest!);
          if (latest === "older") rows.set("older-only", "retained");
          rows.set("shared", latest!);
        }
        return { exitCode: 0 };
      },
    },
  );
  expect(result.exitCode).toBe(0);
  expect(selected).toEqual(["older", "newer"]);
  expect([...rows]).toEqual([
    ["older-only", "retained"],
    ["shared", "newer"],
  ]);
  expect(await readCommandPointer(state, "acquire")).toMatchObject({
    latest: "newer",
  });
});

test("restores the acquisition pointer and stops when an older snapshot fails", async () => {
  const f = await fixture();
  const { writeCommandPointer, readCommandPointer } =
    await import("../../../src/cli/state/command-pointer.js");
  const state = path.join(f.workspace, "state", "agencies");
  await writeCommandPointer(state, "acquire", { latest: "newer" });
  const result = await resetData(
    { acquire: false },
    {
      ...f.deps,
      orderedSourceIds: async () => ["agencies"],
      acquiredInputs: async () => ["older", "newer"],
      runDataCommand: async () => ({
        exitCode: 1,
        stderr: "older snapshot failed",
      }),
    },
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("older snapshot failed");
  expect(await readCommandPointer(state, "acquire")).toMatchObject({
    latest: "newer",
  });
});
