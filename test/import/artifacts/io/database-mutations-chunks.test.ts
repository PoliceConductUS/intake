import { createHash } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { DatabaseMutations } from "../../../../src/cli/import/artifacts/io/DatabaseMutations.js";
import { executeDatabaseMutations } from "../../../../src/cli/replay/database-mutations/execute.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mutation-chunks-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const alias = {
  kind: "LocationPathAliasCreate" as const,
  name: "/tx/a/",
  spec: { alias_path: "/tx/a/", location_path_id: "cabc1234def5678ghij90kl1" },
};

async function writeChunked(
  chunkDirectory: string,
): Promise<{ top: string; chunk: string }> {
  const { path: chunk } = await DatabaseMutations.write(
    path.join(root, chunkDirectory),
    DatabaseMutations.new({
      metadata: { name: "chunk-0", namespace: "test" },
      spec: { mutations: [alias] },
    }),
  );
  const { path: top } = await DatabaseMutations.write(
    path.join(root, "top"),
    DatabaseMutations.new({
      metadata: { name: "top", namespace: "test" },
      spec: {
        mutations: [
          {
            ref: {
              path: path.relative(path.join(root, "top"), chunk),
              kind: "DatabaseMutations",
              sha256: createHash("sha256")
                .update(await readFile(chunk))
                .digest("hex"),
            },
          },
        ],
      },
    }),
  );
  return { top, chunk };
}

function replay(top: string) {
  const queries: string[] = [];
  return {
    queries,
    done: executeDatabaseMutations(
      {
        connect: async () => {},
        end: async () => {},
        query: async (sql) => {
          queries.push(sql);
          return { rows: [{ alias_path: "/tx/a/" }] };
        },
      },
      top,
    ),
  };
}

test("reads and replays a chunk whose bytes match the recorded sha256", async () => {
  const { top } = await writeChunked("top/top.records");

  expect((await DatabaseMutations.read(top)).spec.mutations).toEqual([alias]);
  const { queries, done } = replay(top);
  expect((await done).mutations).toBe(1);
  expect(queries).toHaveLength(1);
});

test("rejects a chunk whose bytes differ from the recorded sha256", async () => {
  const { top, chunk } = await writeChunked("top/top.records");
  await appendFile(chunk, "\n");

  const message = `DatabaseMutations sha256 mismatch: ${chunk}`;
  await expect(DatabaseMutations.read(top)).rejects.toThrow(message);
  const { queries, done } = replay(top);
  await expect(done).rejects.toThrow(message);
  expect(queries).toEqual([]);
});

test("rejects a chunk ref that leaves the directory of the file that names it", async () => {
  const { top } = await writeChunked("outside");

  const message =
    "DatabaseMutations ref.path escapes its directory: ../outside/chunk-0.DatabaseMutations.yaml";
  await expect(DatabaseMutations.read(top)).rejects.toThrow(message);
  const { queries, done } = replay(top);
  await expect(done).rejects.toThrow(message);
  expect(queries).toEqual([]);
});
