import { afterEach, describe, it, expect, expectTypeOf } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  loadSourceModule,
  loadSourceAcquire,
  loadSourceProduces,
} from "../../../src/cli/transform/load-source-module.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { IntakeSource } from "../../../src/cli/intake-source.js";
import type { SourceTransform } from "../../../src/cli/transform/source-transform.js";

const sourcesRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/sources",
);

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

async function writeTransformSource(
  id: string,
  properties: string,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "produces-"));
  tempRoots.push(root);
  await mkdir(path.join(root, id), { recursive: true });
  await writeFile(
    path.join(root, id, "intake.source.ts"),
    `export const source = { transform() {}, ${properties} };`,
  );
  return root;
}

describe("loadSourceModule", () => {
  it("loads a module exporting transform", async () => {
    const transform = await loadSourceModule("ok-source", sourcesRoot);
    expect(typeof transform).toBe("function");
  });

  it("requires a marker for a directly selected phase module", async () => {
    const id = "org/example/roster";
    const root = await writeTransformSource(id, "");
    expect(typeof (await loadSourceModule(id, root))).toBe("function");
    await rm(path.join(root, id, "intake.source.ts"));
    await expect(loadSourceModule(id, root)).rejects.toThrow(
      /intake.source.ts/,
    );
  });
  it("fails clearly for an unknown source id", async () => {
    await expect(loadSourceModule("missing", sourcesRoot)).rejects.toThrow(
      /missing/,
    );
  });

  it("fails when the module has no transform export", async () => {
    await expect(loadSourceModule("no-transform", sourcesRoot)).rejects.toThrow(
      /transform/,
    );
  });

  it("rejects a source id containing path traversal", async () => {
    await expect(loadSourceModule("../evil", sourcesRoot)).rejects.toThrow(
      /invalid source id/i,
    );
  });
});

describe("loadSourceAcquire", () => {
  it("loads a module exporting acquire", async () => {
    const acquire = await loadSourceAcquire("acquire-source", sourcesRoot);
    expect(typeof acquire).toBe("function");
  });

  it("fails when the source does not export acquire", async () => {
    await expect(loadSourceAcquire("ok-source", sourcesRoot)).rejects.toThrow(
      /does not support acquire/,
    );
  });

  it("fails clearly for an unknown source id", async () => {
    await expect(loadSourceAcquire("missing", sourcesRoot)).rejects.toThrow(
      /missing/,
    );
  });
});

describe("loadSourceProduces", () => {
  it("requires each transform to declare its output kinds in the source contract", () => {
    expectTypeOf<{
      transform: SourceTransform;
    }>().not.toMatchTypeOf<IntakeSource>();
    expectTypeOf<{
      transform: SourceTransform;
      produces: [];
    }>().toMatchTypeOf<IntakeSource>();
  });
  it("returns the declared produces kinds", async () => {
    const root = await writeTransformSource(
      "s",
      'produces: ["Agencies", "Personnel"]',
    );
    await expect(loadSourceProduces("s", root)).resolves.toEqual([
      "Agencies",
      "Personnel",
    ]);
  });

  it("fails when produces is missing", async () => {
    const root = await writeTransformSource("s", "");
    await expect(loadSourceProduces("s", root)).rejects.toThrow(/produces/);
  });

  it("allows an empty produces (a disabled/no-op source)", async () => {
    const root = await writeTransformSource("s", "produces: []");
    await expect(loadSourceProduces("s", root)).resolves.toEqual([]);
  });

  it("fails when produces names an unknown kind", async () => {
    const root = await writeTransformSource(
      "s",
      'produces: ["Agencies", "Nonsense"]',
    );
    await expect(loadSourceProduces("s", root)).rejects.toThrow(
      /unknown kind: Nonsense/,
    );
  });
});
