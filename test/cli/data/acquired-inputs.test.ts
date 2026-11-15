import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { Command } from "../../../src/shared/io/Command.js";
import { writeCommandPointer } from "../../../src/cli/state/command-pointer.js";
import { retainedAcquiredInputs } from "../../../src/cli/data/acquired-inputs.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "acquire-history-"));
  roots.push(root);
  const names = [
    "2026-01-03T00-00-00-000Z-new",
    "2026-01-01T00-00-00-000Z-old",
    "2026-01-02T00-00-00-000Z-pruned",
    "2026-01-04T00-00-00-000Z-later",
    "2026-01-02T01-00-00-000Z-interrupted",
  ];
  for (const name of names) {
    const dir = path.join(root, "command", name);
    await Command.write(
      dir,
      Command.new({
        metadata: { namespace: "org/example", name },
        spec: {
          args: ["acquire", "org/example"],
          statePath: "../../state",
          path: ".",
          sharedIoRoot: "io",
        },
      }),
    );
    if (!name.endsWith("pruned"))
      await mkdir(path.join(dir, "org/example", "output"), { recursive: true });
    if (!name.endsWith("pruned") && !name.endsWith("interrupted"))
      await writeFile(path.join(dir, "org/example/acquire-complete"), "");
  }
  const latest = `command/${names[0]}/org/example/output`;
  await writeCommandPointer(
    path.join(root, "state", "org/example"),
    "acquire",
    {
      latest,
    },
  );
  return {
    root,
    latest,
    old: `command/${names[1]}/org/example/output`,
    later: `command/${names[3]}/org/example/output`,
  };
}
it("orders all completed acquisitions, including empty output and successes after latest, and excludes partial runs", async () => {
  const f = await fixture();
  expect(await retainedAcquiredInputs(f.root, "org/example")).toEqual([
    f.old,
    f.latest,
    f.later,
  ]);
});
it("fails if the latest completed output is missing", async () => {
  const f = await fixture();
  await rm(path.join(f.root, f.latest), { recursive: true });
  await expect(retainedAcquiredInputs(f.root, "org/example")).rejects.toThrow(
    /latest.*missing/i,
  );
});
it("fails if no completed acquisition is recorded", async () => {
  const f = await fixture();
  await expect(retainedAcquiredInputs(f.root, "absent")).rejects.toThrow(
    /no completed acquisition/i,
  );
});

it("finds completed acquisitions without a latest pointer", async () => {
  const f = await fixture();
  await rm(path.join(f.root, "state/org/example/acquire.yaml"));
  expect(await retainedAcquiredInputs(f.root, "org/example")).toEqual([
    f.old,
    f.latest,
    f.later,
  ]);
});
