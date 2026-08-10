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
