import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { BinaryFile } from "../../../src/shared/io/BinaryFile.js";

// sha256("hello") and sha256("world"), from the shell's shasum.
const HELLO =
  "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const WORLD =
  "486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7";
const origin = {
  kind: "download" as const,
  url: "https://example.org/hello.pdf",
  retrievedAt: "2026-11-17T10:00:00.000Z",
  httpStatus: 200,
};

function envelope(sha256 = HELLO, spec: object = {}) {
  return BinaryFile.new({
    metadata: { name: sha256, namespace: "com/example" },
    spec: {
      sha256,
      bytes: 5,
      contentType: "application/pdf",
      extension: "pdf",
      origin,
      ...spec,
    },
  });
}

async function directory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "intake-binary-file-"));
}

describe("BinaryFile", () => {
  test("stores the file beside its envelope under the same name", async () => {
    const dir = await directory();
    const written = await BinaryFile.write(
      dir,
      envelope(),
      Buffer.from("hello"),
    );
    expect((await readdir(dir)).sort()).toEqual([
      `${HELLO}.BinaryFile.yaml`,
      `${HELLO}.pdf`,
    ]);
    const stored = await BinaryFile.read(written.path);
    expect(stored.bytes.toString()).toBe("hello");
    expect(stored.filePath).toBe(path.join(dir, `${HELLO}.pdf`));
    expect(stored.envelope.spec).toEqual({
      sha256: HELLO,
      bytes: 5,
      contentType: "application/pdf",
      extension: "pdf",
      origin,
    });
  });

  test("accepts a local origin and rejects a mixed one", () => {
    const local = {
      kind: "local" as const,
      filename: "photo.webp",
      importedAt: "2026-11-17T10:00:00.000Z",
    };
    expect(envelope(HELLO, { origin: local }).spec.origin).toEqual(local);
    expect(() =>
      envelope(HELLO, { origin: { ...local, url: origin.url } }),
    ).toThrow("BinaryFile is malformed at spec.origin.url.");
  });

  test("rejects keys outside the schema and a name that is not the hash", () => {
    expect(() => envelope(HELLO, { path: "/tmp/hello.pdf" })).toThrow(
      "BinaryFile is malformed at spec.path.",
    );
    expect(() =>
      BinaryFile.new({
        metadata: { name: WORLD, namespace: "com/example" },
        spec: envelope().spec,
      }),
    ).toThrow("BinaryFile is malformed at metadata.name.");
  });

  test("fails a read when the file no longer hashes to its name", async () => {
    const dir = await directory();
    const written = await BinaryFile.write(
      dir,
      envelope(),
      Buffer.from("hello"),
    );
    await writeFile(written.filePath, "jello");
    await expect(BinaryFile.read(written.path)).rejects.toThrow(
      `BinaryFile does not hash to its name: ${written.filePath}`,
    );
  });

  test("fails a read when the envelope has no file", async () => {
    const dir = await directory();
    const envelopePath = path.join(dir, `${HELLO}.BinaryFile.yaml`);
    await writeFile(
      envelopePath,
      [
        "apiVersion: policeconduct.org/intake/v1alpha1",
        "kind: BinaryFile",
        "metadata:",
        `  name: ${HELLO}`,
        "  namespace: com/example",
        "spec:",
        `  sha256: ${HELLO}`,
        "  bytes: 5",
        "  contentType: application/pdf",
        "  extension: pdf",
        "  origin:",
        "    kind: local",
        "    filename: hello.pdf",
        "    importedAt: 2026-11-17T10:00:00.000Z",
      ].join("\n"),
    );
    await expect(BinaryFile.read(envelopePath)).rejects.toThrow(
      `BinaryFile envelope has no file: ${path.join(dir, `${HELLO}.pdf`)}`,
    );
  });

  test("fails a write whose bytes are not the named ones, writing nothing", async () => {
    const dir = await directory();
    await expect(
      BinaryFile.write(dir, envelope(), Buffer.from("world")),
    ).rejects.toThrow(`BinaryFile bytes do not hash to the name ${HELLO}.`);
    expect(await readdir(dir)).toEqual([]);
  });

  test("fails a write that finds its name taken by different bytes", async () => {
    const dir = await directory();
    const taken = path.join(dir, `${HELLO}.pdf`);
    await writeFile(taken, "world");
    await expect(
      BinaryFile.write(dir, envelope(), Buffer.from("hello")),
    ).rejects.toThrow(
      `BinaryFile name is taken by different bytes: ${taken} holds a file with SHA-256 ${WORLD}, not ${HELLO}.`,
    );
    expect(await readFile(taken, "utf8")).toBe("world");
    expect(await readdir(dir)).toEqual([`${HELLO}.pdf`]);
  });

  test("writes the envelope for a file a crash left without one", async () => {
    const dir = await directory();
    await writeFile(path.join(dir, `${HELLO}.pdf`), "hello");
    const written = await BinaryFile.write(
      dir,
      envelope(),
      Buffer.from("hello"),
    );
    expect((await BinaryFile.read(written.path)).bytes.toString()).toBe(
      "hello",
    );
  });
});
