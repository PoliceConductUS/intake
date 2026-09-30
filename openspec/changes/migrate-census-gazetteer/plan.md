# Census Gazetteer Migration — Phase 1 (Runtime Evolutions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Evolve the Slice-1 `intake run` runtime with the three capabilities the gazetteer needs — deterministic parse helpers (delimited / zip / shapefile→GeoJSON), an injected persistent `state` dir, and a streaming `emit` sink that writes large record kinds (geometries) to disk with bounded memory and references them from the `Artifacts` envelope. No domain port yet (Phase 2); no import-pipeline changes (the import side already streams geometries).

**Architecture:** New injected `RunDeps` members, each isolated behind one adapter (like `readXlsx`). `emit` writes each record via the singular `LocationPathGeometry.write`, accumulates a small ref-map, and on flush writes a `LocationPathGeometries` envelope-of-refs; `buildArtifactsEnvelope` splices that as a `{ref}` item beside the inline bounded kinds. `makeWorkspace` moves _before_ `run()` so `emit` can stream during execution.

**Tech Stack:** TypeScript (ESM/NodeNext, `.js` specifiers), Vitest, existing intake IO (`LocationPathGeometry`, `Artifacts`, `yamlResourceFileName`, `writeYamlDocumentFile`, `yamlDigest` from `src/shared/io/`), new deps `shapefile` + a zip reader.

## Global Constraints

- ESM/NodeNext: relative import specifiers end in `.js`.
- Deterministic: no network, clock, or randomness in any helper or the sink.
- Reuse existing helpers; **no codegen template changes** (`scripts/generate-envelope-types.ts` untouched). No import-pipeline changes.
- **DRY — no duplicate/near-duplicate components/types** (standing rule). New parse libs each imported in exactly one adapter file; reuse `RunDeps`/types, don't redeclare.
- Tests under `test/` mirroring `src/`. Run `npm test -- <name>`; full `npm test` before commit (one known pre-existing `supabase/seed.sql` suite-load failure is acceptable).
- Conventional Commits. Commit per task.

## File Structure

- `src/cli/run/parse/delimited.ts` — `parseDelimited(text, {delimiter})` → `Array<Record<string,string>>` (header-keyed).
- `src/cli/run/parse/zip.ts` — `readZipEntryText(zipPath, entryName)` / `listZipEntries(zipPath)`.
- `src/cli/run/parse/geo.ts` — `readShapefile(shpPath)` (async iterable of GeoJSON features) + `readGeoJson(path)`.
- `src/cli/run/state.ts` — `sourceStateDir(env, sourceId)` → persistent per-source cache dir.
- `src/cli/run/emit-sink.ts` — the streaming geometry sink (`createEmitSink(workspaceDir, namespace)`).
- Modify `src/cli/run/source-run.ts` (`RunDeps` + `buildArtifactsEnvelope`) and `src/cli/run/index.ts` (wire deps; `makeWorkspace` before `run`).
- Tests mirror under `test/cli/run/`.

---

### Task 1: `parseDelimited` helper

**Files:** Create `src/cli/run/parse/delimited.ts`, `test/cli/run/parse/delimited.test.ts`.

**Interfaces:** Produces `parseDelimited(text: string, opts: { delimiter: string }): Array<Record<string,string>>` — first line is the header; each subsequent non-empty line split on `delimiter`, trimmed, keyed by header. Extra/short columns tolerated (missing → `""`).

- [ ] **Step 1: Failing test**

```ts
// test/cli/run/parse/delimited.test.ts
import { describe, it, expect } from "vitest";
import { parseDelimited } from "../../../../src/cli/run/parse/delimited.js";
describe("parseDelimited", () => {
  it("parses pipe-delimited text keyed by header", () => {
    const rows = parseDelimited("USPS|GEOID|NAME\nAZ|04|Arizona\n", {
      delimiter: "|",
    });
    expect(rows).toEqual([{ USPS: "AZ", GEOID: "04", NAME: "Arizona" }]);
  });
  it("is deterministic and skips blank trailing lines", () => {
    const t = "A|B\n1|2\n\n";
    expect(parseDelimited(t, { delimiter: "|" })).toEqual([{ A: "1", B: "2" }]);
  });
});
```

