import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import { Artifacts } from "../../../src/shared/io/Artifacts.js";
import { read as readLocationPathAliases } from "../../../src/shared/io/generated/LocationPathAliases.js";
import { read as readLocationPaths } from "../../../src/shared/io/generated/LocationPaths.js";

async function createTempArtifactsDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "intake-artifacts-"));
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

describe("Artifacts shared IO", () => {
  test("reads Artifacts and referenced artifacts with exact kind readers", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts.yaml");
    const aliasesArtifact = [
      `apiVersion: ${INTAKE_API_VERSION}`,
      "kind: LocationPathAliases",
      "metadata:",
      "  name: test-run",
      "  namespace: mn-post",
      "spec:",
      "  records:",
      "    /mn/ramsey-county/st-paul/:",
      "      spec:",
      "        alias_path: /mn/ramsey-county/st-paul/",
      "        location_path_id: /mn/ramsey-county/saint-paul/",
    ].join("\n");
    const pathsArtifact = [
      `apiVersion: ${INTAKE_API_VERSION}`,
      "kind: LocationPaths",
      "metadata:",
      "  name: test-run",
      "  namespace: mn-post",
      "spec:",
      "  records:",
      "    /mn/ramsey-county/saint-paul/:",
      "      spec:",
      "        location_path_id: /mn/ramsey-county/saint-paul/",
      "        path: /mn/ramsey-county/saint-paul/",
      "        level: place",
      "        state_or_territory_slug: mn",
      "        administrative_area_slug: ramsey-county",
      "        place_slug: saint-paul",
      "        display_name: Saint Paul",
      "        parent_location_path_id: /mn/ramsey-county/",
    ].join("\n");
    await writeFile(path.join(directory, "aliases.yaml"), aliasesArtifact);
    await writeFile(path.join(directory, "paths.yaml"), pathsArtifact);
    await writeFile(
      artifactsPath,
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: Artifacts",
        "metadata:",
        "  name: test-run",
        "  namespace: mn-post",
        "spec:",
        "  artifacts:",
        "    - ref:",
        "        path: aliases.yaml",
        "        kind: LocationPathAliases",
        `        sha256: ${sha256(aliasesArtifact)}`,
        "    - ref:",
        "        path: paths.yaml",
        "        kind: LocationPaths",
        `        sha256: ${sha256(pathsArtifact)}`,
      ].join("\n"),
    );

    const artifactsEnvelope = await Artifacts.read(artifactsPath);
    const paths = await readLocationPaths(path.join(directory, "paths.yaml"), {
      expectedNamespace: artifactsEnvelope.metadata.namespace,
    });
    const aliases = await readLocationPathAliases(
      path.join(directory, "aliases.yaml"),
      {
        expectedNamespace: artifactsEnvelope.metadata.namespace,
      },
    );

    expect(artifactsEnvelope).toMatchObject({
      apiVersion: INTAKE_API_VERSION,
      kind: "Artifacts",
      metadata: { name: "test-run", namespace: "mn-post" },
      spec: {
        artifacts: [
          {
            kind: "LocationPaths",
            spec: {
              records: paths.spec.records,
            },
          },
          {
            kind: "LocationPathAliases",
            spec: {
              records: aliases.spec.records,
            },
          },
        ],
      },
    });
    expect(paths.kind).toBe("LocationPaths");
    expect(aliases.kind).toBe("LocationPathAliases");
    expect(artifactsEnvelope.spec.artifacts).toHaveLength(2);
    expect(paths.spec.records).toHaveProperty("/mn/ramsey-county/saint-paul/");
  });

  test("can read Artifacts raw without resolving refs", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: Artifacts",
        "metadata:",
        "  name: test-run",
        "  namespace: mn-post",
        "spec:",
        "  artifacts:",
        "    - ref:",
        "        path: missing.yaml",
        "        kind: LocationPaths",
      ].join("\n"),
    );

    const artifactsEnvelope = await Artifacts.read(artifactsPath, {
      raw: true,
    });

    expect(artifactsEnvelope).not.toHaveProperty("artifacts");
    expect(artifactsEnvelope.spec.artifacts).toEqual([
      { ref: { path: "missing.yaml", kind: "LocationPaths" } },
    ]);
  });

  test("can resolve only selected artifact kinds", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts.yaml");
    const pathsArtifact = [
      `apiVersion: ${INTAKE_API_VERSION}`,
      "kind: LocationPaths",
      "metadata:",
      "  name: test-run",
      "  namespace: mn-post",
      "spec:",
      "  records:",
      "    /mn/:",
      "      spec:",
      "        location_path_id: /mn/",
      "        path: /mn/",
      "        level: state",
      "        state_or_territory_slug: mn",
      "        administrative_area_slug: null",
      "        place_slug: null",
      "        display_name: Minnesota",
      "        parent_location_path_id: null",
    ].join("\n");
    await writeFile(path.join(directory, "paths.yaml"), pathsArtifact);
    await writeFile(
      artifactsPath,
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: Artifacts",
        "metadata:",
        "  name: test-run",
        "  namespace: mn-post",
        "spec:",
        "  artifacts:",
        "    - ref:",
        "        path: missing-geometries.yaml",
        "        kind: LocationPathGeometries",
        "    - ref:",
        "        path: paths.yaml",
        "        kind: LocationPaths",
        `        sha256: ${sha256(pathsArtifact)}`,
      ].join("\n"),
    );

    const artifactsEnvelope = await Artifacts.read(artifactsPath, {
      includeKinds: ["LocationPaths"],
    });

    expect(artifactsEnvelope.spec.artifacts).toHaveLength(1);
    expect(artifactsEnvelope.spec.artifacts[0]?.kind).toBe("LocationPaths");
  });

  test("rejects malformed inline artifact specs even on raw reads", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: Artifacts",
        "metadata:",
        "  name: test-run",
        "  namespace: mn-post",
        "spec:",
        "  artifacts:",
        "    - kind: LocationPaths",
        "      spec:",
        "        records:",
        "          /mn/:",
        "            spec:",
        "              location_path_id: /mn/",
        "              path: /mn/",
        "              level: state",
        "              state_or_territory_slug: mn",
        "              administrative_area_slug: null",
        "              place_slug: null",
        "              display_name: Minnesota",
        "              parent_location_path_id: null",
        "              longitude: -93.2",
      ].join("\n"),
    );

    await expect(Artifacts.read(artifactsPath, { raw: true })).rejects.toThrow(
      "Artifacts is malformed at spec.artifacts.0.spec.records./mn/.",
    );
  });

  test("writes Artifacts artifact items as refs", async () => {
    const directory = await createTempArtifactsDirectory();

    const result = await Artifacts.write(directory, {
      apiVersion: INTAKE_API_VERSION,
      kind: "Artifacts",
      metadata: { name: "test-run", namespace: "mn-post" },
      spec: {
        artifacts: [
          {
            kind: "LocationPaths",
            spec: {
              records: {
                "/mn/": {
                  spec: {
                    location_path_id: "/mn/",
                    path: "/mn/",
                    level: "state",
                    state_or_territory_slug: "mn",
                    administrative_area_slug: null,
                    place_slug: null,
                    display_name: "Minnesota",
                    parent_location_path_id: null,
                  },
                },
              },
            },
          },
          {
            kind: "AgencyPersonnel",
            spec: {
              records: {},
            },
          },
        ],
      },
    });

    const artifactsYaml = await readFile(result.path, "utf8");
    expect(artifactsYaml).toContain("ref:");
    expect(artifactsYaml).toContain("kind: LocationPaths");
    expect(artifactsYaml).toContain("sha256:");
    expect(artifactsYaml).not.toContain("records:");
    await expect(
      readFile(path.join(directory, "test-run.LocationPaths.yaml"), "utf8"),
    ).resolves.toContain("records:");
    await expect(
      readFile(path.join(directory, "test-run.AgencyPersonnel.yaml"), "utf8"),
    ).resolves.toContain("kind: AgencyPersonnel");
  });

  test("rejects a missing artifacts file", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "missing.yaml");

    await expect(Artifacts.read(artifactsPath)).rejects.toThrow(
      `Artifacts is not readable: ${artifactsPath}`,
    );
  });

  test("rejects a directory path", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts-dir");
    await mkdir(artifactsPath);

    await expect(Artifacts.read(artifactsPath)).rejects.toThrow(
      `Artifacts is not a file: ${artifactsPath}`,
    );
  });

  test("rejects malformed YAML", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(artifactsPath, "apiVersion: [\n");

    await expect(Artifacts.read(artifactsPath)).rejects.toThrow(
      `Artifacts YAML is malformed: ${artifactsPath}`,
    );
  });

  test("rejects the former apiVersion", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      [
        "apiVersion: policeconduct.org/v1",
        "kind: Artifacts",
        "spec:",
        "  entities: {}",
      ].join("\n"),
    );

    await expect(Artifacts.read(artifactsPath)).rejects.toThrow(
      "Artifacts is malformed at apiVersion.",
    );
  });

  test("rejects the old organization-wide apiVersion", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      [
        "apiVersion: policeconduct.org/v1alpha1",
        "kind: Artifacts",
        "metadata:",
        "  name: test-run",
        "  namespace: mn-post",
        "spec:",
        "  entities: {}",
      ].join("\n"),
    );

    await expect(Artifacts.read(artifactsPath)).rejects.toThrow(
      "Artifacts is malformed at apiVersion.",
    );
  });

  test("rejects an unsupported kind", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: SourcePackage",
        "metadata:",
        "  name: test-run",
        "  namespace: mn-post",
        "spec:",
        "  entities: {}",
      ].join("\n"),
    );

    await expect(Artifacts.read(artifactsPath)).rejects.toThrow(
      "Artifacts is malformed at kind.",
    );
  });

  test("rejects Artifacts without metadata.namespace", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: Artifacts",
        "metadata:",
        "  name: test-run",
        "  namespace: ''",
        "spec: {}",
      ].join("\n"),
    );

    await expect(Artifacts.read(artifactsPath)).rejects.toThrow(
      "Artifacts is malformed at metadata.namespace.",
    );
  });

  test("rejects Artifacts with spec.source", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: Artifacts",
        "metadata:",
        "  name: test-run",
        "  namespace: mn-post",
        "spec:",
        "  artifacts: []",
        "  source:",
        "    namespace: mn-post",
      ].join("\n"),
    );

    await expect(Artifacts.read(artifactsPath)).rejects.toThrow(
      "Artifacts is malformed at spec.source.",
    );
  });

  test("rejects Artifacts without metadata.name", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: Artifacts",
        "metadata:",
        "  namespace: mn-post",
        "spec:",
        "  entities: {}",
      ].join("\n"),
    );

    await expect(Artifacts.read(artifactsPath)).rejects.toThrow(
      "Artifacts is malformed at metadata.name.",
    );
  });

  test("rejects removed inline entity shapes as malformed Artifacts specs", async () => {
    const directory = await createTempArtifactsDirectory();
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      [
        `apiVersion: ${INTAKE_API_VERSION}`,
        "kind: Artifacts",
        "metadata:",
        "  name: test-run",
        "  namespace: mn-post",
        "spec:",
        "  artifacts: []",
        "  entities:",
        "    agencies: {}",
      ].join("\n"),
    );

    await expect(Artifacts.read(artifactsPath)).rejects.toThrow(
      "Artifacts is malformed at spec.entities.",
    );
  });
});
