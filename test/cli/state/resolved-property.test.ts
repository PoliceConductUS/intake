import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import {
  readResolvedProperty,
  type ResolvedPropertyCacheInput,
  resolvedPropertyCacheName,
  typedInputFingerprint,
  writeResolvedProperty,
} from "../../../src/cli/state/resolved-property/index.js";
import { ResolvedProperty } from "../../../src/cli/state/resolved-property/ResolvedProperty.js";

async function createTempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "intake-resolved-property-"));
}

describe("ResolvedProperty state", () => {
  test("derives cache name from canonical subject identity and target property", () => {
    const inputFingerprint = typedInputFingerprint({
      address: "444 Cedar Street",
      city: "Saint Paul",
      state: "MN",
      zipCode: "55101",
    });

    expect(
      resolvedPropertyCacheName({
        subject: {
          apiVersion: INTAKE_API_VERSION,
          kind: "Agency",
          name: "agency-canonical-id",
        },
        targetProperty: "latitude",
        source: {
          namespace: "mn-post",
          kind: "Agency",
          name: "agency-source-id",
          inputFingerprint,
        },
      }),
    ).toBe(
      [INTAKE_API_VERSION, "Agency", "agency-canonical-id", "latitude"].join(
        ":",
      ),
    );
  });

  test("writes and reads a ResolvedProperty envelope from intake-owned state", async () => {
    const rootDir = await createTempRoot();
    const inputFingerprint = typedInputFingerprint({
      address: "444 Cedar Street",
      city: "Saint Paul",
      state: "MN",
      zipCode: "55101",
    });
    const cacheInput = {
      subject: {
        apiVersion: INTAKE_API_VERSION,
        kind: "Agency",
        name: "agency-canonical-id",
      },
      targetProperty: "latitude",
      source: {
        namespace: "mn-post",
        kind: "Agency",
        name: "agency-source-id",
        inputFingerprint,
      },
    } satisfies ResolvedPropertyCacheInput;

    await writeResolvedProperty({
      rootDir,
      ...cacheInput,
      value: 44.955097,
    });

    await expect(
      readResolvedProperty({
        rootDir,
        ...cacheInput,
      }),
    ).resolves.toEqual(44.955097);

    const fileNames = await readdir(
      path.join(
        rootDir,
        "intake",
        "state",
        "namespaces",
        "intake",
        "ResolvedProperty",
      ),
    );
    expect(fileNames).toEqual([
      `${encodeURIComponent(
        resolvedPropertyCacheName(cacheInput),
      )}.ResolvedProperty.yaml`,
    ]);
  });

  test("merges source evidence by source namespace and rejects conflicting values", async () => {
    const rootDir = await createTempRoot();
    const cacheInput = {
      subject: {
        apiVersion: INTAKE_API_VERSION,
        kind: "Personnel",
        name: "personnel-canonical-id",
      },
      targetProperty: "slug",
    } satisfies ResolvedPropertyCacheInput;

    await writeResolvedProperty({
      rootDir,
      ...cacheInput,
      source: {
        namespace: "mn-post",
        kind: "Personnel",
        name: "mn-source-personnel-id",
        inputFingerprint: typedInputFingerprint({ firstName: "Ada" }),
      },
      value: "ada-lovelace-icalid",
    });
    await writeResolvedProperty({
      rootDir,
      ...cacheInput,
      source: {
        namespace: "city-payroll",
        kind: "Personnel",
        name: "payroll-source-personnel-id",
        inputFingerprint: typedInputFingerprint({ firstName: "Ada" }),
      },
      value: "ada-lovelace-icalid",
    });

    const envelope = await ResolvedProperty.read(
      path.join(
        rootDir,
        "intake",
        "state",
        "namespaces",
        "intake",
        "ResolvedProperty",
        `${encodeURIComponent(
          resolvedPropertyCacheName(cacheInput),
        )}.ResolvedProperty.yaml`,
      ),
    );
    expect(envelope.spec.sources).toEqual({
      "city-payroll": {
        kind: "Personnel",
        name: "payroll-source-personnel-id",
        inputFingerprint: typedInputFingerprint({ firstName: "Ada" }),
      },
      "mn-post": {
        kind: "Personnel",
        name: "mn-source-personnel-id",
        inputFingerprint: typedInputFingerprint({ firstName: "Ada" }),
      },
    });

    await expect(
      writeResolvedProperty({
        rootDir,
        ...cacheInput,
        source: {
          namespace: "state-certification",
          kind: "Personnel",
          name: "certification-source-personnel-id",
          inputFingerprint: typedInputFingerprint({ firstName: "Ada" }),
        },
        value: "ada-lovelace-other",
      }),
    ).rejects.toThrow(
      "ResolvedProperty policeconduct.org/intake/v1alpha1:Personnel:personnel-canonical-id:slug already has a different value.",
    );
  });

  test("returns undefined when no matching ResolvedProperty envelope exists", async () => {
    const rootDir = await createTempRoot();

    await expect(
      readResolvedProperty({
        rootDir,
        subject: {
          apiVersion: INTAKE_API_VERSION,
          kind: "Agency",
          name: "agency-canonical-id",
        },
        targetProperty: "longitude",
      }),
    ).resolves.toBeUndefined();
  });
});
