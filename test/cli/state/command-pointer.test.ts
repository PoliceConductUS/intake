import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { readCommandPointer } from "../../../src/cli/state/command-pointer.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(contents?: string) {
  const root = await mkdtemp(path.join(tmpdir(), "command-pointer-"));
  roots.push(root);
  if (contents !== undefined)
    await writeFile(path.join(root, "acquire.yaml"), contents);
  return root;
}

test.each([
  "123\n",
  "false\n",
  "pointer\n",
  "[]\n",
  "- latest\n",
  "latest: 123\n",
  "latest: null\n",
  "resume: false\n",
  "resume: []\n",
  "resume: {}\n",
])("rejects malformed command pointer %j", async (contents) => {
  await expect(
    readCommandPointer(await fixture(contents), "acquire"),
  ).rejects.toThrow();
});

test.each([undefined, "", "null\n", "{}\n"])(
  "accepts an empty command pointer %j",
  async (contents) => {
    expect(
      await readCommandPointer(await fixture(contents), "acquire"),
    ).toEqual({});
  },
);

test("retains valid latest and resume pointers", async () => {
  expect(
    await readCommandPointer(
      await fixture("latest: completed\nresume: unfinished\n"),
      "acquire",
    ),
  ).toEqual({ latest: "completed", resume: "unfinished" });
});
