import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { generateEntry, listEntries } from "../../../src/cli/data/chain.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

function envelope(
  namespace: string,
  mutations: unknown[],
): Record<string, unknown> {
  return {
    apiVersion: "policeconduct.org/intake/v1alpha1",
    kind: "DatabaseMutations",
    metadata: {
      name: `${namespace}-src`,
      namespace,
      databaseSchema: {
        appliedMigrations: [
          { version: "20250303232529", name: "initial_schema" },
          { version: "20260905000000", name: "data_mutation_ledger" },
        ],
      },
    },
    spec: { mutations },
  };
}

const aliasCreate = (aliasPath: string) => ({
  kind: "LocationPathAliasCreate",
  name: aliasPath,
  spec: { alias_path: aliasPath, location_path_id: "cabc1234def5678ghij90kl1" },
});

async function writeEnvelope(
  dir: string,
  name: string,
  value: Record<string, unknown>,
): Promise<string> {
  const filePath = path.join(dir, `${name}.DatabaseMutations.yaml`);
  await writeFile(filePath, JSON.stringify(value), "utf8"); // JSON is valid YAML
  return filePath;
}

describe("data-mutation chain generate", () => {
  it("appends stamped, sequenced entries that link to their predecessor", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chain-"));
    tempDirs.push(root);

    const first = await writeEnvelope(
      root,
      "in1",
      envelope("gov.a", [aliasCreate("/tx/a/")]),
    );
    const gen1 = await generateEntry(first, root);
    expect(gen1.version).toBe("000001");
    expect(gen1.mutationCount).toBe(1);

    const second = await writeEnvelope(
      root,
      "in2",
      envelope("gov.b", [aliasCreate("/tx/b/")]),
    );
    const gen2 = await generateEntry(second, root);
    expect(gen2.version).toBe("000002");

    const entries = await listEntries(root);
    expect(entries.map((e) => e.version)).toEqual(["000001", "000002"]);
    expect(entries.map((e) => e.previous)).toEqual(["", "000001"]);
    // The schema min-version is the max applied migration at generation.
    expect(entries[0]!.minSchemaVersion).toBe("20260905000000");
  });

  it("appends nothing for an empty diff", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chain-"));
    tempDirs.push(root);
    const empty = await writeEnvelope(root, "empty", envelope("gov.a", []));
    const result = await generateEntry(empty, root);
    expect(result.mutationCount).toBe(0);
    expect(result.written).toBeUndefined();
    expect(await listEntries(root)).toEqual([]);
  });
});
