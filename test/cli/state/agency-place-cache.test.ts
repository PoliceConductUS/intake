import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { INTAKE_API_VERSION } from "../../../src/shared/io/import-types.js";
import {
  readResolvedProperty,
  writeResolvedProperty,
  resolvedPropertyCacheName,
  type ResolvedPropertyCacheInput,
} from "../../../src/cli/state/resolved-property/index.js";
import { ResolvedProperty } from "../../../src/cli/state/resolved-property/ResolvedProperty.js";
const createTempRoot = () =>
  mkdtemp(path.join(tmpdir(), "agency-place-cache-"));
describe("agency location cache validation", () => {
  const input = {
    subject: {
      apiVersion: INTAKE_API_VERSION,
      kind: "Agency",
      name: "agency-id",
    },
    targetProperty: "location_path_id",
  } satisfies ResolvedPropertyCacheInput;
  const placeLookup = async () => ({
    location_path_id: "location-id",
    level: "place",
  });
  for (const level of [
    "state",
    "administrative_area",
    "missing",
    "unverified",
  ] as const) {
    const getLocationPathById =
      level === "unverified"
        ? undefined
        : async () =>
            level === "missing"
              ? undefined
              : { location_path_id: "location-id", level };
    test(`rejects ${level} manual cache writes`, async () => {
      const rootDir = await createTempRoot();
      await expect(
        writeResolvedProperty({
          ...input,
          rootDir,
          value: "location-id",
          getLocationPathById,
        }),
      ).rejects.toThrow(/must.*place/i);
      await expect(
        readResolvedProperty({
          ...input,
          rootDir,
          getLocationPathById: placeLookup,
        }),
      ).resolves.toBeUndefined();
    });
    test(`rejects ${level} direct envelope updates and reads`, async () => {
      const rootDir = await createTempRoot();
      const envelope = ResolvedProperty.new({
        metadata: {
          name: resolvedPropertyCacheName(input),
          namespace: "intake",
        },
        spec: { ...input, entries: [{ value: "location-id" }] },
      });
      const saved = await ResolvedProperty.write(rootDir, envelope, {
        getLocationPathById: placeLookup,
      });
      await expect(
        ResolvedProperty.write(rootDir, envelope, { getLocationPathById }),
      ).rejects.toThrow(/must.*place/i);
      await expect(
        ResolvedProperty.read(saved.path, { getLocationPathById }),
      ).rejects.toThrow(/must.*place/i);
      await expect(
        ResolvedProperty.read(saved.path, { getLocationPathById: placeLookup }),
      ).resolves.toEqual(envelope);
    });
    test(`rejects ${level} cache reads`, async () => {
      const rootDir = await createTempRoot();
      await writeResolvedProperty({
        ...input,
        rootDir,
        value: "location-id",
        getLocationPathById: placeLookup,
      });
      await expect(
        readResolvedProperty({ ...input, rootDir, getLocationPathById }),
      ).rejects.toThrow(/must.*place/i);
    });
  }
  test("writes and reads a verified place", async () => {
    const rootDir = await createTempRoot();
    await writeResolvedProperty({
      ...input,
      rootDir,
      value: "location-id",
      getLocationPathById: placeLookup,
    });
    await expect(
      readResolvedProperty({
        ...input,
        rootDir,
        getLocationPathById: placeLookup,
      }),
    ).resolves.toBe("location-id");
  });
});
