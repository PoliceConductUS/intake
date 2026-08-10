import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  listZipEntries,
  readZipEntryBuffer,
  readZipEntryText,
} from "../../../../src/cli/run/parse/zip.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/gazetteer/sample.zip", import.meta.url),
);

const EXPECTED_TEXT = "USPS|GEOID|NAME\nAZ|04|Arizona\n";

function createCorruptZip(): string {
  const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
  const path = join(dir, "corrupt.zip");
  writeFileSync(path, "this is not a zip file");
  return path;
}

describe("listZipEntries", () => {
  it("lists entry file names", async () => {
    await expect(listZipEntries(fixture)).resolves.toEqual(["states.txt"]);
  });

  it("is deterministic across repeated calls", async () => {
    const first = await listZipEntries(fixture);
    const second = await listZipEntries(fixture);
    expect(second).toEqual(first);
  });
});

describe("readZipEntryText", () => {
  it("reads the entry's bytes as UTF-8 text", async () => {
    await expect(readZipEntryText(fixture, "states.txt")).resolves.toBe(
      EXPECTED_TEXT,
    );
  });

  it("is deterministic across repeated calls", async () => {
    const first = await readZipEntryText(fixture, "states.txt");
    const second = await readZipEntryText(fixture, "states.txt");
    expect(second).toBe(first);
  });

  it("rejects clearly when the entry name isn't found", async () => {
    await expect(
      readZipEntryText(fixture, "does-not-exist.txt"),
    ).rejects.toThrow(/does-not-exist\.txt/);
  });
});

describe("readZipEntryBuffer", () => {
  it("reads the entry's raw bytes", async () => {
    const buf = await readZipEntryBuffer(fixture, "states.txt");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString("utf8")).toBe(EXPECTED_TEXT);
  });
});

describe("corrupt/non-zip input", () => {
  it("listZipEntries rejects cleanly on a non-zip file", async () => {
    const corrupt = createCorruptZip();
    await expect(listZipEntries(corrupt)).rejects.toThrow();
  });

  it("readZipEntryText rejects cleanly on a non-zip file", async () => {
    const corrupt = createCorruptZip();
    await expect(readZipEntryText(corrupt, "states.txt")).rejects.toThrow();
  });
});
