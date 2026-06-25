import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { yamlResourceFileName } from "../../src/shared/io/resource.js";
import {
  Agency,
  AgencySpec,
  read as readAgencies,
  write as writeAgencies,
} from "../../src/shared/io/generated/Agencies.js";

async function createTempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "intake-artifacts-"));
}

describe("canonical import artifact reader and writer", () => {
  test("writes and reads a registry-validated typed import artifact", async () => {
    const rootDir = await createTempRoot();

    const result = await writeAgencies(rootDir, {
      metadata: {
        name: "test-run",
        namespace: "mn-post",
      },
      spec: {
        records: {
          "agency-source-id": {
            spec: {
              name: "Baxter Police Dept.",
              city: "Baxter",
              state: "MN",
              address: "13190 Memorywood Dr",
              zip_code: "56425-1000",
            },
          },
        },
      },
    });

    const artifactPath = path.join(
      rootDir,
      yamlResourceFileName("test-run", "Agencies"),
    );
    expect(result).toEqual({
      path: artifactPath,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(readFile(artifactPath, "utf8")).resolves.toContain(
      "kind: Agencies",
    );

    const artifact = await readAgencies(artifactPath, {
      expectedKind: "Agencies",
      expectedNamespace: "mn-post",
      expectedSha256: result.sha256,
    });

    expect(artifact).toMatchObject({
      kind: "Agencies",
      metadata: {
        name: "test-run",
        namespace: "mn-post",
      },
      spec: {
        records: {
          "agency-source-id": {
            name: "Baxter Police Dept.",
            state: "MN",
          },
        },
      },
    });
  });

  test("writer rejects fields outside the canonical import type schema", async () => {
    const rootDir = await createTempRoot();
    const invalidSpec = {
      name: "Baxter Police Dept.",
      state: "MN",
      unsupported: "database change required",
    };

    expect(AgencySpec.safeParse(invalidSpec).success).toBe(false);

    await expect(
      writeAgencies(rootDir, {
        metadata: {
          name: "test-run",
          namespace: "mn-post",
        },
        spec: {
          records: {
            "agency-source-id": {
              spec: invalidSpec,
            },
          },
        },
      }),
    ).rejects.toThrow(
      "Agencies is malformed at spec.records.agency-source-id.",
    );
  });

  test("reader rejects referenced record envelopes outside the singular spec", async () => {
    const rootDir = await createTempRoot();
    const artifactPath = path.join(rootDir, "artifacts.Agencies.yaml");
    const recordPath = path.join(
      rootDir,
      "records",
      yamlResourceFileName("agency-source-id", "Agency"),
    );
    await mkdir(path.dirname(recordPath), { recursive: true });
    await writeFile(
      recordPath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: Agency",
        "metadata:",
        "  name: agency-source-id",
        "  namespace: mn-post",
        "spec:",
        "  name: Baxter Police Dept.",
        "  state: MN",
        "  unsupported: database change required",
      ].join("\n"),
    );
    await writeFile(
      artifactPath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: Agencies",
        "metadata:",
        "  name: test-run",
        "  namespace: mn-post",
        "spec:",
        "  records:",
        "    agency-source-id:",
        "      ref:",
        `        path: records/${yamlResourceFileName("agency-source-id", "Agency")}`,
        "        kind: Agency",
      ].join("\n"),
    );

    await expect(readAgencies(artifactPath)).rejects.toThrow(
      "Agency is malformed at spec.unsupported.",
    );
  });

  test("reads referenced record envelopes as artifact records", async () => {
    const rootDir = await createTempRoot();
    const artifactPath = path.join(rootDir, "artifacts.Agencies.yaml");
    const recordPath = path.join(
      rootDir,
      "records",
      yamlResourceFileName("agency-source-id", "Agency"),
    );
    await mkdir(path.dirname(recordPath), { recursive: true });
    await writeFile(
      recordPath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: Agency",
        "metadata:",
        "  name: agency-source-id",
        "  namespace: mn-post",
        "spec:",
        "  name: Baxter Police Dept.",
        "  state: MN",
      ].join("\n"),
    );
    await writeFile(
      artifactPath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: Agencies",
        "metadata:",
        "  name: test-run",
        "  namespace: mn-post",
        "spec:",
        "  records:",
        "    agency-source-id:",
        "      ref:",
        `        path: records/${yamlResourceFileName("agency-source-id", "Agency")}`,
        "        kind: Agency",
      ].join("\n"),
    );

    await expect(readAgencies(artifactPath)).resolves.toMatchObject({
      spec: {
        records: {
          "agency-source-id": {
            name: "Baxter Police Dept.",
            state: "MN",
          },
        },
      },
    });
  });

  test("singular envelope read accepts a same-kind ref", async () => {
    const rootDir = await createTempRoot();
    const parentPath = path.join(rootDir, "artifact.Agencies.yaml");
    const recordPath = path.join(
      rootDir,
      "records",
      yamlResourceFileName("agency-source-id", "Agency"),
    );
    await mkdir(path.dirname(recordPath), { recursive: true });
    await writeFile(
      recordPath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: Agency",
        "metadata:",
        "  name: agency-source-id",
        "  namespace: mn-post",
        "spec:",
        "  name: Baxter Police Dept.",
        "  state: MN",
      ].join("\n"),
    );

    await expect(
      Agency.read(
        {
          path: `records/${yamlResourceFileName("agency-source-id", "Agency")}`,
          kind: "Agency",
        },
        { relativeTo: parentPath, expectedNamespace: "mn-post" },
      ),
    ).resolves.toMatchObject({
      metadata: { name: "agency-source-id", namespace: "mn-post" },
      spec: { name: "Baxter Police Dept.", state: "MN" },
    });
  });

  test("writer can externalize inline records as record envelopes", async () => {
    const rootDir = await createTempRoot();
    const artifactPath = path.join(
      rootDir,
      yamlResourceFileName("test-run", "Agencies"),
    );

    await writeAgencies(
      rootDir,
      {
        metadata: {
          name: "test-run",
          namespace: "mn-post",
        },
        spec: {
          records: {
            "agency-source-id": {
              spec: {
                name: "Baxter Police Dept.",
                state: "MN",
              },
            },
          },
        },
      },
      { externalizeRecords: true, recordsDirectory: "records/agencies" },
    );

    await expect(readFile(artifactPath, "utf8")).resolves.toContain(
      `path: records/agencies/${yamlResourceFileName("agency-source-id", "Agency")}`,
    );
    await expect(readFile(artifactPath, "utf8")).resolves.toContain(
      "kind: Agency",
    );
    await expect(
      readFile(
        path.join(
          rootDir,
          "records",
          "agencies",
          yamlResourceFileName("agency-source-id", "Agency"),
        ),
        "utf8",
      ),
    ).resolves.toContain("kind: Agency");
    await expect(readAgencies(artifactPath)).resolves.toMatchObject({
      spec: {
        records: {
          "agency-source-id": {
            name: "Baxter Police Dept.",
            state: "MN",
          },
        },
      },
    });
  });

  test("reader rejects inline record metadata because it is derived", async () => {
    const rootDir = await createTempRoot();
    const artifactPath = path.join(rootDir, "artifacts.Agencies.yaml");
    await writeFile(
      artifactPath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: Agencies",
        "metadata:",
        "  name: test-run",
        "  namespace: mn-post",
        "spec:",
        "  records:",
        "    agency-source-id:",
        "      metadata:",
        "        name: agency-source-id",
        "        namespace: mn-post",
        "      spec:",
        "        name: Baxter Police Dept.",
        "        state: MN",
      ].join("\n"),
    );

    await expect(readAgencies(artifactPath)).rejects.toThrow(
      "Agencies is malformed at spec.records.agency-source-id.",
    );
  });

  test("generated shared IO excludes source module command files", async () => {
    await expect(
      access(
        path.join(
          process.cwd(),
          "src",
          "shared",
          "io",
          "generated",
          "Command.ts",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      readFile(
        path.join(
          process.cwd(),
          "src",
          "shared",
          "io",
          "generated",
          "index.ts",
        ),
        "utf8",
      ),
    ).resolves.not.toContain("Command");
  });
});
