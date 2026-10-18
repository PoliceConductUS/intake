import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { generateOneSource } from "../../../src/cli/data/source-pipeline.js";
import { importArtifacts } from "../../../src/cli/import/artifacts/config.js";
import { Artifacts } from "../../../src/shared/io/index.js";
import { writeCommandPointer } from "../../../src/cli/state/command-pointer.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "completion-"));
  roots.push(root);
  const input = path.join(root, "input");
  await mkdir(input);
  await writeFile(path.join(input, "data.csv"), "x");
  await writeCommandPointer(
    path.join(root, "state", "gov.tx.tcole"),
    "acquire",
    { latest: "input" },
  );
  const written = await Artifacts.write(
    path.join(root, "command", "old", "gov.tx.tcole", "output"),
    Artifacts.new({
      metadata: { name: "old", namespace: "gov.tx.tcole" },
      spec: { artifacts: [] },
    }),
  );
  return {
    root,
    input,
    artifactsPath: written.path,
    env: { INTAKE_WORKSPACE_TEST: root },
  };
}
it("rejects helper-created artifacts before invoking import", async () => {
  const f = await fixture();
  const result = await importArtifacts({
    artifactsPath: f.artifactsPath,
    env: f.env,
    commandName: "reject",
    commandDirectory: path.join(f.root, "mutations"),
    dryImport: true,
  });
  expect(result).toMatchObject({
    ok: false,
    error: expect.stringMatching(/successful transform/i),
  });
  await expect(
    import("node:fs/promises").then((fs) =>
      fs.access(path.join(f.root, "mutations")),
    ),
  ).rejects.toThrow();
});
it("rejects unrecorded transform output instead of selecting by mtime", async () => {
  const f = await fixture();
  const result = await generateOneSource("gov.tx.tcole", f.env);
  expect(result).toHaveProperty(
    "error.stderr",
    expect.stringMatching(/successful transform/i),
  );
});

import {
  beginTransform,
  completeTransform,
  requireTransformCompletion,
  snapshotInput,
} from "../../../src/cli/state/transform-completion.js";
import { transformOneSource } from "../../../src/cli/data/source-pipeline.js";
async function completed() {
  const f = await fixture();
  const state = path.join(f.root, "state", "gov.tx.tcole");
  await completeTransform(
    state,
    f.artifactsPath,
    await snapshotInput(f.root, state, false),
  );
  return { ...f, state };
}
it("accepts the exact completed acquired snapshot and artifacts", async () => {
  const f = await completed();
  expect(await requireTransformCompletion(f.root, "gov.tx.tcole")).toBe(
    f.artifactsPath,
  );
});
it.each(["edit", "add", "rename"])(
  "rejects %s to acquired input",
  async (change) => {
    const f = await completed();
    if (change === "rename")
      await import("node:fs/promises").then((fs) =>
        fs.rename(
          path.join(f.input, "data.csv"),
          path.join(f.input, "renamed.csv"),
        ),
      );
    else
      await writeFile(
        path.join(f.input, change === "edit" ? "data.csv" : "extra.csv"),
        "changed",
      );
    await expect(
      requireTransformCompletion(f.root, "gov.tx.tcole"),
    ).rejects.toThrow(/input changed/i);
  },
);
it("rejects a newly selected acquired snapshot with identical bytes", async () => {
  const f = await completed();
  await mkdir(path.join(f.root, "new"));
  await writeFile(path.join(f.root, "new", "data.csv"), "x");
  await writeCommandPointer(f.state, "acquire", { latest: "new" });
  await expect(
    requireTransformCompletion(f.root, "gov.tx.tcole"),
  ).rejects.toThrow(/input changed/i);
});
it.each(["envelope", "referenced output"])(
  "rejects altered %s bytes",
  async (which) => {
    const f = await completed();
    await writeFile(
      which === "envelope"
        ? f.artifactsPath
        : path.join(path.dirname(f.artifactsPath), "records.yaml"),
      "changed",
    );
    await expect(
      requireTransformCompletion(f.root, "gov.tx.tcole"),
    ).rejects.toThrow(/artifacts changed/i);
  },
);
it("does not fall back after a newer failed transform", async () => {
  const f = await completed();
  await beginTransform(f.state);
  await expect(
    requireTransformCompletion(f.root, "gov.tx.tcole"),
  ).rejects.toThrow(/latest attempt did not complete/i);
});
it("invalidates prior output before source input discovery fails", async () => {
  const f = await completed();
  await writeCommandPointer(f.state, "acquire", {});
  await expect(transformOneSource("gov.tx.tcole", f.env)).rejects.toThrow(
    /no acquired input/,
  );
  await expect(
    requireTransformCompletion(f.root, "gov.tx.tcole"),
  ).rejects.toThrow(/latest attempt did not complete/i);
});
it("accepts explicitly completed standalone output without acquired inputs", async () => {
  const f = await fixture();
  const state = path.join(f.root, "state", "org.policeconduct.manual");
  await completeTransform(state, f.artifactsPath, null);
  expect(
    await requireTransformCompletion(f.root, "org.policeconduct.manual"),
  ).toBe(f.artifactsPath);
});
it("rejects an alternate artifacts file even with identical bytes", async () => {
  const f = await completed();
  const alternate = path.join(f.root, "alternate.yaml");
  await writeFile(
    alternate,
    await import("node:fs/promises").then((fs) => fs.readFile(f.artifactsPath)),
  );
  await expect(
    requireTransformCompletion(f.root, "gov.tx.tcole", alternate),
  ).rejects.toThrow(/do not match/i);
});

import { buildTransformSourceDeps } from "../../../src/cli/transform/index.js";
it("does not stamp a completed acquisition for unrelated consumed paths", async () => {
  const f = await fixture();
  const unrelated = path.join(f.root, "unrelated.csv");
  await writeFile(unrelated, "other");
  const deps = await buildTransformSourceDeps(
    "gov.tx.tcole",
    [unrelated],
    f.env,
    {
      commandArgs: ["data", "transform", "gov.tx.tcole"],
      logger: { info() {} },
    },
  );
  await expect(deps.beginCompletion()).rejects.toThrow(
    /paths must exactly match/i,
  );
  await expect(
    requireTransformCompletion(f.root, "gov.tx.tcole"),
  ).rejects.toThrow(/latest attempt did not complete/i);
});
it("runs the declared manual source without an acquisition snapshot", async () => {
  const f = await fixture();
  const result = await transformOneSource("org.policeconduct.manual", f.env);
  expect(result).toHaveProperty("artifactsPath");
  expect(
    await requireTransformCompletion(f.root, "org.policeconduct.manual"),
  ).toBe((result as { artifactsPath: string }).artifactsPath);
});
