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
  const schemaReset = path.join(workspace, "schema-reset.mjs");
  // Stub only the external schema reset; nested CLI dispatch remains real.
  await writeFile(
    schemaReset,
    `
    import childProcess from 'node:child_process';
    import { EventEmitter } from 'node:events';
    import { syncBuiltinESMExports } from 'node:module';
    const original = childProcess.spawn;
    childProcess.spawn = (binary, args, options) => {
      if (args[0] !== 'db' || args[1] !== 'reset') return original(binary, args, options);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    };
    syncBuiltinESMExports();
  `,
  );
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        schemaReset,
        "--import",
        "tsx",
        "src/cli/index.ts",
        "data",
        "reset",
        "--no-acquire",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          INTAKE_WORKSPACE: workspace,
          DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
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
