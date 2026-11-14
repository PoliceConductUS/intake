import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as prettier from "prettier";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startIntakeDatabase,
  type IntakeDatabase,
} from "./cli/database/intake-postgres.js";

const run = promisify(execFile);
const repoRoot = process.cwd();
const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
const generatedPaths = [
  "src/shared/io/generated",
  "src/cli/import/artifacts/io/generated-mutations",
  "docs/data-request-format.md",
];

async function filesUnder(target: string): Promise<string[]> {
  if ((await stat(target)).isFile()) {
    return [target];
  }
  const entries = await readdir(target, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => filesUnder(path.join(target, entry.name))),
  );
  return nested.flat();
}

async function formattedGeneratedFiles(
  root: string,
): Promise<Map<string, string>> {
  const formatted = new Map<string, string>();
  for (const generatedPath of generatedPaths) {
    for (const file of await filesUnder(path.join(root, generatedPath))) {
      formatted.set(
        path.relative(root, file),
        await prettier.format(await readFile(file, "utf8"), {
          filepath: file,
        }),
      );
    }
  }
  return formatted;
}

describe("generated files (real Postgres)", () => {
  let db: IntakeDatabase;
  let regeneratedRoot: string;

  beforeAll(async () => {
    db = await startIntakeDatabase();
    regeneratedRoot = await mkdtemp(path.join(tmpdir(), "generated-files-"));
    await mkdir(path.join(regeneratedRoot, "docs"));
    for (const script of [
      "generate-envelope-types.ts",
      "generate-data-request-doc.ts",
    ]) {
      await run(tsx, [path.join(repoRoot, "scripts", script)], {
        cwd: regeneratedRoot,
        env: { ...process.env, DATABASE_URL: db.connectionString },
      });
    }
  }, 180000);

  afterAll(async () => {
    await db?.stop();
    await rm(regeneratedRoot, { recursive: true, force: true });
  });

  it("match what their generators produce from the migrated schema", async () => {
    const committed = await formattedGeneratedFiles(repoRoot);
    const regenerated = await formattedGeneratedFiles(regeneratedRoot);
    const differing = [...new Set([...committed.keys(), ...regenerated.keys()])]
      .filter((file) => committed.get(file) !== regenerated.get(file))
      .sort();

    expect(regenerated.size).toBeGreaterThan(0);
    expect(differing).toEqual([]);
  });
});
