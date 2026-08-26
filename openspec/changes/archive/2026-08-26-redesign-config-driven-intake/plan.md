# Config-Driven Source Run (AZ POST Tracer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `intake run <source-id> <path...>` that invokes a source's `sources/<id>/config.ts` `run`, which returns an `Artifacts` manifest, and imports it through the existing pipeline — proven on the AZ POST officer roster (`Personnel` only).

**Architecture:** A new auto-discovered CLI command acts as the composition root: it injects a narrow `readXlsx` capability into the source module's `run`, receives a returned manifest, builds an inline `Artifacts` envelope with the existing `Artifacts.new`/`Artifacts.write`, and hands the written file to the existing `runImportArtifactsCommand`. No new envelope kind, durable change type, DB migration, or event transport. `run` is deterministic and receives no service-locator context.

**Tech Stack:** TypeScript (ESM/NodeNext — import specifiers end in `.js`), Commander (auto-discovered commands), Vitest, tsx (dev run), exceljs (xlsx parsing, isolated behind one adapter), existing intake IO (`Artifacts`, `PersonnelSpec`, `runImportArtifactsCommand`).

## Global Constraints

- ESM/NodeNext: every relative import specifier ends in `.js` (even for `.ts` sources).
- Reuse the existing pipeline: the command MUST NOT reimplement identity assignment, mutation planning, or DB apply — it calls `runImportArtifactsCommand`.
- `run` MUST be deterministic: no network, no `Date.now()`/`new Date()`, no randomness.
- No service-locator context: `run` receives only the narrow capabilities it uses.
- No new envelope kind, no DB migration, no seed change, no generated-type change.
- Env: `INTAKE_WORKSPACE` required (command dirs + state); `DATABASE_URL` required only for non-dry-run apply. Personnel-only ⇒ `--dry-run` needs no live DB.
- Commits: Conventional Commits (ADR 0007). Commit after each task.
- Tests live under `test/`, mirroring `src/` paths. Run with `npm test`.

## File Structure

- Create `src/cli/run/index.ts` — `registerCliCommand`: registers `run`, validates args, resolves the source module, injects deps, builds + writes the envelope, calls import. Composition root.
- Create `src/cli/run/source-run.ts` — the `RunDeps` / `SourceManifest` / `SourceRun` types and `buildArtifactsEnvelope(sourceId, digest, manifest)`.
- Create `src/cli/run/read-xlsx.ts` — the `readXlsx(path)` adapter (exceljs), the only file importing the xlsx lib.
- Create `src/cli/run/load-source-module.ts` — `loadSourceModule(sourceId, sourcesRoot)`; dynamic import of `sources/<id>/config.ts` returning its `run` (injectable for tests).
- Create `sources/gov.azpost.roster/config.ts` — the AZ POST `run`.
- Tests: `test/cli/run/read-xlsx.test.ts`, `test/cli/run/source-run.test.ts`, `test/cli/run/run-command.test.ts`, `test/sources/gov.azpost.roster.test.ts`, `test/cli/run/run-import.integration.test.ts`.
- Test fixture: `test/fixtures/azpost/officer-list-sample.xlsx` (tiny hand-built workbook, ~5 rows incl. a duplicate POST ID and a blank-POST-ID row).

---

### Task 1: `readXlsx` parse capability

**Files:**

- Create: `src/cli/run/read-xlsx.ts`
- Test: `test/cli/run/read-xlsx.test.ts`
- Fixture: `test/fixtures/azpost/officer-list-sample.xlsx`
- Modify: `package.json` (add `exceljs` dependency)

**Interfaces:**

- Produces: `readXlsx(filePath: string): Promise<Array<Record<string, string>>>` — sheet 1, keyed by the header row (row 1); every cell coerced to a trimmed string (missing cells → `""`).

**Decision to confirm:** xlsx reader library. Default: `exceljs` (pure JS, maintained, no native deps). Alternatives: SheetJS `xlsx`, or a hand-rolled zip+XML reader. It is isolated to this one file; the source module never imports it.

- [ ] **Step 1: Add the dependency**

