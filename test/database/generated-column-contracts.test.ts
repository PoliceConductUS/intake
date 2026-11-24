import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import { afterAll, beforeAll, expect, test } from "vitest";
import { introspectSchema } from "../../scripts/lib/schema-introspection.js";
import {
  ENTITY_TABLES,
  generateEntitySpecsModule,
} from "../../scripts/lib/entity-spec-generator.js";
import { generateDataRequestDoc } from "../../scripts/lib/data-request-doc-generator.js";
import {
  startIntakeDatabase,
  type IntakeDatabase,
} from "../cli/database/intake-postgres.js";

let database: IntakeDatabase;
beforeAll(async () => {
  database = await startIntakeDatabase();
}, 180000);
afterAll(async () => {
  await database?.stop();
});

test("generated place level is excluded from writable schema metadata and provider requests", async () => {
  const schema = await introspectSchema(
    database.connectionString,
    ENTITY_TABLES,
  );
  const agency = schema.tables.get("agency")!;
  expect(agency.columns.map((column) => column.name)).not.toContain(
    "location_path_level",
  );
  expect(
    agency.foreignKeys.filter((key) => key.targetTable === "location_path"),
  ).toEqual([{ column: "location_path_id", targetTable: "location_path" }]);
  expect(schema.tables.get("location_path")!.uniqueKeys).toEqual([["path"]]);
  expect(generateDataRequestDoc(schema, "", "", "")).not.toContain(
    "location_path_level",
  );
});

test("generated agency record and create schemas reject the database-owned column", async () => {
  const schema = await introspectSchema(
    database.connectionString,
    ENTITY_TABLES,
  );
  const directory = mkdtempSync(
    fileURLToPath(
      new URL("../../src/shared/.generated-contract-", import.meta.url),
    ),
  );
  let exports: Record<string, any>;
  try {
    const file = join(directory, "entity-specs.ts");
    writeFileSync(file, generateEntitySpecsModule(schema, ""));
    exports = await tsImport(pathToFileURL(file).href, import.meta.url);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  for (const name of ["AgencySpec", "AgencyCreateSpec"]) {
    const spec = exports[name];
    expect(Object.hasOwn(spec.shape, "location_path_level")).toBe(false);
    const parsed = spec.safeParse({ location_path_level: "place" });
    expect(parsed.success).toBe(false);
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({
        code: "unrecognized_keys",
        keys: ["location_path_level"],
      }),
    );
  }
  expect(
    exports.FK_REFERENCES.Agency.filter(
      (ref: { targetKind: string }) => ref.targetKind === "LocationPath",
    ),
  ).toEqual([{ field: "location_path_id", targetKind: "LocationPath" }]);
});
