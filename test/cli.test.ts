import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { loadCliEnvironment, runIntake } from "../src/cli/index.js";

describe("intake CLI", () => {
  test("loads DATABASE_URL from .env in the current working directory", async () => {
    const originalCwd = process.cwd();
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const directory = await mkdtemp(path.join(tmpdir(), "intake-cli-"));
    await writeFile(
      path.join(directory, ".env"),
      "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres\n",
    );

    try {
      delete process.env.DATABASE_URL;
      process.chdir(directory);

      loadCliEnvironment();

      expect(process.env.DATABASE_URL).toBe(
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      );
    } finally {
      process.chdir(originalCwd);
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });

  test("loads INTAKE_WORKSPACE from .env in the current working directory", async () => {
    const originalCwd = process.cwd();
    const originalWorkspace = process.env.INTAKE_WORKSPACE;
    const directory = await mkdtemp(path.join(tmpdir(), "intake-cli-"));
    const workspace = path.join(directory, "workspace");
    await writeFile(
      path.join(directory, ".env"),
      `INTAKE_WORKSPACE=${workspace}\n`,
    );

    try {
      delete process.env.INTAKE_WORKSPACE;
      process.chdir(directory);

      loadCliEnvironment();

      expect(process.env.INTAKE_WORKSPACE).toBe(workspace);
    } finally {
      process.chdir(originalCwd);
      if (originalWorkspace === undefined) {
        delete process.env.INTAKE_WORKSPACE;
      } else {
        process.env.INTAKE_WORKSPACE = originalWorkspace;
      }
    }
  });

  test("keeps an exported DATABASE_URL when .env also defines one", async () => {
    const originalCwd = process.cwd();
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const directory = await mkdtemp(path.join(tmpdir(), "intake-cli-"));
    await writeFile(
      path.join(directory, ".env"),
      "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:1/postgres\n",
    );

    try {
      process.env.DATABASE_URL =
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
      process.chdir(directory);

      loadCliEnvironment();

      expect(process.env.DATABASE_URL).toBe(
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      );
    } finally {
      process.chdir(originalCwd);
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });

  test("prints root help", async () => {
    const result = await runIntake(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: intake <command>");
    expect(result.stdout).toContain("import");
    expect(result.stdout).toContain("replay");
    expect(result.stdout).toContain("help [command]");
  });

  test("requires an import subcommand", async () => {
    const result = await runIntake(["import"]);

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("Usage: intake import [options] [command]");
    expect(result.stderr).toContain("artifacts [options] <artifacts-ref>");
  });

  test("prints database-mutations replay help", async () => {
    const result = await runIntake(["replay", "database-mutations", "--help"]);

    expect(result).toMatchObject({ exitCode: 0 });
    expect(result.stdout).toContain(
      "Usage: intake replay database-mutations [options] <database-mutations-ref>",
    );
  });

  test("requires an artifacts ref for import artifacts", async () => {
    const result = await runIntake(["import", "artifacts"]);

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain(
      "error: missing required argument 'artifacts-ref'",
    );
  });

  test("prints import artifacts help", async () => {
    const result = await runIntake(["import", "artifacts", "--help"]);

    expect(result).toMatchObject({ exitCode: 0 });
    expect(result.stdout).toContain(
      "Usage: intake import artifacts [options] <artifacts-ref>",
    );
    expect(result.stdout).toContain(
      "--dry-run      Write the DatabaseMutations envelope without applying database",
    );
    expect(result.stdout).toContain("mutations");
  });

  test("routes dry-run before the import artifacts ref", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "intake-cli-"));
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      "apiVersion: policeconduct.org/intake/v1alpha1\n",
    );
    let receivedArtifactsRef: string | undefined;
    let receivedDryImport: boolean | undefined;

    const result = await runIntake(
      ["import", "artifacts", "--dry-run", artifactsPath],
      {
        runImportArtifactsCommand: async (artifactsRef, options) => {
          receivedArtifactsRef = artifactsRef;
          receivedDryImport = options?.dryImport;
          return { exitCode: 0, stdout: "ok\n" };
        },
      },
    );

    expect(result).toMatchObject({ exitCode: 0 });
    expect(receivedArtifactsRef).toBe(artifactsPath);
    expect(receivedDryImport).toBe(true);
  });

  test("routes dry-run after the import artifacts ref", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "intake-cli-"));
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      "apiVersion: policeconduct.org/intake/v1alpha1\n",
    );
    let receivedArtifactsRef: string | undefined;
    let receivedDryImport: boolean | undefined;

    const result = await runIntake(
      ["import", "artifacts", artifactsPath, "--dry-run"],
      {
        runImportArtifactsCommand: async (artifactsRef, options) => {
          receivedArtifactsRef = artifactsRef;
          receivedDryImport = options?.dryImport;
          return { exitCode: 0, stdout: "ok\n" };
        },
      },
    );

    expect(result).toMatchObject({ exitCode: 0 });
    expect(receivedArtifactsRef).toBe(artifactsPath);
    expect(receivedDryImport).toBe(true);
  });

  test("rejects unknown import artifacts options", async () => {
    const result = await runIntake([
      "import",
      "artifacts",
      "--unknown",
      "artifacts.yaml",
    ]);

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("error: unknown option '--unknown'");
  });

  test("rejects extra import artifacts arguments", async () => {
    const result = await runIntake([
      "import",
      "artifacts",
      "one.yaml",
      "extra",
    ]);

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain(
      "error: too many arguments for 'artifacts'. Expected 1 argument but got 2",
    );
  });

  test("import artifacts rejects a missing artifacts using the shared artifacts preflight", async () => {
    const importAction = vi.fn(async () => ({ exitCode: 0, stdout: "ok\n" }));

    const result = await runIntake(["import", "artifacts", "./missing.yaml"], {
      runImportArtifactsCommand: importAction,
    });

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain(
      "Artifacts is not readable: ./missing.yaml",
    );
    expect(importAction).not.toHaveBeenCalled();
  });

  test("import artifacts rejects a directory using the shared artifacts preflight", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "intake-cli-"));
    const importAction = vi.fn(async () => ({ exitCode: 0, stdout: "ok\n" }));

    const result = await runIntake(["import", "artifacts", directory], {
      runImportArtifactsCommand: importAction,
    });

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain(`Artifacts is not a file: ${directory}`);
    expect(importAction).not.toHaveBeenCalled();
  });

  test("rejects unknown import subcommands", async () => {
    const result = await runIntake(["import", "mn", "post"]);

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("error: unknown command 'mn'");
  });

  test("routes a single database-mutations replay ref to the database-mutations replay action", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "intake-cli-"));
    const databaseMutationsPath = path.join(
      directory,
      "database-mutations.yaml",
    );
    await writeFile(databaseMutationsPath, "kind: DatabaseMutations\n");
    const replayDatabaseMutationsAction = vi.fn(async () => ({
      exitCode: 0,
      stdout: "ok\n",
    }));

    const result = await runIntake(
      ["replay", "database-mutations", databaseMutationsPath],
      {
        runReplayDatabaseMutationsCommand: replayDatabaseMutationsAction,
      },
    );

    expect(result).toMatchObject({ exitCode: 0 });
    expect(replayDatabaseMutationsAction).toHaveBeenCalledWith(
      databaseMutationsPath,
    );
  });

  test("database-mutations replay rejects a missing DatabaseMutations file before replay execution", async () => {
    const replayDatabaseMutationsAction = vi.fn(async () => ({
      exitCode: 0,
      stdout: "ok\n",
    }));

    const result = await runIntake(
      ["replay", "database-mutations", "./missing.yaml"],
      {
        runReplayDatabaseMutationsCommand: replayDatabaseMutationsAction,
      },
    );

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain(
      "DatabaseMutations is not readable: ./missing.yaml",
    );
    expect(replayDatabaseMutationsAction).not.toHaveBeenCalled();
  });

  test("routes a single import artifacts ref to the import action", async () => {
    const originalWorkspace = process.env.INTAKE_WORKSPACE;
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const directory = await mkdtemp(path.join(tmpdir(), "intake-cli-"));
    const workspace = path.join(directory, "workspace");
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: Artifacts",
        "metadata:",
        "  name: test-run",
        "  namespace: mn-post",
        "spec:",
        "  artifacts: []",
      ].join("\n"),
    );
    const mappingPath = path.join(
      workspace,
      "state",
      "intake",
      "namespaces",
      "mn-post",
    );
    await mkdir(mappingPath, { recursive: true });

    try {
      process.env.INTAKE_WORKSPACE = workspace;
      // This scenario asserts the missing-DATABASE_URL failure, so it must not
      // inherit an ambient DATABASE_URL (the generator needs one, tests may set
      // it).
      delete process.env.DATABASE_URL;

      const result = await runIntake(["import", "artifacts", artifactsPath]);

      expect(result).toMatchObject({ exitCode: 1 });
      expect(result.stderr).toContain(
        "DATABASE_URL is required to write database mutations.",
      );
    } finally {
      if (originalWorkspace === undefined) {
        delete process.env.INTAKE_WORKSPACE;
      } else {
        process.env.INTAKE_WORKSPACE = originalWorkspace;
      }
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });

  test("rejects an invalid import artifacts before import execution", async () => {
    const originalWorkspace = process.env.INTAKE_WORKSPACE;
    const directory = await mkdtemp(path.join(tmpdir(), "intake-cli-"));
    const workspace = path.join(directory, "workspace");
    const artifactsPath = path.join(directory, "artifacts.yaml");
    await writeFile(
      artifactsPath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: Artifacts",
        "metadata:",
        "  name: test-run",
        "  namespace: ''",
        "spec: {}",
      ].join("\n"),
    );

    try {
      process.env.INTAKE_WORKSPACE = workspace;

      const result = await runIntake(["import", "artifacts", artifactsPath]);

      expect(result).toMatchObject({ exitCode: 1 });
      expect(result.stderr).toContain(
        "Artifacts is malformed at metadata.namespace.",
      );
    } finally {
      if (originalWorkspace === undefined) {
        delete process.env.INTAKE_WORKSPACE;
      } else {
        process.env.INTAKE_WORKSPACE = originalWorkspace;
      }
    }
  });
});
