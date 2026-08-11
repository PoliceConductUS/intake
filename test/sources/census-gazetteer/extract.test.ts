import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractShapefileFromZip } from "../../../sources/census-gazetteer/lib/extract.js";

/**
 * New coverage for the Task 4 rewire helper (no equivalent existed in the
 * original standalone producer, which received already-extracted shapefile
 * paths from its own archive-extraction plumbing — see
 * `tiger-hierarchy.ts`'s file comment).
 */

const countyZip = fileURLToPath(
  new URL("./fixtures/tiger/tl_2025_us_county.zip", import.meta.url),
);

let state: string;

beforeEach(async () => {
  state = await mkdtemp(path.join(tmpdir(), "extract-test-"));
});

afterEach(async () => {
  await rm(state, { recursive: true, force: true });
});

describe("extractShapefileFromZip", () => {
  it("extracts .shp/.dbf/.shx entries into state/tmp/<zipbase>/ and returns the .shp path", async () => {
    const shpPath = await extractShapefileFromZip(countyZip, state);

    expect(shpPath).toBe(
      path.join(state, "tmp", "tl_2025_us_county", "tl_2025_us_county.shp"),
    );
    const shp = await readFile(shpPath);
    expect(shp.byteLength).toBeGreaterThan(0);
    await expect(
      readFile(
        path.join(state, "tmp", "tl_2025_us_county", "tl_2025_us_county.dbf"),
      ),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      readFile(
        path.join(state, "tmp", "tl_2025_us_county", "tl_2025_us_county.shx"),
      ),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it("throws clearly when the zip has no .shp entry", async () => {
    // The Phase-1 zip fixture holds only a pipe-delimited text entry.
    const textOnlyZip = fileURLToPath(
      new URL("../../fixtures/gazetteer/sample.zip", import.meta.url),
    );
    await expect(extractShapefileFromZip(textOnlyZip, state)).rejects.toThrow(
      /No \.shp entry found in zip/,
    );
  });
});
