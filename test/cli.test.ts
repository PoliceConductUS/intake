import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
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
    expect(result.stdout).toContain("data");
    expect(result.stdout).toContain("replay");
    expect(result.stdout).toContain("help [command]");
  });

  test("prints database-mutations replay help", async () => {
    const result = await runIntake(["replay", "database-mutations", "--help"]);

    expect(result).toMatchObject({ exitCode: 0 });
    expect(result.stdout).toContain(
      "Usage: intake replay database-mutations [options] <database-mutations-ref>",
    );
  });
});
