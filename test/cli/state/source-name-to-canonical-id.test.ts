import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import { yamlResourceFileName } from "../../../src/shared/io/resource.js";
import {
  createSourceNameToCanonicalIdLedger,
  resolveSourceNameToCanonicalIdPath,
} from "../../../src/cli/state/source-name-to-canonical-id/index.js";

async function createTempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "intake-mappings-"));
}

async function writeMappingRecord(
  rootDir: string,
  namespace: string,
  entityDirectory: string,
  sourceName: string,
  contents: string,
): Promise<string> {
  const mappingPath = path.join(
    resolveSourceNameToCanonicalIdPath(namespace, { rootDir }),
    entityDirectory,
    yamlResourceFileName(sourceName, "SourceNameToCanonicalId"),
  );
  await mkdir(path.dirname(mappingPath), { recursive: true });
  await writeFile(mappingPath, contents);
  return mappingPath;
}

describe("SourceNameToCanonicalId records", () => {
  test("resolves namespace mn-post to the intake-owned SourceNameToCanonicalId directory", () => {
    const rootDir = "/tmp/intake-test-root";

    expect(resolveSourceNameToCanonicalIdPath("mn-post", { rootDir })).toBe(
      path.join(rootDir, "state", "intake", "namespaces", "mn-post"),
    );
  });

  test("requires INTAKE_WORKSPACE when no root directory is provided", () => {
    const originalWorkspace = process.env.INTAKE_WORKSPACE;

    try {
      delete process.env.INTAKE_WORKSPACE;

      expect(() => resolveSourceNameToCanonicalIdPath("mn-post")).toThrow(
        "INTAKE_WORKSPACE is required to resolve SourceNameToCanonicalId records.",
      );
    } finally {
      if (originalWorkspace === undefined) {
        delete process.env.INTAKE_WORKSPACE;
      } else {
        process.env.INTAKE_WORKSPACE = originalWorkspace;
      }
    }
  });

  test("read returns undefined for a source key with no record file", async () => {
    const rootDir = await createTempRoot();
    const ledger = createSourceNameToCanonicalIdLedger({ rootDir });

    await expect(ledger.read("mn-post", "Agency", "agency-1")).resolves.toBe(
      undefined,
    );
  });

  test("findOrCreate mints a stable cuid2 that a later read and findOrCreate reuse", async () => {
    const rootDir = await createTempRoot();
    const ledger = createSourceNameToCanonicalIdLedger({ rootDir });

    const minted = await ledger.findOrCreate("mn-post", "Agency", "agency-1");
    expect(minted).toMatch(/^[a-z][a-z0-9]+$/);

    // durably persisted: a fresh accessor over the same root reads it back
    const reopened = createSourceNameToCanonicalIdLedger({ rootDir });
    await expect(reopened.read("mn-post", "Agency", "agency-1")).resolves.toBe(
      minted,
    );
    await expect(
      reopened.findOrCreate("mn-post", "Agency", "agency-1"),
    ).resolves.toBe(minted);
  });

  test("keys identity by namespace: the same source id in two namespaces is distinct", async () => {
    const rootDir = await createTempRoot();
    const ledger = createSourceNameToCanonicalIdLedger({ rootDir });

    const mnId = await ledger.findOrCreate("mn-post", "Agency", "101100");
    const txId = await ledger.findOrCreate("gov.tx.tcole", "Agency", "101100");

    expect(mnId).not.toBe(txId);
    await expect(ledger.read("mn-post", "Agency", "101100")).resolves.toBe(
      mnId,
    );
    await expect(ledger.read("gov.tx.tcole", "Agency", "101100")).resolves.toBe(
      txId,
    );
  });

  test("keys identity by kind: a record is not found under a different kind", async () => {
    const rootDir = await createTempRoot();
    const ledger = createSourceNameToCanonicalIdLedger({ rootDir });

    await ledger.findOrCreate("mn-post", "Agency", "shared-key");

    await expect(
      ledger.read("mn-post", "Personnel", "shared-key"),
    ).resolves.toBe(undefined);
  });

  test("rejects malformed per-record mapping YAML", async () => {
    const rootDir = await createTempRoot();
    const mappingPath = await writeMappingRecord(
      rootDir,
      "mn-post",
      "Agency",
      "agency-1",
      "canonicalId: [\n",
    );
    const ledger = createSourceNameToCanonicalIdLedger({ rootDir });

    await expect(ledger.read("mn-post", "Agency", "agency-1")).rejects.toThrow(
      `SourceNameToCanonicalId YAML is malformed: ${mappingPath}`,
    );
  });

  test("rejects SourceNameToCanonicalId records with type-specific properties", async () => {
    const rootDir = await createTempRoot();
    await writeMappingRecord(
      rootDir,
      "mn-post",
      "Agency",
      "agency-1",
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: SourceNameToCanonicalId",
        "metadata:",
        "  name: agency-1",
        "  namespace: mn-post",
        "spec:",
        "  kind: Agency",
        "  canonicalId: agency-canonical-1",
        "  slug: agency-one",
      ].join("\n"),
    );
    const ledger = createSourceNameToCanonicalIdLedger({ rootDir });

    await expect(ledger.read("mn-post", "Agency", "agency-1")).rejects.toThrow(
      "SourceNameToCanonicalId is malformed at spec.slug.",
    );
  });

  test("rejects mapping files with mismatched metadata namespace", async () => {
    const rootDir = await createTempRoot();
    const mappingPath = await writeMappingRecord(
      rootDir,
      "mn-post",
      "Agency",
      "agency-1",
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: SourceNameToCanonicalId",
        "metadata:",
        "  name: agency-1",
        "  namespace: other-source",
        "spec:",
        "  kind: Agency",
        "  canonicalId: agency-canonical-1",
      ].join("\n"),
    );
    const ledger = createSourceNameToCanonicalIdLedger({ rootDir });

    await expect(ledger.read("mn-post", "Agency", "agency-1")).rejects.toThrow(
      `SourceNameToCanonicalId namespace other-source does not match expected namespace mn-post: ${mappingPath}`,
    );
  });
});

