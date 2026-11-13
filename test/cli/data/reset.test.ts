import { createHash } from "node:crypto";
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
import { readDocumentEvidence } from "../../../sources/mn-post/acquire/document-evidence.js";
import {
  readCommandPointer,
  writeCommandPointer,
} from "../../../src/cli/state/command-pointer.js";

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

test("replays retained snapshots oldest first, retaining older-only rows and restoring the pointer", async () => {
  const f = await fixture();
  const state = path.join(f.workspace, "state", "agencies");
  await writeCommandPointer(state, "acquire", { latest: "newer" });
  const rows = new Map<string, string>();
  const selected: string[] = [];
  const result = await resetData(
    { acquire: false },
    {
      ...f.deps,
      orderedSourceIds: async () => ["agencies"],
      resetDatabase: async () => {
        rows.clear();
      },
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
  expect(selected).toEqual(["older", "newer", "older", "newer"]);
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

test("rejects stale retained analysis before clearing the database or retiring mutations", async () => {
  const f = await fixture();
  const state = path.join(f.workspace, "state", "mn-post");
  await writeCommandPointer(state, "acquire", {
    latest: "newer",
    resume: "unfinished",
  });
  const pointer = await readFile(path.join(state, "acquire.yaml"), "utf8");
  const document = path.join(f.workspace, "older.document.json");
  const pdf = Buffer.from("pdf");
  await writeFile(path.join(f.workspace, "older.pdf"), pdf);
  await writeFile(
    document,
    JSON.stringify({
      url: "https://example.test/order",
      documentName: "Order",
      actions: [{ contactId: "person", caseNumber: "case" }],
      sha256: createHash("sha256").update(pdf).digest("hex"),
      bytes: pdf.length,
      fetchedAt: "2026-10-18",
      pages: [{ page: 1, method: "text", text: "Board suspended license." }],
      text: "Board suspended license.",
      analysis: {
        allegation: "Basis",
        violation: "Rule",
        finding: "Finding",
        chief_action: "Action",
        sanction: "Sanction",
      },
      absenceReasons: {},
      analyzedWith: { model: "automated", promptVersion: 1 },
    }),
  );
  const result = await resetData(
    { acquire: false },
    {
      ...f.deps,
      orderedSourceIds: async () => ["mn-post"],
      acquiredInputs: async () => ["older", "newer"],
      runDataCommand: async (args) => {
        f.calls.push(args.join(" "));
        if (args[1] === "transform") await readDocumentEvidence(document);
        return { exitCode: 0 };
      },
    },
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("analyzedWith");
  expect(f.calls).toEqual(["data transform mn-post"]);
  expect(await readFile(path.join(f.chain, "old.txt"), "utf8")).toBe(
    "old generated data",
  );
  expect(await readFile(path.join(state, "acquire.yaml"), "utf8")).toBe(
    pointer,
  );
});

test("default reset prepares retained inputs before resetting and acquires new inputs in dependency order", async () => {
  const f = await fixture();
  const state = path.join(f.workspace, "state", "agencies");
  await writeCommandPointer(state, "acquire", { latest: "older" });
  const selected: string[] = [];
  const result = await resetData(
    { acquire: true },
    {
      ...f.deps,
      acquiredInputs: async (source) =>
        source === "agencies"
          ? (await readCommandPointer(state, "acquire")).latest === "older"
            ? ["older"]
            : ["older", "newer"]
          : null,
      runDataCommand: async (args) => {
        f.calls.push(args.join(" "));
        if (args[2] === "agencies") {
          if (args[1] === "acquire")
            await writeCommandPointer(state, "acquire", { latest: "newer" });
          if (args[1] === "transform")
            selected.push((await readCommandPointer(state, "acquire")).latest!);
        }
        return { exitCode: 0 };
      },
    },
  );
  expect(result.exitCode).toBe(0);
  expect(f.calls).toEqual([
    "data transform agencies",
    "schema reset",
    "data acquire places",
    "data transform places",
    "data generate places",
    "data up",
    "data acquire agencies",
    "data transform agencies",
    "data generate agencies",
    "data up",
    "data transform agencies",
    "data generate agencies",
    "data up",
    "data transform org.policeconduct.manual",
    "data generate org.policeconduct.manual",
    "data up",
  ]);
  expect(selected).toEqual(["older", "older", "newer"]);
  expect(await readCommandPointer(state, "acquire")).toMatchObject({
    latest: "newer",
  });
});

test("no-acquire rejects a missing completed acquisition before reset", async () => {
  const f = await fixture();
  const result = await resetData(
    { acquire: false },
    {
      ...f.deps,
      orderedSourceIds: async () => ["mn-post"],
      acquiredInputs: undefined,
    },
  );
  expect(result).toMatchObject({
    exitCode: 1,
    stderr: expect.stringContaining("no completed acquisition"),
  });
  expect(f.calls).toEqual([]);
  expect(await readFile(path.join(f.chain, "old.txt"), "utf8")).toBe(
    "old generated data",
  );
});

test.each([true, false])(
  "rejects a malformed existing acquisition before reset with acquire=%s",
  async (acquire) => {
    const f = await fixture();
    const state = path.join(f.workspace, "state", "mn-post");
    await writeCommandPointer(state, "acquire", { latest: "invalid" });
    const result = await resetData(
      { acquire },
      {
        ...f.deps,
        orderedSourceIds: async () => ["mn-post"],
        acquiredInputs: undefined,
      },
    );
    expect(result).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("invalid acquisition path"),
    });
    expect(f.calls).toEqual([]);
    expect(await readFile(path.join(f.chain, "old.txt"), "utf8")).toBe(
      "old generated data",
    );
    expect(await readCommandPointer(state, "acquire")).toMatchObject({
      latest: "invalid",
    });
  },
);

test("default reset rejects a non-string acquisition pointer before clearing data", async () => {
  const f = await fixture();
  const state = path.join(f.workspace, "state", "agencies");
  await mkdir(state, { recursive: true });
  const pointer = "latest: 123\nresume: unfinished\n";
  await writeFile(path.join(state, "acquire.yaml"), pointer);
  const result = await resetData({ acquire: true }, f.deps);
  expect(result).toMatchObject({
    exitCode: 1,
    stderr: expect.stringContaining("latest"),
  });
  expect(f.calls).toEqual([]);
  expect(await readFile(path.join(f.chain, "old.txt"), "utf8")).toBe(
    "old generated data",
  );
  expect(await readFile(path.join(state, "acquire.yaml"), "utf8")).toBe(
    pointer,
  );
});
