import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, "src");
const testRoot = path.join(repoRoot, "test");

async function existingFiles(directory: string): Promise<string[]> {
  const directoryStat = await stat(directory).catch(() => undefined);
  if (directoryStat?.isDirectory() !== true) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return existingFiles(entryPath);
      }
      return [entryPath];
    }),
  );
  return files.flat();
}

function relative(filePath: string): string {
  return path.relative(repoRoot, filePath);
}

describe("architecture boundaries", () => {
  test("does not use generic envelope IO runtime modules", async () => {
    const files = await existingFiles(sourceRoot);
    const sourceFiles = files.filter((file) => /\.[cm]?tsx?$/.test(file));
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const contents = await readFile(file, "utf8");
      if (
        contents.includes("createEnvelopeType") ||
        contents.includes("defaultEnvelopeFormatError") ||
        contents.includes("readImportArtifactEnvelope") ||
        contents.includes("writeImportArtifactEnvelope") ||
        contents.includes("shared/io/runtime.js") ||
        contents.includes("shared/io/import-artifact.js")
      ) {
        violations.push(relative(file));
      }
    }

    expect(violations).toEqual([]);
  });

  test("does not restore legacy import bucket or junk drawer file names", async () => {
    const files = await existingFiles(sourceRoot);
    const violations = files
      .map(relative)
      .filter(
        (file) =>
          file.startsWith("src/import/") ||
          /(^|\/)(utils|helpers)\.[cm]?tsx?$/.test(file),
      );

    expect(violations).toEqual([]);
  });

  test("keeps database code independent from envelope IO", async () => {
    const files = (await existingFiles(sourceRoot)).filter((file) =>
      /(^|\/)database[^/]*\.[cm]?tsx?$/.test(relative(file)),
    );
    const violations: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, "utf8");
      if (
        contents.includes("shared/io") ||
        contents.includes("/io/") ||
        contents.includes("Envelope")
      ) {
        violations.push(relative(file));
      }
    }

    expect(violations).toEqual([]);
  });

  test("keeps database package ownership out of command feature folders", async () => {
    const files = await existingFiles(sourceRoot);
    const violations = files
      .map(relative)
      .filter(
        (file) =>
          file.startsWith("src/cli/") &&
          !file.startsWith("src/cli/database/") &&
          /(^|\/)database[^/]*\.[cm]?tsx?$/.test(file),
      );

    expect(violations).toEqual([]);
  });

  test("keeps postgres client construction inside the database package", async () => {
    const files = await existingFiles(sourceRoot);
    const sourceFiles = files.filter((file) => /\.[cm]?tsx?$/.test(file));
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const contents = await readFile(file, "utf8");
      if (
        !relative(file).startsWith("src/cli/database/") &&
        /from "pg"|from 'pg'/.test(contents)
      ) {
        violations.push(relative(file));
      }
    }

    expect(violations).toEqual([]);
  });

  test("keeps migration schema reads inside the database package", async () => {
    const files = await existingFiles(sourceRoot);
    const sourceFiles = files.filter((file) => /\.[cm]?tsx?$/.test(file));
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const fileName = relative(file);
      const contents = await readFile(file, "utf8");
      if (
        !fileName.startsWith("src/cli/database/") &&
        contents.includes("supabase_migrations.schema_migrations")
      ) {
        violations.push(fileName);
      }
    }

    expect(violations).toEqual([]);
  });

  test("keeps database table read SQL inside the database package", async () => {
    const files = await existingFiles(sourceRoot);
    const sourceFiles = files.filter((file) => /\.[cm]?tsx?$/.test(file));
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const fileName = relative(file);
      const contents = await readFile(file, "utf8");
      if (
        !fileName.startsWith("src/cli/database/") &&
        (contents.includes("from public.location_path") ||
          contents.includes("from public.location_path_alias"))
      ) {
        violations.push(fileName);
      }
    }

    expect(violations).toEqual([]);
  });

  test("keeps database entity read SQL inside the database package", async () => {
    const files = await existingFiles(sourceRoot);
    const sourceFiles = files.filter((file) => /\.[cm]?tsx?$/.test(file));
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const fileName = relative(file);
      const contents = await readFile(file, "utf8");
      if (
        !fileName.startsWith("src/cli/database/") &&
        (contents.includes("from public.agency") ||
          contents.includes("from public.officers") ||
          contents.includes("from public.agency_officers") ||
          contents.includes("select * from ${tableName}") ||
          contents.includes("select id, slug from ${tableName}"))
      ) {
        violations.push(fileName);
      }
    }

    expect(violations).toEqual([]);
  });

  test("keeps database write SQL inside the database package", async () => {
    const files = await existingFiles(sourceRoot);
    const sourceFiles = files.filter((file) => /\.[cm]?tsx?$/.test(file));
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const fileName = relative(file);
      const contents = await readFile(file, "utf8");
      if (
        !fileName.startsWith("src/cli/database/") &&
        (contents.includes("insert into public.") ||
          contents.includes("update public."))
      ) {
        violations.push(fileName);
      }
    }

    expect(violations).toEqual([]);
  });

  test("keeps import operation classification out of the write pass", async () => {
    const filePath = path.join(
      sourceRoot,
      "cli",
      "import",
      "artifacts",
      "config.ts",
    );
    const contents = await readFile(filePath, "utf8");

    // Create-vs-read/update is decided by each facade's own current-row read at
    // mutation time (ADR 0019), never by a separate operation-classification pass.
    expect(contents).not.toContain(
      "function resolvePreparedDatabaseOperations",
    );
    expect(contents).not.toContain("function rowExists");
    expect(contents).not.toContain("classifyDatabaseOperations");
  });

  test("implements import artifacts as named pipeline stages", async () => {
    const filePath = path.join(
      sourceRoot,
      "cli",
      "import",
      "artifacts",
      "config.ts",
    );
    const contents = await readFile(filePath, "utf8");

    expect(contents).toContain("type ImportArtifactsPipelineContext");
    expect(contents).toContain("type ImportArtifactsPipelineStage");
    expect(contents).toContain("const importArtifactsPipelineStages");
    for (const stageName of [
      "readArtifactsStage",
      "rejectExistingImportStage",
      "applyArtifactMutationsStage",
      "transformArtifactsStage",
      "writeDatabaseMutationsStage",
    ]) {
      expect(contents).toContain(stageName);
    }
  });

  test("isolates failed DatabaseMutationsDebug writing to a dedicated helper", async () => {
    const filePath = path.join(
      sourceRoot,
      "cli",
      "import",
      "artifacts",
      "config.ts",
    );
    const contents = await readFile(filePath, "utf8");
    const helperStart = contents.indexOf(
      "async function writeFailedDatabaseMutationsDebugEnvelope",
    );
    const helperEnd = contents.indexOf("\nasync function ", helperStart + 1);
    const helper = contents.slice(helperStart, helperEnd);

    // The debug envelope is written only by the dedicated failure helper — never
    // inline in the success/emit path.
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helper).toContain("DatabaseMutationsDebug.write");
    expect(contents.split("DatabaseMutationsDebug.write").length - 1).toBe(1);
    expect(contents.split("DatabaseMutationsDebug.new").length - 1).toBe(1);
  });

  test("keeps DatabaseMutations assembly on DataContext and exact kind IO", async () => {
    const configPath = path.join(
      sourceRoot,
      "cli",
      "import",
      "artifacts",
      "config.ts",
    );
    const config = await readFile(configPath, "utf8");
    const files = await existingFiles(path.join(sourceRoot, "cli", "import"));
    const violations: string[] = [];

    for (const file of files) {
      const fileName = relative(file);
      const contents = await readFile(file, "utf8");
      if (
        fileName.endsWith("mutations-input.ts") ||
        contents.includes("databaseMutationsInput") ||
        contents.includes("mutations-input")
      ) {
        violations.push(fileName);
      }
    }

    expect(config).toContain(".toDatabaseMutations(");
    expect(violations).toEqual([]);
  });

  test("keeps required-field validation in generated envelope IO", async () => {
    const filePath = path.join(
      sourceRoot,
      "cli",
      "import",
      "artifacts",
      "config.ts",
    );
    const contents = await readFile(filePath, "utf8");

    expect(contents).not.toContain("missingRequiredColumns");
    expect(contents).not.toContain("missing required non-dynamic");
    expect(contents).not.toContain("requiredInsertColumns");
  });

  test("keeps the import artifact write pass free of database writes", async () => {
    const filePath = path.join(
      sourceRoot,
      "cli",
      "import",
      "artifacts",
      "config.ts",
    );
    const contents = await readFile(filePath, "utf8");

    // The write pass only reads (schema, location paths, current rows); records
    // are created/updated later by the separate replay client.
    expect(contents).not.toContain("createMissingLocationPathRecords");
    expect(contents).not.toContain("createOrUpdateOwnedDatabaseRecord");
    expect(contents).not.toContain('query("commit")');
  });

  test("keeps import artifact stages on narrow adapters instead of DataContext reach-through", async () => {
    const stageFiles = [
      path.join(
        sourceRoot,
        "cli",
        "import",
        "artifacts",
        "agency-address-resolution.ts",
      ),
    ];
    const violations: string[] = [];

    for (const file of stageFiles) {
      const contents = await readFile(file, "utf8");
      if (
        contents.includes("DataContext") ||
        contents.includes(".toImportRows()") ||
        contents.includes(".locationPaths.") ||
        contents.includes(".locations.")
      ) {
        violations.push(relative(file));
      }
    }

    expect(violations).toEqual([]);
  });


  test("keeps source artifact facade construction on DataContext", async () => {
    const filePath = path.join(
      sourceRoot,
      "cli",
      "import",
      "artifacts",
      "config.ts",
    );
    const contents = await readFile(filePath, "utf8");

    expect(contents).not.toContain("addAgencySourceFacades");
    expect(contents).not.toContain("dataContext.fromSource(");
  });

  test("does not create location paths as a side effect of entity resolution", async () => {
    const filePath = path.join(
      sourceRoot,
      "cli",
      "import",
      "artifacts",
      "data-context.ts",
    );
    const contents = await readFile(filePath, "utf8");

    expect(contents).not.toContain("getOrCreatePlace");
    expect(contents).not.toContain("Cannot create location_path_id");
    expect(contents).not.toContain("Prepared import location path.");
  });

  test("keeps root intake state features out of command feature folders", async () => {
    const files = await existingFiles(sourceRoot);
    const violations = files
      .map(relative)
      .filter((file) =>
        /^src\/cli\/import\/artifacts\/.*SourceNameToCanonicalId/.test(file),
      );

    expect(violations).toEqual([]);
  });

  test("uses namespace-first intake state folders", async () => {
    const files = await existingFiles(sourceRoot);
    const sourceFiles = files.filter((file) => /\.[cm]?tsx?$/.test(file));
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const contents = await readFile(file, "utf8");
      if (contents.includes('"shared-mutations"')) {
        violations.push(relative(file));
      }
    }

    expect(violations).toEqual([]);
  });

  test("keeps ResolvedProperty IO behind import pipeline cache boundaries", async () => {
    const files = await existingFiles(sourceRoot);
    const sourceFiles = files.filter((file) => /\.[cm]?tsx?$/.test(file));
    const allowed = new Set([
      "src/cli/import/artifacts/config.ts",
      "src/cli/state/resolved-property/ResolvedProperty.ts",
      "src/cli/state/resolved-property/index.ts",
    ]);
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const contents = await readFile(file, "utf8");
      if (
        (contents.includes("readResolvedProperty") ||
          contents.includes("writeResolvedProperty")) &&
        !allowed.has(relative(file))
      ) {
        violations.push(relative(file));
      }
    }

    expect(violations).toEqual([]);
  });

  test("keeps command tests under their command path", async () => {
    const files = await existingFiles(testRoot);
    const violations = files
      .map(relative)
      .filter((file) => file === "test/import-database.test.ts");

    expect(violations).toEqual([]);
  });
});
