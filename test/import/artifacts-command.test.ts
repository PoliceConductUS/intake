import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runImportArtifactsCommand } from "../../src/cli/index.js";
import { GENERATED_MIGRATION_VERSIONS } from "../../src/shared/io/generated/entity-specs.js";
import { importArtifacts } from "../../src/cli/import/artifacts/config.js";
import { DataContext } from "../../src/cli/import/artifacts/data-context.js";
import { applyOptionalArtifactMutation } from "../../src/cli/import/artifacts/artifact-mutation.js";
import { ArtifactMutation } from "../../src/cli/import/artifacts/io/ArtifactMutation.js";
import { ArtifactMutations } from "../../src/cli/import/artifacts/io/ArtifactMutations.js";
import { DatabaseMutations } from "../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { DatabaseMutationsDebug } from "../../src/cli/import/artifacts/io/DatabaseMutationsDebug.js";
import { replayDatabaseMutations } from "../../src/cli/replay/database-mutations/config.js";
import { persistSourceNameToCanonicalIds } from "../../src/cli/state/source-name-to-canonical-id/index.js";
import { fakeSourceNameLedger } from "../cli/state/fake-source-name-ledger.js";
import { EmptyDatabaseClient } from "../cli/database/empty-database-client.js";
import {
  readResolvedProperty,
  type ResolvedPropertyCacheInput,
} from "../../src/cli/state/resolved-property/index.js";
import { Artifacts } from "../../src/shared/io/Artifacts.js";
import { Command as CommandEnvelope } from "../../src/shared/io/Command.js";
import { write as writeAgencies } from "../../src/shared/io/generated/Agencies.js";
import { INTAKE_API_VERSION } from "../../src/shared/io/import-types.js";
import { yamlResourceFileName } from "../../src/shared/io/resource.js";
import type {
  ImportRows,
  LocationPathRow,
} from "../../src/cli/import/artifacts/transform.js";

const rows: ImportRows = {
  locationPaths: [],
  locationPathAliases: [],
  preparationMutations: [],
};

const agencyRecord = {
  id: "agency-canonical-id",
  name: "Minnesota State Patrol",
  city: "Saint Paul",
  state: "MN",
  address: "444 Cedar Street",
  zip_code: "55101",
  contact_name: null,
  contact_email: null,
  slug: "minnesota-state-patrol",
  location_path_id: "mn/saint-paul/minnesota-state-patrol",
  latitude: 44.955097,
  longitude: -93.102211,
};

async function writeSourceArtifactsFile(rootDir: string): Promise<string> {
  const writtenArtifacts = await Artifacts.write(
    rootDir,
    Artifacts.new({
      metadata: { name: "test-run", namespace: "mn-post" },
      spec: { artifacts: [] },
    }),
  );
  return writtenArtifacts.path;
}

