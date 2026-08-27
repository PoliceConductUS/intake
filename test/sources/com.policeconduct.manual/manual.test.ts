import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { describeKind } from "../../../sources/com.policeconduct.manual/entity-model.js";
import {
  appendEntry,
  readLatest,
} from "../../../sources/com.policeconduct.manual/chain.js";
import { acquire } from "../../../sources/com.policeconduct.manual/acquire.js";
import { run } from "../../../sources/com.policeconduct.manual/run.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "manual-"));
  tempDirs.push(dir);
  return dir;
}

describe("describeKind (model-driven, from the shared specs)", () => {
  it("reports LocationPathAlias's identity, fields, and FK target", () => {
    const model = describeKind("LocationPathAlias");
    expect(model.identity).toBe("alias_path");
    const fk = model.fields.find((f) => f.name === "location_path_id");
    // location_path_id is a foreign key to LocationPath — from FK_REFERENCES, not
    // hand-coded.
    expect(fk?.targetKind).toBe("LocationPath");
    expect(model.fields.map((f) => f.name)).toContain("alias_path");
  });
});

describe("manual chain", () => {
  it("dedupes by (kind + identity) so a repeated record updates its value", async () => {
    const state = await tempDir();
    await appendEntry(
      state,
      {
        kind: "LocationPathAlias",
        record: { alias_path: "/a/b/c/", location_path_id: "/wrong/" },
      },
      "alias_path",
    );
    const updated = await appendEntry(
      state,
      {
        kind: "LocationPathAlias",
        record: { alias_path: "/a/b/c/", location_path_id: "/a/b/canonical/" },
      },
      "alias_path",
    );
    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0].record.location_path_id).toBe("/a/b/canonical/");
    expect(updated.previous).not.toBeNull();
  });
});

describe("acquire -> run (env-driven, non-interactive)", () => {
  it("interviews a LocationPathAlias into the chain and emits it as an artifact", async () => {
    const state = await tempDir();
    await acquire({
      sourceDir: await tempDir(),
      state,
      env: {
        MANUAL_KIND: "LocationPathAlias",
        MANUAL_RECORD: JSON.stringify({
          alias_path: "/mn/ramsey-county/st-paul/",
          location_path_id: "/mn/ramsey-county/saint-paul/",
        }),
      },
      data: {} as never,
    });

    expect((await readLatest(state)).entries).toHaveLength(1);

    const manifest = await run({
      paths: [],
      readXlsx: async () => [],
      state,
      emit: async () => {},
    } as never);
    const [artifact] = manifest.artifacts;
    expect(artifact.kind).toBe("LocationPathAliases");
    // Keyed by the record's identity column (alias_path), from the shared model.
    expect(artifact.records["/mn/ramsey-county/st-paul/"]).toEqual({
      spec: {
        alias_path: "/mn/ramsey-county/st-paul/",
        location_path_id: "/mn/ramsey-county/saint-paul/",
      },
    });
  });

  it("rejects a record whose fields violate the shared spec", async () => {
    const state = await tempDir();
    await expect(
      acquire({
        sourceDir: await tempDir(),
        state,
        env: {
          MANUAL_KIND: "LocationPathAlias",
          // Missing the required location_path_id.
          MANUAL_RECORD: JSON.stringify({ alias_path: "/a/b/c/" }),
        },
        data: {} as never,
      }),
    ).rejects.toThrow();
  });
});