Run: `npm install exceljs`
Expected: `exceljs` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Build the fixture workbook**

Create `test/fixtures/azpost/officer-list-sample.xlsx` with headers exactly `AGENCY, POST ID, LAST, FIRST, MIDDLE, APPOINTED ON, TERMINATED ON, TERM DESC, CERTIFICATION, CERT TYPE` and rows:

| AGENCY   | POST ID | LAST     | FIRST | MIDDLE |
| -------- | ------- | -------- | ----- | ------ |
| Tempe PD | 1001    | Woodward | Skip  | L      |
| Mesa PD  | 1002    | Denney   | Marc  | E      |
| Mesa PD  | 1002    | Denney   | Marc  | E      |
| Tempe PD |         | Nokey    | Ann   |        |

(Generate it with a one-off script using the same `exceljs` API, or by hand; commit the `.xlsx`.)

- [ ] **Step 3: Write the failing test**

```ts
// test/cli/run/read-xlsx.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readXlsx } from "../../../src/cli/run/read-xlsx.js";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/azpost/officer-list-sample.xlsx",
);

describe("readXlsx", () => {
  it("reads sheet 1 rows keyed by the header row", async () => {
    const rows = await readXlsx(fixture);
    expect(rows).toHaveLength(4);
    expect(rows[0]["POST ID"]).toBe("1001");
    expect(rows[0]["FIRST"]).toBe("Skip");
    expect(rows[3]["POST ID"]).toBe(""); // blank cell → ""
  });

  it("is deterministic across repeat reads", async () => {
    expect(await readXlsx(fixture)).toEqual(await readXlsx(fixture));
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- read-xlsx`
Expected: FAIL — cannot find module `read-xlsx.js`.

- [ ] **Step 5: Implement `readXlsx`**

```ts
// src/cli/run/read-xlsx.ts
import ExcelJS from "exceljs";

export async function readXlsx(
  filePath: string,
): Promise<Array<Record<string, string>>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cell.value ?? "").trim();
  });

  const rows: Array<Record<string, string>> = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const record: Record<string, string> = {};
    for (let col = 1; col < headers.length; col++) {
      const header = headers[col];
      if (!header) continue;
      const value = row.getCell(col).value;
      record[header] =
        value === null || value === undefined ? "" : String(value).trim();
    }
    rows.push(record);
  }
  return rows;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- read-xlsx`
Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/cli/run/read-xlsx.ts test/cli/run/read-xlsx.test.ts test/fixtures/azpost/officer-list-sample.xlsx
git commit -m "feat: add deterministic xlsx read capability for source runs"
```

---

### Task 2: Manifest types + `Artifacts` envelope builder

**Files:**

- Create: `src/cli/run/source-run.ts`
- Test: `test/cli/run/source-run.test.ts`

**Interfaces:**

- Consumes: `Artifacts`, `ImportArtifactKind` from `../../shared/io/index.js`.
- Produces:
  - `type EmittedRecords = Record<string, { spec: unknown }>`
  - `type SourceManifest = { artifacts: Array<{ kind: ImportArtifactKind; records: EmittedRecords }> }`
  - `type RunDeps = { paths: string[]; readXlsx: (filePath: string) => Promise<Array<Record<string, string>>> }`
  - `type SourceRun = (deps: RunDeps) => Promise<SourceManifest>`
  - `buildArtifactsEnvelope(sourceId: string, digest: string, manifest: SourceManifest): ArtifactsEnvelope` — inline items; `metadata.namespace = sourceId`; `metadata.name = \`${sourceId}-${digest}\``.

- [ ] **Step 1: Write the failing test**

