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
    resetDatabase: vi.fn(async () => {
      calls.push("schema reset");
      expect(await readFile(path.join(chain, "old.txt"), "utf8")).toBe(
        "old generated data",
      );
    }),
    runDataCommand: vi.fn(async (args: readonly string[]) => {
      calls.push(args.join(" "));
      expect(await readdir(chain).catch(() => [])).toEqual([]);
      return { exitCode: 0 };
    }),
  };
  return { workspace, chain, state, calls, deps };
}

test("no-acquire rebuilds in dependency order, applies manual records, and retains inputs and state", async () => {
  const f = await fixture();
  const result = await resetData({ acquire: false }, f.deps);
  expect(result.exitCode).toBe(0);
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

test("applies manual geography after Census and before agencies", async () => {
  const f = await fixture();
  const deps = {
    ...f.deps,
    orderedSourceIds: async () => ["us-census-gazetteer", "agencies"],
    prepareManualLocations: async () => {
      f.calls.push("manual geography");
      return { exitCode: 0 };
    },
  };
  expect((await resetData({ acquire: false }, deps)).exitCode).toBe(0);
  expect(f.calls.slice(1, 10)).toEqual([
    "data transform us-census-gazetteer",
    "data generate us-census-gazetteer",
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
