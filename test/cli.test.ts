import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runIntake } from "../src/cli.js";

describe("intake CLI", () => {
  test("prints root help", async () => {
    const result = await runIntake(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: intake <command>");
    expect(result.stdout).toContain("validate <manifest-ref>");
  });

  test("requires a manifest ref for validate", async () => {
    const result = await runIntake(["validate"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required manifest ref.");
  });

  test("rejects a manifest ref that does not exist", async () => {
    const result = await runIntake(["validate", "./missing.yaml"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Manifest is not readable: ./missing.yaml");
  });

  test("rejects a manifest ref that is not a file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "intake-cli-"));

    const result = await runIntake(["validate", directory]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Manifest is not a file:");
  });

  test("fails intentionally for a readable manifest until validation exists", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "intake-cli-"));
    const manifestPath = path.join(directory, "manifest.yaml");
    await writeFile(manifestPath, "apiVersion: policeconduct.org/v1alpha1\n");

    const result = await runIntake(["validate", manifestPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "IntakePackage validation is not implemented yet.",
    );
  });
});