```ts
// test/cli/run/source-run.test.ts
import { describe, it, expect } from "vitest";
import { buildArtifactsEnvelope } from "../../../src/cli/run/source-run.js";

describe("buildArtifactsEnvelope", () => {
  it("builds an inline Artifacts envelope keyed by source-local id", () => {
    const envelope = buildArtifactsEnvelope("gov.azpost.roster", "abc123", {
      artifacts: [
        {
          kind: "Personnel",
          records: {
            "1001": {
              spec: { id: "1001", first_name: "Skip", last_name: "Woodward" },
            },
          },
        },
      ],
    });
    expect(envelope.metadata.namespace).toBe("gov.azpost.roster");
    expect(envelope.metadata.name).toBe("gov.azpost.roster-abc123");
    const item = envelope.spec.artifacts[0];
    expect(item).toMatchObject({
      kind: "Personnel",
      spec: {
        records: {
          "1001": { spec: { first_name: "Skip", last_name: "Woodward" } },
        },
      },
    });
  });

  it("rejects a record missing a required field via the envelope schema", () => {
    expect(() =>
      buildArtifactsEnvelope("s", "d", {
        artifacts: [
          {
            kind: "Personnel",
            records: { "1": { spec: { first_name: "Ann" } } },
          },
        ],
      }),
    ).toThrow(); // PersonnelSpec requires last_name
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- source-run`
Expected: FAIL — cannot find module `source-run.js`.

- [ ] **Step 3: Implement types + builder**

```ts
// src/cli/run/source-run.ts
import { Artifacts } from "../../shared/io/index.js";
import type {
  ArtifactsEnvelope,
  ImportArtifactKind,
} from "../../shared/io/index.js";

export type EmittedRecords = Record<string, { spec: unknown }>;
export type SourceManifest = {
  artifacts: Array<{ kind: ImportArtifactKind; records: EmittedRecords }>;
};
export type RunDeps = {
  paths: string[];
  readXlsx: (filePath: string) => Promise<Array<Record<string, string>>>;
};
export type SourceRun = (deps: RunDeps) => Promise<SourceManifest>;

export function buildArtifactsEnvelope(
  sourceId: string,
  digest: string,
  manifest: SourceManifest,
): ArtifactsEnvelope {
  return Artifacts.new({
    metadata: { name: `${sourceId}-${digest}`, namespace: sourceId },
    spec: {
      artifacts: manifest.artifacts.map((artifact) => ({
        kind: artifact.kind,
        spec: { records: artifact.records },
      })),
    },
  });
}
```

Note: `Artifacts.new` validates each inline record against the kind's spec (`.strict()`), so an invalid record throws here — satisfying the second test and the "envelope enforces validity" requirement.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- source-run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/run/source-run.ts test/cli/run/source-run.test.ts
git commit -m "feat: add source manifest types and Artifacts envelope builder"
```

---

### Task 3: Source module loader

**Files:**

- Create: `src/cli/run/load-source-module.ts`
- Test: `test/cli/run/load-source-module.test.ts`

**Interfaces:**

- Consumes: `SourceRun` from `./source-run.js`.
- Produces: `loadSourceModule(sourceId: string, sourcesRoot: string): Promise<SourceRun>` — dynamic-imports `<sourcesRoot>/<sourceId>/config.ts`; throws a clear error if the folder/module is missing or does not export a `run` function.

- [ ] **Step 1: Write the failing test**

```ts
// test/cli/run/load-source-module.test.ts
import { describe, it, expect } from "vitest";
import { loadSourceModule } from "../../../src/cli/run/load-source-module.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sourcesRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/sources",
);

describe("loadSourceModule", () => {
  it("loads a module exporting run", async () => {
    const run = await loadSourceModule("ok-source", sourcesRoot);
    expect(typeof run).toBe("function");
  });

  it("fails clearly for an unknown source id", async () => {
    await expect(loadSourceModule("missing", sourcesRoot)).rejects.toThrow(
      /missing/,
    );
  });

  it("fails when the module has no run export", async () => {
    await expect(loadSourceModule("no-run", sourcesRoot)).rejects.toThrow(
      /run/,
    );
  });
});
```

Create fixtures: `test/fixtures/sources/ok-source/config.ts` exporting `export const run = async () => ({ artifacts: [] });` and `test/fixtures/sources/no-run/config.ts` exporting `export const notRun = 1;`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- load-source-module`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the loader**

