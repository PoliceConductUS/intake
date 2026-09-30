import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

test("the executable reset dispatches transform instead of awaiting its own entry module", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "reset-entry-"));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const schemaReset = path.join(workspace, "schema-reset");
  // Stub only the external schema reset; nested CLI dispatch remains real.
  await writeFile(schemaReset, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  try {
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "src/cli/index.ts", "data", "reset", "--no-acquire"],
      {
        cwd: root,
        env: {
          ...process.env,
          INTAKE_WORKSPACE: workspace,
          DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
          SUPABASE_CLI_BINARY_OVERRIDE: schemaReset,
        },
        timeout: 20_000,
      },
    ).then(
      (output) => ({ code: 0, ...output }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
    expect(result.stderr).not.toContain("unsettled top-level await");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "us-census-gazetteer has no acquired input",
    );
    expect(result.stderr).toContain(
      "rebuild incomplete at data transform us-census-gazetteer",
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}, 30_000);