describe("CanonicalIdToSourceName reverse lookup (ADR 0023)", () => {
  test("sourceIdFor mints a stable source id that persists and resolves forward to the canonical", async () => {
    const rootDir = await createTempRoot();
    const ledger = createSourceNameToCanonicalIdLedger({ rootDir });

    const canonicalId = "agency-canonical-42";
    const sourceId = await ledger.sourceIdFor("courtlistener", "Agency", canonicalId);
    expect(sourceId).toMatch(/^[a-z][a-z0-9]+$/);

    // a fresh accessor over the same root returns the same source id...
    const reopened = createSourceNameToCanonicalIdLedger({ rootDir });
    await expect(
      reopened.sourceIdFor("courtlistener", "Agency", canonicalId),
    ).resolves.toBe(sourceId);
    // ...and the minted source id resolves forward to the canonical it came from
    await expect(
      reopened.read("courtlistener", "Agency", sourceId),
    ).resolves.toBe(canonicalId);
  });

  test("round-trips a created entity: sourceIdFor returns the id findOrCreate was given", async () => {
    const rootDir = await createTempRoot();
    const ledger = createSourceNameToCanonicalIdLedger({ rootDir });

    const canonicalId = await ledger.findOrCreate("mn-post", "Agency", "agency-1");

    // the reverse of a mapping created forward hands back the source's own id,
    // not a fresh mint — across a reopened ledger (no in-memory cache to lean on)
    const reopened = createSourceNameToCanonicalIdLedger({ rootDir });
    await expect(
      reopened.sourceIdFor("mn-post", "Agency", canonicalId),
    ).resolves.toBe("agency-1");
  });

  test("keys the reverse by namespace and kind", async () => {
    const rootDir = await createTempRoot();
    const ledger = createSourceNameToCanonicalIdLedger({ rootDir });

    const canonicalId = "shared-canonical";
    const courtlistenerId = await ledger.sourceIdFor(
      "courtlistener",
      "Agency",
      canonicalId,
    );
    const clearinghouseId = await ledger.sourceIdFor(
      "clearinghouse-api",
      "Agency",
      canonicalId,
    );
    const personnelId = await ledger.sourceIdFor(
      "courtlistener",
      "AgencyPersonnel",
      canonicalId,
    );

    expect(new Set([courtlistenerId, clearinghouseId, personnelId]).size).toBe(3);
  });
});