```ts
// src/cli/run/load-source-module.ts
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SourceRun } from "./source-run.js";

export async function loadSourceModule(
  sourceId: string,
  sourcesRoot: string,
): Promise<SourceRun> {
  const modulePath = path.join(sourcesRoot, sourceId, "config.ts");
  try {
    await access(modulePath, constants.R_OK);
  } catch {
    throw new Error(`Unknown source id: no source module at ${modulePath}`);
  }
  const module = (await import(pathToFileURL(modulePath).href)) as {
    run?: unknown;
  };
  if (typeof module.run !== "function") {
    throw new Error(`Source ${sourceId} config.ts must export a run function`);
  }
  return module.run as SourceRun;
}
```

Note: run under `npm run cli` / vitest (tsx transpiles `.ts` on import). Build integration (compiling `sources/` for the `dist` binary) is out of scope for Slice 1 — the CLI is exercised via tsx.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- load-source-module`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add src/cli/run/load-source-module.ts test/cli/run/load-source-module.test.ts test/fixtures/sources
git commit -m "feat: load source config.ts modules by id"
```

---

### Task 4: `intake run` command (composition root)

**Files:**

- Create: `src/cli/run/index.ts`
- Test: `test/cli/run/run-command.test.ts`

**Interfaces:**

- Consumes: `RegisterCliCommand`, `CliCommandDependencies`, `CommandResult` from `../../shared/cli/types.js`; `Artifacts` from `../../shared/io/index.js`; `runImportArtifactsCommand` from `../import/artifacts/index.js`; `createCommandDirectory` from `../command-directory.js`; `readXlsx`, `loadSourceModule`, `buildArtifactsEnvelope` from siblings.
- Produces: `export const registerCliCommand: RegisterCliCommand` registering `run <source-id> <paths...>` with `--dry-run`; auto-discovered by `registerDiscoveredCommands` over `src/cli/`.
- Injection seam for tests: an internal `runSource(...)` accepting injected `loadSourceModule`, `readXlsx`, `runImport`, and `env` so tests avoid real xlsx/DB.

- [ ] **Step 1: Write the failing test**

```ts
// test/cli/run/run-command.test.ts
import { describe, it, expect, vi } from "vitest";
import { runSource } from "../../../src/cli/run/index.js";

const okDeps = {
  sourcesRoot: "/sources",
  loadSourceModule: vi.fn(async () => async () => ({
    artifacts: [
      {
        kind: "Personnel" as const,
        records: {
          "1001": {
            spec: { id: "1001", first_name: "Skip", last_name: "Woodward" },
          },
        },
      },
    ],
  })),
  readXlsx: vi.fn(async () => []),
  writeEnvelope: vi.fn(async () => ({ path: "/ws/artifacts.yaml" })),
  runImport: vi.fn(async () => ({ exitCode: 0, stdout: "ok" })),
  makeWorkspace: vi.fn(async () => "/ws"),
  env: { INTAKE_WORKSPACE: "/ws" },
};

describe("runSource", () => {
  it("loads the module, imports the returned manifest, returns its result", async () => {
    const result = await runSource(
      "gov.azpost.roster",
      ["file.xlsx"],
      { dryRun: true },
      okDeps,
    );
    expect(okDeps.loadSourceModule).toHaveBeenCalledWith(
      "gov.azpost.roster",
      "/sources",
    );
    expect(okDeps.writeEnvelope).toHaveBeenCalled();
    expect(okDeps.runImport).toHaveBeenCalledWith("/ws/artifacts.yaml", {
      dryImport: true,
    });
    expect(result.exitCode).toBe(0);
  });

  it("fails cleanly when no paths are given", async () => {
    const result = await runSource("gov.azpost.roster", [], {}, okDeps);
    expect(result.exitCode).toBe(1);
    expect(okDeps.loadSourceModule).not.toHaveBeenCalled();
  });

  it("returns exit 1 when the module load fails", async () => {
    const deps = {
      ...okDeps,
      loadSourceModule: vi.fn(async () => {
        throw new Error("Unknown source id");
      }),
    };
    const result = await runSource("nope", ["file.xlsx"], {}, deps);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Unknown source id/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run-command`
Expected: FAIL — cannot find module `src/cli/run/index.js`.