- [ ] **Step 2:** `npm test -- parse/delimited` → FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
// src/cli/run/parse/delimited.ts
export function parseDelimited(
  text: string,
  opts: { delimiter: string },
): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(opts.delimiter).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(opts.delimiter);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) row[h] = (cells[i] ?? "").trim();
    });
    return row;
  });
}
```

- [ ] **Step 4:** `npm test -- parse/delimited` → PASS. **Step 5:** commit `feat(run): add delimited text parse helper`.

---

### Task 2: `zip` reader helper

**Files:** Create `src/cli/run/parse/zip.ts`, `test/cli/run/parse/zip.test.ts`; modify `package.json` (add a zip dep). **Confirm dep:** default `yauzl` (streaming, robust) — alternative `adm-zip` (simpler, sync). Isolated to this file.

**Interfaces:** `listZipEntries(zipPath: string): Promise<string[]>`; `readZipEntryText(zipPath: string, entryName: string): Promise<string>`; `readZipEntryBuffer(zipPath, entryName): Promise<Buffer>` (for shapefiles inside zips).

- [ ] **Step 1:** Add dep: `npm install yauzl @types/yauzl` (or `adm-zip`).
- [ ] **Step 2:** Build a tiny fixture zip in the test (write entries via the same lib or a committed `.zip`) containing `states.txt` with pipe-delimited content.
- [ ] **Step 3: Failing test** asserting `listZipEntries` returns `["states.txt"]` and `readZipEntryText(zip,"states.txt")` returns the exact text; determinism on repeat.
- [ ] **Step 4:** run → FAIL. **Step 5:** implement `zip.ts` (only file importing the zip lib). **Step 6:** run → PASS. **Step 7:** commit `feat(run): add zip entry read helpers`.

---

### Task 3: shapefile / GeoJSON reader

**Files:** Create `src/cli/run/parse/geo.ts`, `test/cli/run/parse/geo.test.ts`; modify `package.json` (add `shapefile`).

**Interfaces:** `readShapefile(shpPath: string, dbfPath?: string): AsyncIterable<{ properties: Record<string,unknown>; geometry: unknown }>` (async-iterable → streaming-friendly); `readGeoJson(path: string): Promise<Array<{ properties; geometry }>>`.

- [ ] **Step 1:** `npm install shapefile`.
- [ ] **Step 2:** Commit a tiny fixture: a 1–2 feature `.shp`/`.dbf` (generate with a small script using `shapefile`'s writer or a checked-in minimal pair) OR a `.geojson` fixture for `readGeoJson`, plus a minimal `.shp` for `readShapefile`.
- [ ] **Step 3: Failing test** — `readGeoJson(fixture)` yields the expected feature(s) with `geometry.type` and `properties`; `for await (const f of readShapefile(fixture))` yields the expected count + geometry type; determinism.
- [ ] **Step 4:** FAIL → **Step 5:** implement `geo.ts` using `shapefile.open(...)` streaming read (`readShapefile` yields per feature; only file importing `shapefile`). **Step 6:** PASS → **Step 7:** commit `feat(run): add shapefile/geojson read helpers`.

---

### Task 4: injected persistent `state` dir

**Files:** Create `src/cli/run/state.ts`, `test/cli/run/state.test.ts`; modify `src/cli/run/source-run.ts` (`RunDeps`) + `src/cli/run/index.ts` (wire it).

**Interfaces:** `sourceStateDir(env, sourceId): Promise<string>` → ensures + returns `${INTAKE_WORKSPACE}/intake/state/sources/${sourceId}/` (persistent across runs; distinct from the per-run command workspace). Add `state: string` to `RunDeps`; `registerCliCommand` injects `await sourceStateDir(env, sourceId)`.

- [ ] **Step 1: Failing test** — `sourceStateDir({INTAKE_WORKSPACE: tmp}, "gov.x")` returns `<tmp>/intake/state/sources/gov.x`, the dir exists and is stable across two calls; throws clearly when `INTAKE_WORKSPACE` is unset.
- [ ] **Step 2:** FAIL → **Step 3:** implement `state.ts` (mkdir -p; mirror `command-directory.ts`'s `INTAKE_WORKSPACE` handling — reuse its workspace-resolution rather than re-deriving). **Step 4:** PASS.
- [ ] **Step 5:** Add `state: string` to `RunDeps` in `source-run.ts`; in `index.ts` `registerCliCommand`, construct `state` and pass it in the deps object; update the `run-command` unit test's `makeOkDeps` to include a stub `state`. Run `npm test -- run-command` + `state` → green. **Step 6:** commit `feat(run): inject persistent per-source state dir`.

---

### Task 5: streaming `emit` sink (geometries) + envelope ref splice

**Files:** Create `src/cli/run/emit-sink.ts`, `test/cli/run/emit-sink.test.ts`; modify `src/cli/run/source-run.ts` (`RunDeps.emit`, `buildArtifactsEnvelope` accepts ref items) + `src/cli/run/index.ts` (create workspace before `run`; wire `emit`; flush before building the envelope).

**Interfaces (grounded in the investigation):**

- `createEmitSink(workspaceDir: string, namespace: string)` → `{ emit(kind, key, spec): Promise<void>; flush(): Promise<Array<{ ref: { path: string; kind: string; sha256: string } }>> }`.
- Per emitted geometry: `LocationPathGeometry.write(recordsDir, LocationPathGeometry.new({ metadata: { name: key, namespace }, spec }))` (singular writer, from `src/shared/io/index.js`) → `{ path, sha256 }`; push `{ ref: { path: <relative>, kind: "LocationPathGeometry", sha256 } }` into an in-memory ref map (bytes per record, not the polygon).
- `flush()`: `LocationPathGeometries.write(workspaceDir, { metadata: { name, namespace }, spec: { records: refMap } })` (NO `externalizeRecords` — records are already refs) → `{ path, sha256 }`; return `[{ ref: { path: basename(path), kind: "LocationPathGeometries", sha256 } }]`.
- `buildArtifactsEnvelope(sourceId, digest, manifest, refItems=[])`: `spec.artifacts = [...manifest.artifacts.map(inline...), ...refItems]`. `Artifacts.write` already passes ref items through (verified) — no `Artifacts.ts` change.

- [ ] **Step 1: Failing test**

```ts
// test/cli/run/emit-sink.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmitSink } from "../../../src/cli/run/emit-sink.js";

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
```

- [ ] **Step 2:** FAIL → **Step 3:** implement `emit-sink.ts` per the interface above, importing `LocationPathGeometry`, `LocationPathGeometries` from `../../shared/io/index.js` and `yamlResourceFileName` where needed. **Step 4:** `npm test -- emit-sink` → PASS.
- [ ] **Step 5:** Wire into the command. In `source-run.ts`: add `emit: (kind, key, spec) => Promise<void>` to `RunDeps`; change `buildArtifactsEnvelope` to accept `refItems` and append them. In `index.ts` `runSource`: call `makeWorkspace` **before** `run`; build the sink over that workspace; pass `emit` in the deps; after `run` returns, `const refItems = await sink.flush()`; `writeEnvelope(workspace, sourceId, digest, manifest, refItems)`. Update `makeOkDeps`/`run-command` test to stub `emit`/`state` and assert refItems flow. Run `npm test -- run-command emit-sink source-run` → green.
- [ ] **Step 6:** Integration test `test/cli/run/emit-integration.test.ts`: a fake `run` that returns an inline `LocationPaths` record AND calls `emit("LocationPathGeometries", key, spec)`, driven through `runSource` with a stubbed `runImport` that captures the written `Artifacts` path; read it back via `Artifacts.read` and assert the envelope has the inline `LocationPaths` records + a resolvable `LocationPathGeometries` ref. **Step 7:** `npm run validate`-relevant checks (`npm test`, `npm run typecheck`); commit `feat(run): stream large kinds via emit sink; ref them in Artifacts`.

---

## Self-Review

- **Spec coverage:** Phase-1 goals = parse helpers (Tasks 1–3), injected `state` (Task 4), streaming emit sink + envelope ref (Task 5). All mapped.
- **No codegen/import-pipeline changes:** confirmed by the investigation (import side already streams geometry refs; `Artifacts.write` passes refs through; singular `LocationPathGeometry.write` is the streaming primitive).
- **Confirm-before-coding:** the two new deps — `yauzl` (or `adm-zip`) for zip, `shapefile` for `.shp` — each isolated to one adapter file.
- **DRY/determinism:** each parse lib imported in exactly one file; `state`/`emit` reuse existing IO helpers; all helpers pure/deterministic.
- **Deferred to Phase 2/3:** the domain port, whether the ~32k LocationPaths also stream (measure), overrides, golden regression.
