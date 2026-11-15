import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertGeneratedSchemaCurrent } from "../../src/cli/import/artifacts/assert-schema-current.js";
import { GENERATED_MIGRATION_VERSIONS } from "../../src/shared/io/generated/entity-specs.js";

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

function migrationVersionsOnDisk(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.match(/^(\d+)_/)?.[1])
    .filter((version): version is string => version !== undefined)
    .sort();
}

const applied = (versions: readonly string[]) =>
  versions.map((version) => ({ version }));

describe("assertGeneratedSchemaCurrent (drift guard behavior)", () => {
  // The expected input here is not the point — the point is that the guard
  // accepts a set matching the fingerprint the specs were generated against.
  it("passes when the applied migrations match the generated fingerprint", () => {
    expect(() =>
      assertGeneratedSchemaCurrent(applied(GENERATED_MIGRATION_VERSIONS)),
    ).not.toThrow();
  });

  // These feed a *mismatched* set — an independent, deliberately-wrong oracle —
  // and prove the guard actually detects drift rather than rubber-stamping.
  it("throws when a migration is missing (DB behind the specs)", () => {
    expect(() =>
      assertGeneratedSchemaCurrent(
        applied(GENERATED_MIGRATION_VERSIONS.slice(0, -1)),
      ),
    ).toThrow(/out of sync/i);
  });

  it("throws when an unexpected migration is present (DB ahead of the specs)", () => {
    expect(() =>
      assertGeneratedSchemaCurrent(
        applied([...GENERATED_MIGRATION_VERSIONS, "29999999999999"]),
      ),
    ).toThrow(/out of sync/i);
  });

  it("throws when a version differs", () => {
    const swapped: string[] = [...GENERATED_MIGRATION_VERSIONS];
    swapped[0] = "00000000000000";
    expect(() => assertGeneratedSchemaCurrent(applied(swapped))).toThrow(
      /out of sync/i,
    );
  });

  it("throws when the order differs (the fingerprint is order-sensitive)", () => {
    const reordered = [
      GENERATED_MIGRATION_VERSIONS[1],
      GENERATED_MIGRATION_VERSIONS[0],
      ...GENERATED_MIGRATION_VERSIONS.slice(2),
    ];
    expect(() => assertGeneratedSchemaCurrent(applied(reordered))).toThrow(
      /out of sync/i,
    );
  });
});

describe("generated schema fingerprint tripwire", () => {
  // Independent oracle: the migration files on disk. If a migration is added or
  // removed without running `npm run generate:envelope-types`, the committed
  // constants drift from the actual migration set and this fails — the expected
  // failure that forces a conscious regenerate, which the constant-importing
  // tests can never produce.
  it("matches the migration files committed to the repo", () => {
    expect(migrationVersionsOnDisk()).toEqual([
      ...GENERATED_MIGRATION_VERSIONS,
    ]);
  });
});