- [ ] **Step 3: Implement the command + `runSource`**

```ts
// src/cli/run/index.ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { Artifacts } from "../../shared/io/index.js";
import { createCommandDirectory } from "../command-directory.js";
import { runImportArtifactsCommand } from "../import/artifacts/index.js";
import type {
  CliCommandDependencies,
  CommandResult,
} from "../../shared/cli/types.js";
import { buildArtifactsEnvelope } from "./source-run.js";
import { loadSourceModule } from "./load-source-module.js";
import { readXlsx } from "./read-xlsx.js";

type RunSourceDeps = {
  sourcesRoot: string;
  env: Record<string, string | undefined>;
  loadSourceModule: typeof loadSourceModule;
  readXlsx: typeof readXlsx;
  makeWorkspace: (env: Record<string, string | undefined>) => Promise<string>;
  writeEnvelope: (
    directory: string,
    sourceId: string,
    digest: string,
    manifest: Awaited<ReturnType<Awaited<ReturnType<typeof loadSourceModule>>>>,
  ) => Promise<{ path: string }>;
  runImport: (
    ref: string,
    opts: { dryImport?: boolean },
  ) => Promise<CommandResult>;
};

async function digestOfPaths(paths: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const p of paths) hash.update(await readFile(p));
  return hash.digest("hex").slice(0, 16);
}

export async function runSource(
  sourceId: string,
  paths: string[],
  options: { dryRun?: boolean },
  deps: RunSourceDeps,
): Promise<CommandResult> {
  if (paths.length === 0) {
    return { exitCode: 1, stderr: "intake run requires at least one path\n" };
  }
  let run;
  try {
    run = await deps.loadSourceModule(sourceId, deps.sourcesRoot);
  } catch (error) {
    return {
      exitCode: 1,
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
  try {
    const manifest = await run({ paths, readXlsx: deps.readXlsx });
    const digest = await digestOfPaths(paths);
    const workspace = await deps.makeWorkspace(deps.env);
    const { path: artifactsPath } = await deps.writeEnvelope(
      workspace,
      sourceId,
      digest,
      manifest,
    );
    return await deps.runImport(artifactsPath, { dryImport: options.dryRun });
  } catch (error) {
    return {
      exitCode: 1,
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

export const registerCliCommand = (
  program: Command,
  dependencies: CliCommandDependencies,
): void => {
  program
    .command("run")
    .description("Run a source's config.ts and import the records it returns.")
    .argument("<source-id>", "source id under sources/")
    .argument("<paths...>", "one or more snapshot files or folders")
    .option(
      "--dry-run",
      "Write the DatabaseMutations envelope without applying it",
    )
    .action(
      async (
        sourceId: string,
        paths: string[],
        options: { dryRun?: boolean },
      ) => {
        const env = process.env;
        const deps: RunSourceDeps = {
          sourcesRoot: path.join(process.cwd(), "sources"),
          env,
          loadSourceModule,
          readXlsx,
          makeWorkspace: async (e) =>
            (
              await createCommandDirectory(e, {
                namespace: sourceId,
                args: ["run", sourceId],
              })
            ).commandDirectory,
          writeEnvelope: async (directory, id, digest, manifest) =>
            Artifacts.write(
              directory,
              buildArtifactsEnvelope(id, digest, manifest),
            ),
          runImport:
            dependencies.runImportArtifactsCommand ?? runImportArtifactsCommand,
        };
        dependencies.setResult(await runSource(sourceId, paths, options, deps));
      },
    );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run-command`
Expected: PASS (all three).

- [ ] **Step 5: Verify the command is discovered**

Run: `npm run cli -- run --help`
Expected: usage shows `run <source-id> <paths...>` with `--dry-run`.

- [ ] **Step 6: Commit**

```bash
git add src/cli/run/index.ts test/cli/run/run-command.test.ts
git commit -m "feat: add intake run command that imports a source manifest"
```

---

### Task 5: AZ POST source module

**Files:**

- Create: `sources/gov.azpost.roster/config.ts`
- Test: `test/sources/gov.azpost.roster.test.ts`

