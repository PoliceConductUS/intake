import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import {
  readResolvedProperty,
  type ResolvedPropertyCacheInput,
  resolvedPropertyCacheName,
  seedResolvedPropertyCache,
  typedInputFingerprint,
  writeResolvedProperty,
} from "../../../src/cli/state/resolved-property/index.js";
import { ResolvedProperty } from "../../../src/cli/state/resolved-property/ResolvedProperty.js";

async function createTempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "intake-resolved-property-"));
}

const subject = {
  apiVersion: INTAKE_API_VERSION,
  kind: "Agency",
  name: "agency-canonical-id",
} as const;

const stPaul = typedInputFingerprint({
  address: "444 Cedar Street",
  city: "Saint Paul",
  state: "MN",
  zipCode: "55101",
});
const duluth = typedInputFingerprint({
  address: "411 West First Street",
  city: "Duluth",
  state: "MN",
  zipCode: "55802",
});

function cacheFilePath(rootDir: string): string {
  return path.join(
    rootDir,
    "state",
    "intake",
    "namespaces",
    "intake",
    "ResolvedProperty",
    `${encodeURIComponent(
      resolvedPropertyCacheName({ subject, targetProperty: "latitude" }),
    )}.ResolvedProperty.yaml`,
  );
}

describe("ResolvedProperty state", () => {
  test("derives cache name from canonical subject identity and target property (not the input)", () => {
    // The file is one per (subject, property); the fingerprint keys entries
    // inside it, so it must NOT appear in the name.
    expect(
      resolvedPropertyCacheName({ subject, targetProperty: "latitude" }),
    ).toBe(
      [INTAKE_API_VERSION, "Agency", "agency-canonical-id", "latitude"].join(
        ":",
      ),
    );
  });

  test("reads back the value written for a given input fingerprint", async () => {
    const rootDir = await createTempRoot();
    const input = {
      subject,
      targetProperty: "latitude",
      inputFingerprint: stPaul,
    } satisfies ResolvedPropertyCacheInput;

    await writeResolvedProperty({ rootDir, ...input, value: 44.955097 });

    await expect(readResolvedProperty({ rootDir, ...input })).resolves.toEqual(
      44.955097,
    );
    expect(await readdir(path.dirname(cacheFilePath(rootDir)))).toEqual([
      path.basename(cacheFilePath(rootDir)),
    ]);
  });

  test("a different input fingerprint misses (re-resolve); the original still hits", async () => {
    const rootDir = await createTempRoot();
    const base = { subject, targetProperty: "latitude" } as const;
    await writeResolvedProperty({
      rootDir,
      ...base,
      inputFingerprint: stPaul,
      value: 44.955097,
    });

    // The address changed → new fingerprint → no entry → miss.
    await expect(
      readResolvedProperty({ rootDir, ...base, inputFingerprint: duluth }),
    ).resolves.toBeUndefined();
    // The unchanged address still hits.
    await expect(
      readResolvedProperty({ rootDir, ...base, inputFingerprint: stPaul }),
    ).resolves.toEqual(44.955097);
  });

  test("keeps N entries — one value per distinct input — in a single file", async () => {
    const rootDir = await createTempRoot();
    const base = { subject, targetProperty: "latitude" } as const;
    await writeResolvedProperty({
      rootDir,
      ...base,
      inputFingerprint: stPaul,
      value: 44.955097,
    });
    await writeResolvedProperty({
      rootDir,
      ...base,
      inputFingerprint: duluth,
      value: 46.783329,
    });

    await expect(
      readResolvedProperty({ rootDir, ...base, inputFingerprint: stPaul }),
    ).resolves.toEqual(44.955097);
    await expect(
      readResolvedProperty({ rootDir, ...base, inputFingerprint: duluth }),
    ).resolves.toEqual(46.783329);

    const envelope = await ResolvedProperty.read(cacheFilePath(rootDir));
    expect(envelope.spec.entries).toEqual([
      { inputFingerprint: stPaul, value: 44.955097 },
      { inputFingerprint: duluth, value: 46.783329 },
    ]);
    expect(envelope.spec.value).toBeUndefined();
  });

  test("records per-entry provenance and merges a second source that agrees", async () => {
    const rootDir = await createTempRoot();
    const base = {
      subject,
      targetProperty: "latitude",
      inputFingerprint: stPaul,
    } as const;

    await writeResolvedProperty({
      rootDir,
      ...base,
      value: 44.955097,
      source: { namespace: "mn-post", kind: "Agency", name: "mn-source-id" },
    });
    await writeResolvedProperty({
      rootDir,
      ...base,
      value: 44.955097,
      source: {
        namespace: "city-payroll",
        kind: "Agency",
        name: "payroll-source-id",
      },
    });

    const envelope = await ResolvedProperty.read(cacheFilePath(rootDir));
    expect(envelope.spec.entries).toEqual([
      {
        inputFingerprint: stPaul,
        value: 44.955097,
        sources: {
          "mn-post": { kind: "Agency", name: "mn-source-id" },
          "city-payroll": { kind: "Agency", name: "payroll-source-id" },
        },
      },
    ]);
  });

  test("rejects a different value for the same input (a resolver must be deterministic)", async () => {
    const rootDir = await createTempRoot();
    const base = {
      subject,
      targetProperty: "latitude",
      inputFingerprint: stPaul,
    } as const;
    await writeResolvedProperty({ rootDir, ...base, value: 44.955097 });

    await expect(
      writeResolvedProperty({ rootDir, ...base, value: 44.955098 }),
    ).rejects.toThrow("already has a different value for the same input");
  });

  test("adopts a legacy value under the current fingerprint on first read, then honors it", async () => {
    const rootDir = await createTempRoot();
    const base = { subject, targetProperty: "latitude" } as const;
    // A pre-`entries` seed: a bare value with no fingerprint.
    await ResolvedProperty.write(
      path.dirname(cacheFilePath(rootDir)),
      ResolvedProperty.new({
        metadata: {
          name: resolvedPropertyCacheName(base),
          namespace: "intake",
        },
        spec: { ...base, value: 44.955097 },
      }),
    );

    // First read under the current input serves the legacy value...
    await expect(
      readResolvedProperty({ rootDir, ...base, inputFingerprint: stPaul }),
    ).resolves.toEqual(44.955097);
    // ...and migrates the file so the value is now keyed by that fingerprint.
    const migrated = await ResolvedProperty.read(cacheFilePath(rootDir));
    expect(migrated.spec.entries).toEqual([
      { inputFingerprint: stPaul, value: 44.955097 },
    ]);
    expect(migrated.spec.value).toBeUndefined();
    // A later, changed input now misses (the invariant holds post-adoption).
    await expect(
      readResolvedProperty({ rootDir, ...base, inputFingerprint: duluth }),
    ).resolves.toBeUndefined();
  });

  test("returns undefined when no ResolvedProperty file exists", async () => {
    const rootDir = await createTempRoot();

    await expect(
      readResolvedProperty({
        rootDir,
        subject,
        targetProperty: "longitude",
        inputFingerprint: stPaul,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("seedResolvedPropertyCache", () => {
  const base = { subject, targetProperty: "latitude" } as const;

  async function writeSeedFile(seedDir: string, value: number): Promise<void> {
    await ResolvedProperty.write(
      seedDir,
      ResolvedProperty.new({
        metadata: {
          name: resolvedPropertyCacheName(base),
          namespace: "intake",
        },
        spec: { ...base, value },
      }),
    );
  }

  test("copies an absent legacy seed so it reads as a hit for the current input", async () => {
    const rootDir = await createTempRoot();
    const seedDir = await mkdtemp(path.join(tmpdir(), "intake-seed-"));
    await writeSeedFile(seedDir, 29.7110641);

    const result = await seedResolvedPropertyCache(seedDir, rootDir);

    expect(result.seeded).toEqual([path.basename(cacheFilePath(rootDir))]);
    expect(result.skipped).toEqual([]);
    await expect(
      readResolvedProperty({ rootDir, ...base, inputFingerprint: stPaul }),
    ).resolves.toEqual(29.7110641);
  });

  test("leaves an existing cache entry untouched — whatever is on disk wins", async () => {
    const rootDir = await createTempRoot();
    const seedDir = await mkdtemp(path.join(tmpdir(), "intake-seed-"));
    await writeResolvedProperty({
      rootDir,
      ...base,
      inputFingerprint: stPaul,
      value: 1.111,
    });
    await writeSeedFile(seedDir, 2.222);

    const result = await seedResolvedPropertyCache(seedDir, rootDir);

    expect(result.seeded).toEqual([]);
    expect(result.skipped).toEqual([path.basename(cacheFilePath(rootDir))]);
    await expect(
      readResolvedProperty({ rootDir, ...base, inputFingerprint: stPaul }),
    ).resolves.toEqual(1.111);
  });

  test("is a no-op when the seed directory does not exist", async () => {
    const rootDir = await createTempRoot();

    await expect(
      seedResolvedPropertyCache(
        path.join(rootDir, "no-such-seed-dir"),
        rootDir,
      ),
    ).resolves.toEqual({ seeded: [], skipped: [] });
  });
});
