import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { sourceInputPaths } from "../../../src/cli/transform/index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "source-input-paths-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("lists files at every depth in sorted order", async () => {
  await mkdir(path.join(dir, "nested"));
  await writeFile(path.join(dir, "b.csv"), "b");
  await writeFile(path.join(dir, "nested", "a.csv"), "a");

  expect(await sourceInputPaths(dir)).toEqual([
    path.join(dir, "b.csv"),
    path.join(dir, "nested", "a.csv"),
  ]);
});

test("fails when the input directory cannot be listed", async () => {
  const missing = path.join(dir, "missing");

  await expect(sourceInputPaths(missing)).rejects.toThrow(
    `ENOENT: no such file or directory, scandir '${missing}'`,
  );
});

test("fails on an entry that is neither a file nor a directory", async () => {
  await writeFile(path.join(dir, "real.csv"), "a");
  const link = path.join(dir, "link.csv");
  await symlink(path.join(dir, "real.csv"), link);

  await expect(sourceInputPaths(dir)).rejects.toThrow(
    `Unsupported source input entry: ${link}`,
  );
});