**Interfaces:**

- Consumes: `SourceRun`, `RunDeps` types (import type from `../../src/cli/run/source-run.js`).
- Produces: `export const run: SourceRun` — reads each path via injected `readXlsx`, skips rows with empty `POST ID`, dedups by `POST ID` (last row wins), returns one `Personnel` artifact keyed by POST ID (`id`, `first_name`=FIRST, `last_name`=LAST, `middle_name`=MIDDLE or null).

- [ ] **Step 1: Write the failing test**

```ts
// test/sources/gov.azpost.roster.test.ts
import { describe, it, expect } from "vitest";
import { run } from "../../sources/gov.azpost.roster/config.js";

const rows = [
  {
    "POST ID": "1001",
    LAST: "Woodward",
    FIRST: "Skip",
    MIDDLE: "L",
    AGENCY: "Tempe PD",
  },
  {
    "POST ID": "1002",
    LAST: "Denney",
    FIRST: "Marc",
    MIDDLE: "E",
    AGENCY: "Mesa PD",
  },
  {
    "POST ID": "1002",
    LAST: "Denney",
    FIRST: "Marc",
    MIDDLE: "E",
    AGENCY: "Tempe PD",
  },
  {
    "POST ID": "",
    LAST: "Nokey",
    FIRST: "Ann",
    MIDDLE: "",
    AGENCY: "Tempe PD",
  },
];
const fakeReadXlsx = async () => rows;

describe("gov.azpost.roster run", () => {
  it("returns deduped Personnel keyed by POST ID, skipping blank ids", async () => {
    const manifest = await run({ paths: ["a.xlsx"], readXlsx: fakeReadXlsx });
    expect(manifest.artifacts).toHaveLength(1);
    const personnel = manifest.artifacts[0];
    expect(personnel.kind).toBe("Personnel");
    expect(Object.keys(personnel.records).sort()).toEqual(["1001", "1002"]);
    expect(personnel.records["1001"].spec).toEqual({
      id: "1001",
      first_name: "Skip",
      last_name: "Woodward",
      middle_name: "L",
    });
    expect(personnel.records["1002"].spec).toMatchObject({ middle_name: "E" });
  });

  it("is deterministic", async () => {
    expect(await run({ paths: ["a"], readXlsx: fakeReadXlsx })).toEqual(
      await run({ paths: ["a"], readXlsx: fakeReadXlsx }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gov.azpost.roster`
Expected: FAIL — cannot find module `config.js`.

- [ ] **Step 3: Implement the AZ POST run**

```ts
// sources/gov.azpost.roster/config.ts
import type { SourceRun } from "../../src/cli/run/source-run.js";

export const run: SourceRun = async ({ paths, readXlsx }) => {
  const records: Record<string, { spec: unknown }> = {};
  for (const path of paths) {
    for (const row of await readXlsx(path)) {
      const postId = (row["POST ID"] ?? "").trim();
      if (!postId) continue; // filter: no stable id
      const middle = (row["MIDDLE"] ?? "").trim();
      records[postId] = {
        spec: {
          id: postId,
          first_name: (row["FIRST"] ?? "").trim(),
          last_name: (row["LAST"] ?? "").trim(),
          middle_name: middle === "" ? null : middle,
        },
      };
    }
  }
  return { artifacts: [{ kind: "Personnel", records }] };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- gov.azpost.roster`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add sources/gov.azpost.roster/config.ts test/sources/gov.azpost.roster.test.ts
git commit -m "feat: add AZ POST roster source (Personnel by POST ID)"
```

---

### Task 6: End-to-end dry-run + idempotency + verification

**Files:**

- Create: `test/cli/run/run-import.integration.test.ts`
- Modify: `README.md` (command vocabulary)

**Interfaces:**

- Consumes: everything above, exercised through `runIntake` from `src/cli/index.js` (the real CLI entry) against a temp `INTAKE_WORKSPACE` and the sample fixture, `--dry-run` (Personnel-only ⇒ no DB needed).

- [ ] **Step 1: Write the failing integration test**

```ts
// test/cli/run/run-import.integration.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIntake } from "../../../src/cli/index.js";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/azpost/officer-list-sample.xlsx",
);

