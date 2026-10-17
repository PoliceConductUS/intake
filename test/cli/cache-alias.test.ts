import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runIntake } from "../../src/cli/index.js";
import { Command } from "../../src/shared/io/Command.js";
import { SourceNameToCanonicalId } from "../../src/cli/state/source-name-to-canonical-id/SourceNameToCanonicalId.js";
import {
  createSourceNameToCanonicalIdLedger,
  resolveSourceNameToCanonicalIdPath,
} from "../../src/cli/state/source-name-to-canonical-id/index.js";

let workspace: string;
beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "cache-alias-"));
  vi.stubEnv("INTAKE_WORKSPACE_TEST", workspace);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(workspace, { recursive: true, force: true });
});
const args = (kind = "Discipline", newName = "official-action") => [
  "cache",
  "alias",
  "test.source",
  kind,
  newName,
  "old-case-label",
  "--evidence",
  "verified-mapping.json#row-1",
];

test.each(["Discipline", "CoverageLink"] as const)(
  "aliases %s with the existing canonical ID, reverse name, and command evidence",
  async (kind) => {
    const ledger = createSourceNameToCanonicalIdLedger({ rootDir: workspace });
    await ledger.findOrCreate(
      "test.source",
      kind,
      "old-case-label",
      async () => "existing-id",
    );
    const result = await runIntake(args(kind));
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout!);
    expect(output).toMatchObject({
      canonicalId: "existing-id",
      reverseSourceName: "official-action",
    });
    const fresh = createSourceNameToCanonicalIdLedger({ rootDir: workspace });
    expect(await fresh.read("test.source", kind, "old-case-label")).toBe(
      "existing-id",
    );
    expect(await fresh.read("test.source", kind, "official-action")).toBe(
      "existing-id",
    );
    expect(await fresh.sourceIdFor("test.source", kind, "existing-id")).toBe(
      "official-action",
    );
    const directories = await readdir(path.join(workspace, "command"));
    expect(directories).toHaveLength(1);
    const commandDir = path.join(workspace, "command", directories[0]);
    const commandFile = (await readdir(commandDir)).find((file) =>
      file.endsWith(".Command.yaml"),
    )!;
    const command = await Command.read(path.join(commandDir, commandFile));
    expect(command.spec.args).toEqual(args(kind));
    const audit = await SourceNameToCanonicalId.read(output.provenancePath);
    expect(audit.spec).toEqual({ kind, canonicalId: "existing-id" });
    expect(audit.metadata).toMatchObject({
      name: "official-action",
      namespace: "test.source",
      annotations: {
        existingSourceName: "old-case-label",
        evidence: "verified-mapping.json#row-1",
        commandId: command.metadata.name,
      },
    });
  },
);

test("rejects a missing original mapping without creating the new mapping", async () => {
  const result = await runIntake(args());
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toMatch(/existing.*mapping.*missing/i);
  const ledger = createSourceNameToCanonicalIdLedger({ rootDir: workspace });
  expect(
    await ledger.read("test.source", "Discipline", "official-action"),
  ).toBeUndefined();
});

test("rejects a new key belonging to a different canonical ID without changing either mapping", async () => {
  const ledger = createSourceNameToCanonicalIdLedger({ rootDir: workspace });
  await ledger.findOrCreate(
    "test.source",
    "Discipline",
    "old-case-label",
    async () => "original-id",
  );
  await ledger.findOrCreate(
    "test.source",
    "Discipline",
    "official-action",
    async () => "different-id",
  );
  const result = await runIntake(args());
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toMatch(/already maps.*different-id/);
  expect(await ledger.read("test.source", "Discipline", "old-case-label")).toBe(
    "original-id",
  );
  expect(
    await ledger.read("test.source", "Discipline", "official-action"),
  ).toBe("different-id");
});

test("replay is a no-op even after another alias became the preferred reverse name", async () => {
  const ledger = createSourceNameToCanonicalIdLedger({ rootDir: workspace });
  await ledger.findOrCreate(
    "test.source",
    "Discipline",
    "old-case-label",
    async () => "existing-id",
  );
  expect((await runIntake(args())).exitCode).toBe(0);
  expect((await runIntake(args("Discipline", "later-name"))).exitCode).toBe(0);
  const result = await runIntake(args());
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout!)).toMatchObject({
    canonicalId: "existing-id",
    reverseSourceName: "later-name",
  });
  const fresh = createSourceNameToCanonicalIdLedger({ rootDir: workspace });
  expect(
    await fresh.sourceIdFor("test.source", "Discipline", "existing-id"),
  ).toBe("later-name");
});

test("replay with forward-only mappings fails without minting a reverse source or writing command output", async () => {
  const directory = path.join(
    resolveSourceNameToCanonicalIdPath("test.source", { rootDir: workspace }),
    "Discipline",
  );
  for (const name of ["old-case-label", "official-action"])
    await SourceNameToCanonicalId.write(
      directory,
      SourceNameToCanonicalId.new({
        metadata: { name, namespace: "test.source" },
        spec: { kind: "Discipline", canonicalId: "existing-id" },
      }),
    );
  const before = (await readdir(directory)).sort();
  const result = await runIntake(args());
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toMatch(/reverse.*mapping.*missing/i);
  expect((await readdir(directory)).sort()).toEqual(before);
  expect(await readdir(workspace)).toEqual(["state"]);
});
