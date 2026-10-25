import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { IdentityRestoration } from "../../../src/shared/io/IdentityRestoration.js";
import {
  completeIdentityRestoration,
  assertIdentityRestorationComplete,
} from "../../../src/cli/state/source-name-to-canonical-id/restore.js";
import { createSourceNameToCanonicalIdLedger } from "../../../src/cli/state/source-name-to-canonical-id/index.js";

const input = {
  metadata: { name: "000001-test", namespace: "test" },
  spec: {
    entityKind: "Agency",
    sourceName: "source",
    expectedCurrentId: "wrong",
    originalId: "original",
    reason: "Restore established public identity",
    evidence: "Published original URL",
  },
};

test("requires distinct IDs and evidence", () => {
  expect(() =>
    IdentityRestoration.new({
      ...input,
      spec: { ...input.spec, evidence: "" },
    }),
  ).toThrow();
  expect(() =>
    IdentityRestoration.new({
      ...input,
      spec: { ...input.spec, originalId: "wrong" },
    }),
  ).toThrow();
});

test("restores both directions and resumes after completion without assigning new identity", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "identity-restore-"));
  const ledger = createSourceNameToCanonicalIdLedger({ rootDir });
  await ledger.findOrCreate("test", "Agency", "source", async () => "wrong");
  const event = IdentityRestoration.new(input);
  await expect(
    assertIdentityRestorationComplete(event, rootDir),
  ).rejects.toThrow();
  await completeIdentityRestoration(event, rootDir);
  await completeIdentityRestoration(event, rootDir);
  await assertIdentityRestorationComplete(event, rootDir);
  const fresh = createSourceNameToCanonicalIdLedger({ rootDir });
  expect(await fresh.read("test", "Agency", "source")).toBe("original");
  expect(await fresh.sourceIdFor("test", "Agency", "original")).toBe("source");
});

test("refuses mismatched mapping and occupied original identity", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "identity-restore-"));
  const ledger = createSourceNameToCanonicalIdLedger({ rootDir });
  await ledger.findOrCreate(
    "test",
    "Agency",
    "source",
    async () => "unexpected",
  );
  await expect(
    completeIdentityRestoration(IdentityRestoration.new(input), rootDir),
  ).rejects.toThrow("mapping");
  const collisionRoot = await mkdtemp(path.join(tmpdir(), "identity-restore-"));
  const collisionLedger = createSourceNameToCanonicalIdLedger({
    rootDir: collisionRoot,
  });
  await collisionLedger.findOrCreate(
    "test",
    "Agency",
    "source",
    async () => "wrong",
  );
  await collisionLedger.findOrCreate(
    "test",
    "Agency",
    "other",
    async () => "original",
  );
  await expect(
    completeIdentityRestoration(IdentityRestoration.new(input), collisionRoot),
  ).rejects.toThrow("occupied");
  expect(await collisionLedger.read("test", "Agency", "source")).toBe("wrong");
});

test("rejects another namespace that also owns the erroneous canonical identity", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "identity-restore-"));
  const ledger = createSourceNameToCanonicalIdLedger({ rootDir });
  await ledger.findOrCreate("test", "Agency", "source", async () => "wrong");
  await ledger.findOrCreate(
    "other",
    "Agency",
    "foreign-source",
    async () => "wrong",
  );
  await expect(
    completeIdentityRestoration(IdentityRestoration.new(input), rootDir),
  ).rejects.toThrow("another namespace");
  expect(await ledger.read("test", "Agency", "source")).toBe("wrong");
});
