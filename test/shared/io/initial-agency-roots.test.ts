import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import * as io from "../../../src/shared/io/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "initial-agency-roots-"));
  roots.push(root);
  return root;
}
const input = {
  metadata: {
    name: "initial" as const,
    namespace: "source.one",
    annotations: { sitemap: "https://example.test/sitemap.xml" },
  },
  spec: { agencySourceNames: ["123", "456"] },
};

test("canonical IO persists namespace roots in intake-owned state and does not leak to another namespace", async () => {
  const root = await workspace();
  const envelope = io.InitialAgencyRoots.new(input);
  const result = await io.InitialAgencyRoots.write(
    io.initialAgencyRootsDirectory(root, "source.one"),
    envelope,
  );
  expect(result.path).toBe(
    path.join(
      root,
      "intake/state/namespaces/source.one/InitialAgencyRoots/initial.InitialAgencyRoots.yaml",
    ),
  );
  expect(await io.loadInitialAgencyRoots(root, "source.one")).toEqual(envelope);
  expect(await io.loadInitialAgencyRoots(root, "source.two")).toBeUndefined();
});

test.each([
  { apiVersion: "wrong" },
  { kind: "Agency" },
  { extra: true },
  { metadata: { ...input.metadata, extra: true } },
  { metadata: { name: "different", namespace: "source.one" } },
  { metadata: { name: "initial" } },
  { spec: { agencySourceNames: [] } },
  { spec: { agencySourceNames: [" "] } },
  { spec: { agencySourceNames: ["123", "123"] } },
  { spec: { ...input.spec, extra: true } },
])(
  "rejects malformed initial roots at constructor, write, and read boundaries: %j",
  async (change) => {
    const root = await workspace();
    const valid = io.InitialAgencyRoots.new(input);
    const malformed = { ...valid, ...change };
    expect(() => io.InitialAgencyRoots.new(malformed as typeof input)).toThrow(
      /InitialAgencyRoots is malformed/,
    );
    await expect(
      io.InitialAgencyRoots.write(root, malformed as typeof valid),
    ).rejects.toThrow(/InitialAgencyRoots is malformed/);
    const file = path.join(root, "malformed.yaml");
    // JSON is valid YAML; malformed fixtures deliberately bypass canonical writes.
    await writeFile(file, JSON.stringify(malformed));
    await expect(io.InitialAgencyRoots.read(file)).rejects.toThrow(
      /InitialAgencyRoots is malformed/,
    );
  },
);

test("loading an existing malformed or wrong-namespace root envelope fails", async () => {
  const root = await workspace();
  const { path: file } = await io.InitialAgencyRoots.write(
    io.initialAgencyRootsDirectory(root, "source.one"),
    io.InitialAgencyRoots.new(input),
  );
  const contents = await readFile(file, "utf8");
  await writeFile(file, contents.replace("source.one", "source.two"));
  await expect(io.loadInitialAgencyRoots(root, "source.one")).rejects.toThrow(
    /namespace/,
  );
  await writeFile(file, "not: an envelope");
  await expect(io.loadInitialAgencyRoots(root, "source.one")).rejects.toThrow(
    /malformed/,
  );
});