describe("intake run gov.azpost.roster (dry-run)", () => {
  it("plans Personnel creates without applying", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "intake-run-"));
    const result = await runIntake(
      ["run", "gov.azpost.roster", fixture, "--dry-run"],
      {},
    );
    // process.env.INTAKE_WORKSPACE must be set to `workspace` for the run;
    // set it before invoking (see Step 2 note).
    expect(result.exitCode).toBe(0);
    expect(result.stdout ?? "").toMatch(/DatabaseMutations|records/i);
    void workspace;
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then wire env**

Run: `npm test -- run-import.integration`
Expected: FAIL initially. Set `process.env.INTAKE_WORKSPACE` to the temp dir inside the test (and `process.env.DATABASE_URL` unset is fine for `--dry-run` with Personnel-only). Adjust the test to `beforeEach` assign `process.env.INTAKE_WORKSPACE = workspace`.

- [ ] **Step 3: Make it pass**

Confirm the run writes an `Artifacts` envelope + `Personnel` file under the run workspace and a `DatabaseMutations` envelope under the import command dir, and returns exit 0. Fix any path/discovery issues surfaced.

Run: `npm test -- run-import.integration`
Expected: PASS.

- [ ] **Step 4: Idempotency check (manual, documented)**

Run the same command twice against the same fixture with a persistent `INTAKE_WORKSPACE`:

```bash
INTAKE_WORKSPACE=/tmp/intake-idem npm run cli -- run gov.azpost.roster test/fixtures/azpost/officer-list-sample.xlsx --dry-run
INTAKE_WORKSPACE=/tmp/intake-idem npm run cli -- run gov.azpost.roster test/fixtures/azpost/officer-list-sample.xlsx --dry-run
```

Expected: the second run is stopped by the existing-import guard (same `(namespace, name)` derived from the identical snapshot digest), not a conflicting re-import.

- [ ] **Step 5: Update README command vocabulary**

Add to `README.md` under the CLI vocabulary:

```bash
intake run <source-id> <path...> [--dry-run]
```

with one line: "Run a source's `config.ts`, which returns an `Artifacts` manifest, and import it via the existing pipeline."

- [ ] **Step 6: Full validation**

Run: `npm run validate`
Expected: PASS (format:check, lint/typecheck, vitest, build, openspec:validate).

- [ ] **Step 7: Commit**

```bash
git add test/cli/run/run-import.integration.test.ts README.md
git commit -m "test: end-to-end intake run dry-run for AZ POST; document command"
```

---

## Self-Review

- **Spec coverage:** Command (Task 4/6), source-module-returns-manifest contract (Tasks 4–5), DI/no-locator (Task 4 injects only `readXlsx`; `run` gets `{paths, readXlsx}`), deterministic parse + unreadable-fails-early (Task 1 + import pipeline), identity from record key (Task 5 keys by POST ID; existing pipeline mints cuid2), kind-agnostic + additive + envelope-validated (Task 2 builder throws on invalid; Task 5 emits only Personnel; absence never deletes because only present rows are emitted), reuse existing pipeline + DatabaseMutations change record (Task 4 calls `runImportArtifactsCommand`; Task 6 asserts it). All spec requirements map to a task.
- **Deferred, not gaps:** Agencies/AgencyPersonnel from AZ POST; workspace/state injection; inline-vs-file manifest (inline chosen); `sources/` compile-into-dist (CLI runs via tsx for Slice 1). Recorded in `tasks.md` Deferred.
- **Confirm-before-coding:** the `exceljs` dependency choice (Task 1). If rejected, swap the single `read-xlsx.ts` adapter; no other file changes.
- **Type consistency:** `SourceManifest`/`RunDeps`/`SourceRun` defined in Task 2 are the exact types imported in Tasks 3–5; `readXlsx` signature matches across Tasks 1, 4, 5; `runImportArtifactsCommand(ref, {dryImport})` matches the real signature in `src/cli/import/artifacts/index.ts`.
