import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { storePersonnelPhoto } from "../../src/cli/photo/store.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function workspace() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "photo-test-"));
  dirs.push(dir);
  return dir;
}
test("stores image bytes by content and preserves original provenance", async () => {
  const dir = await workspace();
  const file = path.join(dir, "portrait.webp");
  const bytes = Buffer.from("5249464610000000574542505650382000000000", "hex");
  await writeFile(file, bytes);
  const photo = await storePersonnelPhoto(dir, file);
  expect(photo.content_type).toBe("image/webp");
  expect(photo.byte_size).toBe(bytes.length);
  expect(photo.source_filename).toBe("portrait.webp");
  expect(photo.workspace_path).toBe(
    `assets/PersonnelPhoto/${photo.sha256}.webp`,
  );
  expect(await readFile(path.join(dir, photo.workspace_path))).toEqual(bytes);
  expect(await storePersonnelPhoto(dir, file)).toEqual(photo);
});
test("rejects unsupported bytes before creating an association", async () => {
  const dir = await workspace();
  const file = path.join(dir, "fake.webp");
  await writeFile(file, "not an image");
  await expect(storePersonnelPhoto(dir, file)).rejects.toThrow(
    "Unsupported image",
  );
});

import { preparePersonnelPhoto } from "../../src/cli/photo/prepare.js";
test("requires exact existing personnel before persisting bytes or source records", async () => {
  let saved = false;
  await expect(
    preparePersonnelPhoto("missing", "file", {
      findPersonnel: async () => false,
      store: async () => {
        saved = true;
        throw Error("should not run");
      },
      sourceIdFor: async () => "source-person",
    }),
  ).rejects.toThrow("Personnel not found: missing");
  expect(saved).toBe(false);
});
test("attaches a typed record through the personnel namespace reference", async () => {
  const photo = {
    workspace_path: "assets/PersonnelPhoto/hash.webp",
    sha256: "a".repeat(64),
    byte_size: 20,
    content_type: "image/webp",
    source_filename: "original.webp",
  };
  const entry = await preparePersonnelPhoto("canonical-person", "file", {
    findPersonnel: async (id) => id === "canonical-person",
    store: async () => photo,
    sourceIdFor: async (id) => {
      expect(id).toBe("canonical-person");
      return "source-person";
    },
  });
  expect(entry).toEqual({
    kind: "PersonnelPhoto",
    record: { id: "source-person", personnel_id: "source-person", ...photo },
  });
});