describe("importArtifacts", () => {
  test("applies optional artifact mutation before transform", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-mutation-"));
    const sourceCommandDirectory = path.join(rootDir, "source-command");
    await mkdir(sourceCommandDirectory, { recursive: true });
    const mutationRefPath = path.join(
      sourceCommandDirectory,
      "mutations",
      yamlResourceFileName(
        "mn-post:test-run:Agency:agency-source-id:coordinates",
        "ArtifactMutation",
      ),
    );
    await mkdir(path.dirname(mutationRefPath), { recursive: true });
    await ArtifactMutation.write(
      path.dirname(mutationRefPath),
      ArtifactMutation.new({
        metadata: {
          name: "mn-post:test-run:Agency:agency-source-id:coordinates",
          namespace: "manual",
        },
        spec: {
          target: {
            namespace: "mn-post",
            command: { name: "test-run" },
            kind: "Agency",
            name: "agency-source-id",
          },
          operations: [
            {
              action: "set",
              path: "latitude",
              value: 46.3433,
              reason: "Manual address point from agency website.",
              source: {
                namespace: "mn-post",
                command: { name: "test-run" },
                kind: "Agencies",
                name: "agency-source-id",
              },
            },
            {
              action: "set",
              path: "longitude",
              value: -94.2821,
              reason: "Manual address point from agency website.",
              source: {
                namespace: "mn-post",
                command: { name: "test-run" },
                kind: "Agencies",
                name: "agency-source-id",
              },
            },
          ],
        },
      }),
    );
    await ArtifactMutations.write(
      sourceCommandDirectory,
      ArtifactMutations.new({
        metadata: {
          name: "test-run",
          namespace: "manual",
          annotations: { "policeconduct.org/intake.createdBy": "manual" },
        },
        spec: {
          mutations: [
            {
              target: {
                namespace: "mn-post",
                command: { name: "test-run" },
                kind: "Agency",
                name: "agency-source-id",
              },
              operations: [
                {
                  action: "set",
                  path: "urls.website",
                  value: "https://example.test/police",
                  reason: "Manual agency website enrichment.",
                  source: {
                    namespace: "mn-post",
                    command: { name: "test-run" },
                    kind: "Agencies",
                    name: "agency-source-id",
                  },
                },
              ],
            },
            {
              ref: {
                path: `mutations/${path.basename(mutationRefPath)}`,
                kind: "ArtifactMutation",
              },
            },
          ],
        },
      }),
    );
    await writeAgencies(
      sourceCommandDirectory,
      {
        metadata: { name: "test-run", namespace: "mn-post" },
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
      },
      { recordsDirectory: "records" },
    );
    const writtenArtifacts = await Artifacts.write(
      sourceCommandDirectory,
      Artifacts.new({
        metadata: { name: "test-run", namespace: "mn-post" },
        spec: {
          artifacts: [
            {
              ref: {
                path: yamlResourceFileName("test-run", "Agencies"),
                kind: "Agencies",
              },
            },
          ],
        },
      }),
    );
    const artifactsPath = writtenArtifacts.path;
    const artifacts = await Artifacts.read(artifactsPath);
    await applyOptionalArtifactMutation(artifacts, { artifactsPath });
    const agencyArtifact = artifacts.spec.artifacts.find(
      (artifact) => artifact.kind === "Agencies",
    );
    expect(agencyArtifact?.spec.records["agency-source-id"]).toMatchObject({
      urls: { website: "https://example.test/police" },
      latitude: 46.3433,
      longitude: -94.2821,
    });
  });

  test("reads inline Artifacts artifact references before transform", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-artifacts-"));
    const writtenArtifacts = await Artifacts.write(
      rootDir,
      Artifacts.new({
        metadata: { name: "test-run", namespace: "mn-post" },
        spec: {
          artifacts: [
            {
              kind: "Agencies",
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
            },
          ],
        },
      }),
    );
    const artifacts = await Artifacts.read(writtenArtifacts.path);
    expect(artifacts.spec.artifacts).toHaveLength(1);
    expect(artifacts.spec.artifacts[0]).toMatchObject({
      kind: "Agencies",
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

  test("fails on an existing successful Import for the same source Artifacts before reading mappings", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-existing-"));
    const replayImportArtifactsId = "tz4a98xxat96iws9zmbrgj3a";
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const existingPath = path.join(
      rootDir,
      "command",
      `2026-06-08T00-00-00-000Z-${replayImportArtifactsId}`,
      yamlResourceFileName(replayImportArtifactsId, "DatabaseMutations"),
    );
    await DatabaseMutations.write(
      path.dirname(existingPath),
      DatabaseMutations.new({
        metadata: {
          name: replayImportArtifactsId,
          namespace: "mn-post",
          sourceArtifactsName: "test-run",
        },
        spec: { mutations: [] },
      }),
    );
    const result = await importArtifacts({
      artifactsPath,
      env: { INTAKE_WORKSPACE_TEST: rootDir },
      logger: {
        info: () => {},
        debug: () => {},
      },
      commandName: "test-command",
      commandDirectory: path.join(
        rootDir,
        "command",
        "2026-06-08T00-00-00-000Z-test-command",
      ),
    });

    expect(result).toEqual({
      ok: false,
      error: [
        `DatabaseMutations already exists for source Artifacts test-run: ${existingPath}`,
        `Replay the existing DatabaseMutations with: intake replay database-mutations ${existingPath}`,
      ].join("\n"),
    });
  });

  test("writes a replayable DatabaseMutations envelope after successful database import", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-"));
    const runId = "tz4a98xxat96iws9zmbrgj3a";
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const artifacts = await Artifacts.read(artifactsPath);
    const commandDirectory = path.join(
      rootDir,
      "command",
      `2026-06-08T00-00-00-000Z-${runId}`,
    );
    const runContext = new DataContext({
      rows,
      client: new EmptyDatabaseClient(),
      ledger: fakeSourceNameLedger({
        agencies: {
          "agency-source-id": { canonicalId: "agency-canonical-id" },
        },
        personnel: {},
        agencyPersonnel: {},
        locationPaths: {},
      }),
    });
    // Agencies are facade-based (ADR 0016): register the (already-resolved) agency
    // through its facade so it emits.
    const { id: _agencyId, ...agencySpec } = agencyRecord;
    runContext
      .fromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: "mn-post",
        name: "agency-source-id",
      })
      .merge(agencySpec);
    const databaseMutations = await runContext.toDatabaseMutations({
      namespace: artifacts.metadata.namespace,
      name: runId,
      sourceArtifactsName: artifacts.metadata.name,
      sourceArtifactsPath: artifactsPath,
      sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
    });
    const replayImportArtifacts = await DatabaseMutations.write(
      commandDirectory,
      databaseMutations,
    );

    expect(replayImportArtifacts?.path).toContain(
      path.join(rootDir, "command"),
    );
    expect(path.dirname(replayImportArtifacts!.path)).toMatch(
      new RegExp(
        `${path.join(rootDir, "command").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\d{4}-\\d{2}-\\d{2}T.*-${runId}$`,
      ),
    );
    expect(path.basename(replayImportArtifacts!.path)).toBe(
      yamlResourceFileName(runId, "DatabaseMutations"),
    );
    const commandRoot = path.join(rootDir, "command");
    const [commandFolder] = await readdir(commandRoot);
    const parsedImportArtifacts = await DatabaseMutations.read(
      path.join(
        commandRoot,
        commandFolder!,
        yamlResourceFileName(runId, "DatabaseMutations"),
      ),
    );
    expect(parsedImportArtifacts.metadata).toMatchObject({
      name: runId,
      sourceArtifactsName: "test-run",
      sourceArtifactsPath: artifactsPath,
      sourceArtifactsDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(parsedImportArtifacts.kind).toBe("DatabaseMutations");
    expect(parsedImportArtifacts.spec).toHaveProperty("mutations");
    const mutations = parsedImportArtifacts.spec.mutations as Record<
      string,
      unknown
    >[];
    const agencyMutation = mutations.find(
      (mutation) => mutation.kind === "AgencyCreate",
    );
    expect(agencyMutation).toBeDefined();
    expect(agencyMutation).not.toHaveProperty("ownedColumns");
    expect(agencyMutation).not.toHaveProperty("target");
    expect(agencyMutation?.kind).toBe("AgencyCreate");
  });

  test("replays an existing DatabaseMutations without writing another DatabaseMutations envelope", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-replay-"));
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const artifacts = await Artifacts.read(artifactsPath);
    const replayImportArtifactsArtifact = await DatabaseMutations.write(
      path.join(rootDir, "command", "2026-06-08T00-00-00-000Z-test-command"),
      DatabaseMutations.new({
        metadata: {
          namespace: artifacts.metadata.namespace,
          name: "test-command",
          sourceArtifactsName: artifacts.metadata.name,
          sourceArtifactsPath: artifactsPath,
          sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
        },
        spec: { mutations: [] },
      }),
    );
    const commandDirectory = path.dirname(replayImportArtifactsArtifact!.path);
    const filesBeforeReplay = await readdir(commandDirectory);

    const result = await replayDatabaseMutations({
      databaseMutationsPath: replayImportArtifactsArtifact!.path,
      env: {},
    });

    expect(result).toEqual({
      ok: false,
      error: "DATABASE_URL is required to replay DatabaseMutations.",
    });
    await expect(readdir(commandDirectory)).resolves.toEqual(filesBeforeReplay);
  });

  test("records artifact mutation reference in import-artifacts replay metadata", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-mutation-"));
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const artifacts = await Artifacts.read(artifactsPath);
    const mutationPath = path.join(
      path.dirname(artifactsPath),
      yamlResourceFileName("test-run", "ArtifactMutations"),
    );

    const replayImportArtifacts = await DatabaseMutations.write(
      path.join(rootDir, "command", "2026-06-08T00-00-00-000Z-test-command"),
      DatabaseMutations.new({
        metadata: {
          namespace: artifacts.metadata.namespace,
          name: "test-command",
          sourceArtifactsName: artifacts.metadata.name,
          sourceArtifactsPath: artifactsPath,
          sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
          artifactMutation: {
            path: mutationPath,
            digest: "sha256:1234",
          },
        },
        spec: { mutations: [] },
      }),
    );

    const importArtifactsEnvelope = await DatabaseMutations.read(
      replayImportArtifacts!.path,
    );

    expect(importArtifactsEnvelope.metadata.artifactMutation).toEqual({
      path: mutationPath,
      digest: "sha256:1234",
    });
  });

  test("writes a debug DatabaseMutations envelope with preparation errors", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-debug-"));
    const runId = "tz4a98xxat96iws9zmbrgj3a";
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const artifacts = await Artifacts.read(artifactsPath);
    const replayImportArtifacts = await DatabaseMutationsDebug.write(
      path.join(rootDir, "command", `2026-06-08T00-00-00-000Z-${runId}`),
      DatabaseMutationsDebug.new({
        metadata: {
          namespace: artifacts.metadata.namespace,
          name: runId,
          sourceArtifactsName: artifacts.metadata.name,
          sourceArtifactsPath: artifactsPath,
          sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
          status: "failed",
          counts: {
            agencies: 1,
            personnel: 2,
            agencyPersonnel: 3,
          },
          ownedColumns: {
            agency: ["name"],
            personnel: ["first_name", "last_name"],
            agencyPersonnel: ["agency_id", "officer_id"],
          },
          errors: ["missing latitude", "missing longitude"],
        },
        spec: { mutations: [] },
      }),
    );

    expect(path.basename(replayImportArtifacts!.path)).toBe(
      yamlResourceFileName(runId, "DatabaseMutationsDebug"),
    );
    const parsedImportArtifacts = await DatabaseMutationsDebug.read(
      replayImportArtifacts!.path,
    );
    expect(parsedImportArtifacts.kind).toBe("DatabaseMutationsDebug");
    expect(parsedImportArtifacts.metadata).toMatchObject({
      name: runId,
      sourceArtifactsName: "test-run",
      sourceArtifactsDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      counts: {
        agencies: 1,
        personnel: 2,
        agencyPersonnel: 3,
      },
      ownedColumns: {
        agency: ["name"],
        personnel: ["first_name", "last_name"],
        agencyPersonnel: ["agency_id", "officer_id"],
      },
    });
    expect(parsedImportArtifacts.spec).toHaveProperty("mutations");
  });

  test("debug DatabaseMutations accepts failed inline mutation specs for inspection", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-debug-"));
    const runId = "tz4a98xxat96iws9zmbrgj3a";
    const replayImportArtifacts = await DatabaseMutationsDebug.write(
      path.join(rootDir, "command", `2026-06-08T00-00-00-000Z-${runId}`),
      DatabaseMutationsDebug.new({
        metadata: {
          namespace: "mn-post",
          name: runId,
          status: "failed",
          counts: {
            agencies: 1,
          },
          errors: ["missing latitude"],
        },
        spec: {
          mutations: [
            {
              kind: "AgencyCreate",
              name: "agency-canonical-id",
              spec: {
                id: "agency-canonical-id",
              },
            },
          ],
        },
      }),
    );

    const parsedImportArtifacts = await DatabaseMutationsDebug.read(
      replayImportArtifacts.path,
    );

    expect(parsedImportArtifacts.spec.mutations).toEqual([
      {
        kind: "AgencyCreate",
        name: "agency-canonical-id",
        spec: {
          id: "agency-canonical-id",
        },
      },
    ]);
  });

  test("uses INTAKE_WORKSPACE for import-artifacts replay artifacts when INTAKE_WORKSPACE_TEST is unset", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-root-"));
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const artifacts = await Artifacts.read(artifactsPath);
    const replayImportArtifacts = await DatabaseMutations.write(
      path.join(rootDir, "command", "2026-06-08T00-00-00-000Z-test-command"),
      DatabaseMutations.new({
        metadata: {
          namespace: artifacts.metadata.namespace,
          name: "test-command",
          sourceArtifactsName: artifacts.metadata.name,
          sourceArtifactsPath: artifactsPath,
          sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
        },
        spec: { mutations: [] },
      }),
    );

    expect(replayImportArtifacts?.path).toContain(
      path.join(rootDir, "command"),
    );
    const commandRoot = path.join(rootDir, "command");
    await expect(readdir(commandRoot)).resolves.toHaveLength(1);
  });

  test("reports a clear error when the import-artifacts replay output directory is not writable", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-run-root-"));
    const workspaceFile = path.join(rootDir, "workspace-file");
    await writeFile(workspaceFile, "not a directory");
    const artifactsPath = await writeSourceArtifactsFile(rootDir);
    const artifacts = await Artifacts.read(artifactsPath);
    const commandRoot = path.join(workspaceFile, "command");

    await expect(
      DatabaseMutations.write(
        path.join(commandRoot, "2026-06-08T00-00-00-000Z-test-command"),
        DatabaseMutations.new({
          metadata: {
            namespace: artifacts.metadata.namespace,
            name: "test-command",
            sourceArtifactsName: artifacts.metadata.name,
            sourceArtifactsPath: artifactsPath,
            sourceArtifactsDigest: await Artifacts.digest(artifactsPath),
          },
          spec: { mutations: [] },
        }),
      ),
    ).rejects.toThrow();
  });

  test("CLI writes import progress to terminal and pino log file idempotently", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-logs-"));
    const workspace = path.join(rootDir, "workspace");
    const artifactsPath = path.join(
      workspace,
      "mn-post",
      "commands",
      "test-run",
      "artifacts.yaml",
    );
    let terminalOutput = "";

    const result = await runImportArtifactsCommand(artifactsPath, {
      env: { INTAKE_WORKSPACE: workspace },
      now: new Date("2026-06-10T00:00:00.000Z"),
      createCommandName: () => "tz4a98xxat96iws9zmbrgj3a",
      terminal: { write: (text) => (terminalOutput += text) },
      importArtifacts: async () => ({
        ok: true,
        counts: {
          mutations: 15,
          recordsByEntityType: {
            Agency: 1,
            AgencyPersonnel: 3,
            LocationPath: 4,
            LocationPathAlias: 5,
            Personnel: 2,
          },
        },
      }),
    });

    const logPath = path.join(
      workspace,
      "command",
      "2026-06-10T00-00-00-000Z-tz4a98xxat96iws9zmbrgj3a",
      "tz4a98xxat96iws9zmbrgj3a.log",
    );
    const commandPath = path.join(
      workspace,
      "command",
      "2026-06-10T00-00-00-000Z-tz4a98xxat96iws9zmbrgj3a",
      "tz4a98xxat96iws9zmbrgj3a.Command.yaml",
    );
    const logLines = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const command = await CommandEnvelope.read(commandPath);

    expect(result.exitCode).toBe(0);
    expect(command).toMatchObject({
      kind: "Command",
      metadata: {
        name: "tz4a98xxat96iws9zmbrgj3a",
        namespace: "intake",
      },
      spec: {
        path: ".",
        statePath: "../../state",
        sharedIoRoot: path.join(process.cwd(), "dist", "shared", "io"),
        args: ["import", "artifacts", artifactsPath],
      },
    });
    expect(terminalOutput).toContain(`Writing logs to ${logPath}`);
    expect(terminalOutput).toContain("Log level: info");
    expect(terminalOutput).toContain(`Importing artifacts: ${artifactsPath}`);
    expect(terminalOutput).toContain("Artifacts import succeeded.");
    expect(result.stdout).toContain("Imported artifact database records.");
    expect(result.stdout).toContain("Database mutations: 15");
    expect(result.stdout).toContain("LocationPath: 4");
    expect(result.stdout).toContain("LocationPathAlias: 5");
    expect(logLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 30,
          msg: "Artifacts import started.",
          artifactsPath,
        }),
        expect.objectContaining({
          level: 30,
          msg: "Artifacts import succeeded.",
          databaseMutations: 15,
          recordsByEntityType: {
            Agency: 1,
            AgencyPersonnel: 3,
            LocationPath: 4,
            LocationPathAlias: 5,
            Personnel: 2,
          },
        }),
      ]),
    );
  });

  test("CLI dry run reports ImportArtifacts creation without database create/read/update", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-logs-"));
    const workspace = path.join(rootDir, "workspace");
    let terminalOutput = "";
    let receivedDryImport: boolean | undefined;

    const result = await runImportArtifactsCommand("artifacts.yaml", {
      env: { INTAKE_WORKSPACE: workspace },
      dryImport: true,
      terminal: { write: (text) => (terminalOutput += text) },
      importArtifacts: async (input) => {
        receivedDryImport = input.dryImport;
        return {
          ok: true,
          counts: {
            mutations: 15,
            recordsByEntityType: {
              Agency: 1,
              AgencyPersonnel: 3,
              LocationPath: 4,
              LocationPathAlias: 5,
              Personnel: 2,
            },
          },
        };
      },
    });

    expect(receivedDryImport).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(terminalOutput).toContain(
      "Dry run: DatabaseMutations envelope will be created without database create/read/update.",
    );
    expect(result.stdout).toContain(
      "Created DatabaseMutations envelope. Database apply skipped.",
    );
    expect(result.stdout).toContain("Database mutations: 15");
    expect(result.stdout).toContain("LocationPath: 4");
    expect(result.stdout).toContain("LocationPathAlias: 5");
  });

  test("CLI honors LOG_LEVEL for observable debug logging", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-logs-"));
    const workspace = path.join(rootDir, "workspace");
    const artifactsPath = path.join(
      workspace,
      "mn-post",
      "commands",
      "test-run",
      "artifacts.yaml",
    );
    let terminalOutput = "";

    const result = await runImportArtifactsCommand(artifactsPath, {
      env: { INTAKE_WORKSPACE: workspace, LOG_LEVEL: "debug" },
      now: new Date("2026-06-10T00:00:00.000Z"),
      createCommandName: () => "tz4a98xxat96iws9zmbrgj3a",
      terminal: { write: (text) => (terminalOutput += text) },
      importArtifacts: async (input) => {
        input.logger?.debug({ debugVisible: true }, "Debug import detail.");
        return {
          ok: true,
          counts: { mutations: 0, recordsByEntityType: {} },
        };
      },
    });

    const logPath = path.join(
      workspace,
      "command",
      "2026-06-10T00-00-00-000Z-tz4a98xxat96iws9zmbrgj3a",
      "tz4a98xxat96iws9zmbrgj3a.log",
    );
    const logLines = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(result.exitCode).toBe(0);
    expect(terminalOutput).toContain("Log level: debug");
    expect(terminalOutput).toContain("Debug import detail.");
    expect(logLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 20,
          msg: "Debug import detail.",
          debugVisible: true,
        }),
      ]),
    );
  });

  test("writer failure returns failure and CLI does not report success", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-logs-"));
    const workspace = path.join(rootDir, "workspace");
    const importResult = {
      ok: false,
      error: "duplicate key value violates unique constraint",
    } as const;

    const cliResult = await runImportArtifactsCommand("artifacts.yaml", {
      env: { INTAKE_WORKSPACE: workspace },
      terminal: false,
      importArtifacts: async () => importResult,
    });

    expect(cliResult.exitCode).toBe(1);
    expect(cliResult.stderr).toContain(
      "duplicate key value violates unique constraint",
    );
    expect(cliResult.stdout ?? "").not.toContain("Imported artifacts");
  });

  test("records the latest successful import at state/<ns>/import.yaml", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "intake-import-ptr-"));
    const artifactsPath = await writeSourceArtifactsFile(rootDir);

    const result = await runImportArtifactsCommand(artifactsPath, {
      env: { INTAKE_WORKSPACE: rootDir },
      now: new Date("2026-06-10T00:00:00.000Z"),
      createCommandName: () => "importptr",
      terminal: false,
      importArtifacts: async () => ({
        ok: true,
        counts: { mutations: 0, recordsByEntityType: {} },
      }),
    });

    expect(result.exitCode).toBe(0);
    const pointer = await readFile(
      path.join(rootDir, "state", "mn-post", "import.yaml"),
      "utf8",
    );
    expect(pointer).toContain(
      "command/2026-06-10T00-00-00-000Z-importptr/mn-post/output",
    );
  });
});
