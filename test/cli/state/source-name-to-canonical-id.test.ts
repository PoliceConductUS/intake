import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type {
  ImportArtifactKind,
  ArtifactsEnvelope,
} from "../../../src/shared/io/Artifacts.js";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import { yamlResourceFileName } from "../../../src/shared/io/resource.js";
import {
  assertCanonicalMappingFields,
  loadSourceNameToCanonicalIds,
  persistSourceNameToCanonicalIds,
  resolveArtifactsSourceNameToCanonicalIds,
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

type EntityMaps = {
  locationPaths?: Record<string, unknown>;
  agencies?: Record<string, unknown>;
  personnel?: Record<string, unknown>;
  agencyPersonnel?: Record<string, unknown>;
};

function artifactsWithEntities(entities: EntityMaps): ArtifactsEnvelope {
  const kindByEntityName = {
    locationPaths: "LocationPaths",
    agencies: "Agencies",
    personnel: "Personnel",
    agencyPersonnel: "AgencyPersonnel",
  } satisfies Record<keyof EntityMaps, ImportArtifactKind>;
  return {
    apiVersion: "policeconduct.org/intake/v1alpha1",
    kind: "Artifacts",
    metadata: { name: "test-run", namespace: "mn-post" },
    spec: {
      artifacts: Object.entries(entities).map(([entityName, records]) => ({
        kind: kindByEntityName[entityName as keyof EntityMaps],
        spec: { records },
      })),
    },
  };
}

describe("SourceNameToCanonicalId records", () => {
  test("resolves namespace mn-post to the intake-owned SourceNameToCanonicalId directory", () => {
    const rootDir = "/tmp/intake-test-root";

    expect(resolveSourceNameToCanonicalIdPath("mn-post", { rootDir })).toBe(
      path.join(rootDir, "intake", "state", "namespaces", "mn-post"),
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

  test("creates a missing intake-owned namespace mapping directory", async () => {
    const rootDir = await createTempRoot();
    const mappingPath = resolveSourceNameToCanonicalIdPath("mn-post", {
      rootDir,
    });

    await expect(
      loadSourceNameToCanonicalIds("mn-post", { rootDir }),
    ).resolves.toEqual({
      locationPaths: {},
      agencies: {},
      personnel: {},
      agencyPersonnel: {},
    });
    expect((await stat(mappingPath)).isDirectory()).toBe(true);
  });

  test("loads entity-scoped per-record mapping files", async () => {
    const rootDir = await createTempRoot();
    const mappings = await loadSourceNameToCanonicalIds("mn-post", { rootDir });
    mappings.locationPaths["/mn/ramsey-county/saint-paul/"] = {
      canonicalId: "saint-paul-location-path",
    };
    mappings.agencies["agency-1"] = { canonicalId: "agency-canonical-1" };
    await persistSourceNameToCanonicalIds("mn-post", mappings, { rootDir });

    await expect(
      loadSourceNameToCanonicalIds("mn-post", { rootDir }),
    ).resolves.toEqual({
      locationPaths: {
        "/mn/ramsey-county/saint-paul/": {
          kind: "LocationPath",
          canonicalId: "saint-paul-location-path",
        },
      },
      agencies: {
        "agency-1": { kind: "Agency", canonicalId: "agency-canonical-1" },
      },
      personnel: {},
      agencyPersonnel: {},
    });
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

    await expect(
      loadSourceNameToCanonicalIds("mn-post", { rootDir }),
    ).rejects.toThrow(
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

    await expect(
      loadSourceNameToCanonicalIds("mn-post", { rootDir }),
    ).rejects.toThrow("SourceNameToCanonicalId is malformed at spec.slug.");
  });

  test("location path mappings use full path source names and require canonicalId", () => {
    const artifacts = artifactsWithEntities({
      locationPaths: { "/mn/ramsey-county/saint-paul/": {} },
    });

    expect(() =>
      assertCanonicalMappingFields(artifacts, {
        locationPaths: { "/mn/ramsey-county/saint-paul/": {} },
        agencies: {},
        personnel: {},
        agencyPersonnel: {},
      }),
    ).toThrow(
      "Location path source name /mn/ramsey-county/saint-paul/ is missing required field canonicalId.",
    );
  });

  test("canonical mapping validation reports all incomplete mapping records", () => {
    const artifacts = artifactsWithEntities({
      locationPaths: { "/mn/ramsey-county/saint-paul/": {} },
      agencies: { "agency-1": {} },
      personnel: { "person-1": {} },
      agencyPersonnel: { "roster-1": {} },
    });

    expect(() =>
      assertCanonicalMappingFields(artifacts, {
        locationPaths: { "/mn/ramsey-county/saint-paul/": {} },
        agencies: { "agency-1": {} },
        personnel: { "person-1": {} },
        agencyPersonnel: { "roster-1": {} },
      }),
    ).toThrow(
      [
        "SourceNameToCanonicalId records are incomplete.",
        "Location path source name /mn/ramsey-county/saint-paul/ is missing required field canonicalId.",
        "Agency source name agency-1 is missing required field canonicalId.",
        "Personnel source name person-1 is missing required field canonicalId.",
        "Agency-personnel source name roster-1 is missing required field canonicalId.",
      ].join("\n"),
    );
  });

  test("creates and persists a cuid2 canonicalId for each missing source entity mapping", async () => {
    const rootDir = await createTempRoot();
    const mappingDirectory = resolveSourceNameToCanonicalIdPath("mn-post", {
      rootDir,
    });
    await mkdir(mappingDirectory, { recursive: true });
    const mappings = await loadSourceNameToCanonicalIds("mn-post", { rootDir });
    const artifacts = artifactsWithEntities({
      locationPaths: { "/mn/ramsey-county/saint-paul/": {} },
      agencies: { "agency-1": {} },
      personnel: { "person-1": {} },
      agencyPersonnel: { "roster-1": {} },
    });

    const resolved = await resolveArtifactsSourceNameToCanonicalIds(
      artifacts,
      mappings,
      {
        rootDir,
      },
    );

    expect(resolved.locationPaths["/mn/ramsey-county/saint-paul/"]).toEqual({
      kind: "LocationPath",
      canonicalId: expect.stringMatching(/^[a-z][a-z0-9]+$/),
    });
    expect(resolved.agencies["agency-1"]).toEqual({
      kind: "Agency",
      canonicalId: expect.stringMatching(/^[a-z][a-z0-9]+$/),
    });
    const reloaded = await loadSourceNameToCanonicalIds("mn-post", { rootDir });
    expect(reloaded.locationPaths["/mn/ramsey-county/saint-paul/"]).toEqual(
      resolved.locationPaths["/mn/ramsey-county/saint-paul/"],
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

    await expect(
      loadSourceNameToCanonicalIds("mn-post", { rootDir }),
    ).rejects.toThrow(
      `SourceNameToCanonicalId namespace other-source does not match expected namespace mn-post: ${mappingPath}`,
    );
  });
});
