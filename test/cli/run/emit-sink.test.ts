import { describe, it, expect } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmitSink } from "../../../src/cli/run/emit-sink.js";

describe("createEmitSink", () => {
  it("streams geometry records to per-record files and returns a LocationPathGeometries ref", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "emit-"));
    const sink = createEmitSink(ws, "gov.census.gazetteer");
    await sink.emit("LocationPathGeometries", "az-state", {
      location_path_id: "az",
      geometry: { type: "Point", coordinates: [0, 0] },
      sourceLocationPathKey: "az",
    });
    const refs = await sink.flush();
    expect(refs).toHaveLength(1);
    expect(refs[0].ref.kind).toBe("LocationPathGeometries");
    expect(refs[0].ref.sha256).toMatch(/^[a-f0-9]{64}$/);
    // per-record file exists under the .records dir (bounded-memory write)
    const recordsDir = (await readdir(ws)).find((n) =>
      n.endsWith(".LocationPathGeometries.records"),
    );
    expect(recordsDir).toBeTruthy();
  });

  it("rejects an unsupported kind", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "emit-"));
    const sink = createEmitSink(ws, "gov.census.gazetteer");
    await expect(
      sink.emit("LocationPaths", "az", { name: "Arizona" }),
    ).rejects.toThrow(/unsupported kind/i);
  });

  it("returns no refs when nothing was emitted", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "emit-"));
    const sink = createEmitSink(ws, "gov.census.gazetteer");
    const refs = await sink.flush();
    expect(refs).toEqual([]);
  });
});
