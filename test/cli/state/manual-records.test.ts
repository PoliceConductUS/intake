import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  appendEntry,
  readLatest,
} from "../../../src/cli/state/manual-records.js";

let stateDir: string;

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), "manual-records-"));
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

const first = { kind: "Agency", record: { id: "agency-one" } };
const second = { kind: "Agency", record: { id: "agency-two" } };

it("reads an empty chain when there is no latest pointer", async () => {
  expect(await readLatest(stateDir)).toEqual({ previous: null, entries: [] });
});

it("fails on a corrupt latest pointer and keeps the chain as it was", async () => {
  await appendEntry(stateDir, first, "id");
  const latest = path.join(stateDir, "manual", "latest.json");
  await writeFile(latest, "{ not json");

  await expect(readLatest(stateDir)).rejects.toThrow(latest);
  await expect(appendEntry(stateDir, second, "id")).rejects.toThrow(latest);
  expect(await readFile(latest, "utf8")).toBe("{ not json");
});

it("fails on a latest pointer that cannot be read as a file", async () => {
  const latest = path.join(stateDir, "manual", "latest.json");
  await mkdir(latest, { recursive: true });

  await expect(readLatest(stateDir)).rejects.toThrow("EISDIR");
  await expect(appendEntry(stateDir, first, "id")).rejects.toThrow("EISDIR");
});
