import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as database from "../../src/cli/database/index.js";
import { runIntake } from "../../src/cli/index.js";
import { storePersonnelPhoto } from "../../src/cli/photo/store.js";
import { EmptyDatabaseClient } from "./database/empty-database-client.js";
import { onlyCommandLog, readLogRecords, wasLogOpen } from "./command-log.js";
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

class OnePersonnelClient extends EmptyDatabaseClient {
  async query() {
    return { rows: [{ id: "canonical-person" }] };
  }
}

async function photoImportWorkspace() {
  const dir = await workspace();
  const file = path.join(dir, "portrait.webp");
  await writeFile(
    file,
    Buffer.from("5249464610000000574542505650382000000000", "hex"),
  );
  vi.stubEnv("INTAKE_WORKSPACE", dir);
  vi.stubEnv("DATABASE_URL", "postgres://test/photo");
  vi.spyOn(database, "defaultDatabaseClientFactory").mockImplementation(
    () => new OnePersonnelClient(),
  );
  return { dir, file };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("photo import writes <command-name>.log in its command folder", async () => {
  const { dir, file } = await photoImportWorkspace();
  const result = await runIntake(["photo", "import", "canonical-person", file]);
  expect(result.exitCode).toBe(0);
  const { logPath } = await onlyCommandLog(dir);
  expect(await readLogRecords(logPath)).toEqual([]);
  expect(await wasLogOpen(logPath)).toBe(false);
});

test("photo import records the error that ended it as the last record of its log", async () => {
  const { dir, file } = await photoImportWorkspace();
  const chain = path.join(dir, "state", "org/policeconduct/manual", "manual");
  await mkdir(chain, { recursive: true });
  await writeFile(path.join(chain, "output-1.json"), "{}");
  await writeFile(
    path.join(chain, "latest.json"),
    JSON.stringify({ path: "output-1.json", sha256: "0".repeat(64) }),
  );
  const message = `org/policeconduct/manual: output-1.json sha mismatch (edited out of band); expected ${"0".repeat(64)}.`;
  const result = await runIntake(["photo", "import", "canonical-person", file]);
  expect(result).toMatchObject({ exitCode: 1, stderr: `${message}\n` });
  const records = await readLogRecords((await onlyCommandLog(dir)).logPath);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    level: 50,
    error: { message, stack: expect.stringContaining(`Error: ${message}\n`) },
  });
  expect(await wasLogOpen((await onlyCommandLog(dir)).logPath)).toBe(false);
});
