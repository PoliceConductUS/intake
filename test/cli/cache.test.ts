import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Command } from "../../src/shared/io/Command.js";
import { runIntake } from "../../src/cli/index.js";
import { persistSourceNameToCanonicalIds } from "../../src/cli/state/source-name-to-canonical-id/index.js";
import {
  readResolvedProperty,
  writeResolvedProperty,
} from "../../src/cli/state/resolved-property/index.js";
import { INTAKE_API_VERSION } from "../../src/shared/io/import-types.js";
import { DataContext } from "../../src/cli/import/artifacts/data-context.js";
import { createSourceNameToCanonicalIdLedger } from "../../src/cli/state/source-name-to-canonical-id/index.js";
import { EmptyDatabaseClient } from "./database/empty-database-client.js";

let workspace: string;
const subject = {
  apiVersion: INTAKE_API_VERSION,
  kind: "Agency",
  name: "known-agency-id",
} as const;
beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "cache-cli-"));
  vi.stubEnv("INTAKE_WORKSPACE", workspace);
  await persistSourceNameToCanonicalIds(
    "test.source",
    {
      locationPaths: {},
      agencies: { "source-one": { canonicalId: subject.name } },
      personnel: {},
      agencyPersonnel: {},
    },
    { rootDir: workspace },
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(workspace, { recursive: true, force: true });
});
const args = (action: string, property = "location_path_id") => [
  "cache",
  action,
  "test.source",
  "Agency",
  "source-one",
  property,
];

test("sets and reads a manual resolution by source identity, including new resolver fingerprints", async () => {
  expect(await runIntake([...args("set"), "manual-place-id"])).toMatchObject({
    exitCode: 0,
  });
  const result = await runIntake(args("get"));
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(subject.name);
  expect(result.stdout).toContain("manual-place-id");
  expect(
    await readResolvedProperty({
      rootDir: workspace,
      subject,
      targetProperty: "location_path_id",
      inputFingerprint: "new-input",
    }),
  ).toBe("manual-place-id");
});

test("requires force, shows existing values, and retains prior resolved entries and manual history", async () => {
  const key = {
    rootDir: workspace,
    subject,
    targetProperty: "location_path_id",
    inputFingerprint: "old-input",
  };
  await writeResolvedProperty({ ...key, value: "wrong-place-id" });
  const rejected = await runIntake([...args("set"), "right-place-id"]);
  expect(rejected.exitCode).toBe(1);
  expect(rejected.stderr).toContain("wrong-place-id");
  expect(rejected.stderr).toContain("--force");
  expect(await readResolvedProperty(key)).toBe("wrong-place-id");
  expect(
    (await runIntake([...args("set"), "right-place-id", "--force"])).exitCode,
  ).toBe(0);
  expect(await readResolvedProperty(key)).toBe("right-place-id");
  expect(
    (await runIntake([...args("set"), "another-place-id", "--force"])).exitCode,
  ).toBe(0);
  const read = await runIntake(args("get"));
  expect(read.stdout).toContain("wrong-place-id");
  expect(read.stdout).toContain("right-place-id");
  expect(read.stdout).toContain("another-place-id");
  const spec = JSON.parse(read.stdout!).entries;
  expect(JSON.parse(read.stdout!)).not.toHaveProperty("override");
  expect(JSON.parse(read.stdout!)).not.toHaveProperty("overrideHistory");
  expect(
    spec.filter(
      (entry: { inputFingerprint?: string }) =>
        entry.inputFingerprint === undefined,
    ),
  ).toHaveLength(1);
  const current = spec.find(
    (entry: { inputFingerprint?: string }) =>
      entry.inputFingerprint === undefined,
  );
  expect(current).toMatchObject({
    value: "another-place-id",
    recordedAt: expect.any(String),
    commandId: expect.any(String),
  });
  const previous = spec.find(
    (entry: { value: string }) => entry.value === "right-place-id",
  );
  expect(previous).toMatchObject({
    inputFingerprint: "previous-override-1",
    recordedAt: expect.any(String),
    commandId: expect.any(String),
  });
  expect(previous.commandId).not.toBe(current.commandId);
  const commandDir = (await readdir(path.join(workspace, "command"))).find(
    (name) => name.endsWith(current.commandId),
  )!;
  const directory = path.join(workspace, "command", commandDir);
  const commandFile = (await readdir(directory)).find((name) =>
    name.endsWith(".Command.yaml"),
  )!;
  const command = await Command.read(path.join(directory, commandFile));
  expect(command.metadata.name).toBe(current.commandId);
  expect(command.spec.args).toEqual([
    ...args("set"),
    "another-place-id",
    "--force",
  ]);
  expect(
    (await runIntake([...args("set"), "final-place-id", "--force"])).exitCode,
  ).toBe(0);
  const finalEntries = JSON.parse(
    (await runIntake(args("get"))).stdout!,
  ).entries;
  expect(
    finalEntries.find(
      (entry: { inputFingerprint?: string }) =>
        entry.inputFingerprint === "previous-override-2",
    ),
  ).toEqual({ ...current, inputFingerprint: "previous-override-2" });
  expect(
    finalEntries.find(
      (entry: { inputFingerprint?: string }) =>
        entry.inputFingerprint === "previous-override-1",
    ),
  ).toEqual(previous);
});

test("validates property values without converting a string True into a boolean", async () => {
  expect((await runIntake([...args("set", "city"), "True"])).exitCode).toBe(0);
  expect(
    await readResolvedProperty({
      rootDir: workspace,
      subject,
      targetProperty: "city",
    }),
  ).toBe("True");
  expect(
    (await runIntake([...args("set", "latitude"), "33.767"])).exitCode,
  ).toBe(0);
  expect(
    await readResolvedProperty({
      rootDir: workspace,
      subject,
      targetProperty: "latitude",
    }),
  ).toBe(33.767);
  expect(
    (await runIntake([...args("set", "longitude"), "not-a-number"])).exitCode,
  ).toBe(1);
});

test("an agency mutation uses the CLI override when its address has no available boundary", async () => {
  expect(
    (await runIntake([...args("set"), "manual-community-id"])).exitCode,
  ).toBe(0);
  const resolveAddress = vi.fn(async () => {
    throw new Error("No boundary available");
  });
  const context = new DataContext({
    client: new EmptyDatabaseClient(),
    ledger: createSourceNameToCanonicalIdLedger({ rootDir: workspace }),
    resolvedPropertyStore: {
      read: (input) => readResolvedProperty({ ...input, rootDir: workspace }),
      write: (input) => writeResolvedProperty({ ...input, rootDir: workspace }),
    },
    resolveAddress,
  });
  const facade = context.facadeFromSource("Agency", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "test.source",
    name: "source-one",
    spec: {
      name: "Community Police",
      address: "1 Main St",
      city: "Community",
      state: "TX",
      zip_code: "75447",
      latitude: 33.7,
      longitude: -96.1,
    },
  });
  expect(await facade.toMutation()).toMatchObject({
    kind: "AgencyCreate",
    spec: { id: subject.name, location_path_id: "manual-community-id" },
  });
  expect(resolveAddress).not.toHaveBeenCalled();
});

test("rejects unmapped identities, unknown kinds/properties, and ID changes", async () => {
  for (const invalid of [
    ["cache", "set", "test.source", "Agency", "missing", "city", "Test"],
    ["cache", "get", "test.source", "Unknown", "source-one", "city"],
    [...args("set", "not_a_property"), "Test"],
    [...args("set", "id"), "new-id"],
  ])
    expect((await runIntake(invalid)).exitCode).toBe(1);
});

test.each(["latitude", "longitude"])(
  "reports the expected number type for invalid %s without changing the cache",
  async (property) => {
    const key = { rootDir: workspace, subject, targetProperty: property };
    await writeResolvedProperty({ ...key, value: 32 });
    for (const value of ["fred", "true", '"fred"', "{}", "[]"]) {
      const result = await runIntake([
        ...args("set", property),
        value,
        "--force",
      ]);
      expect(result).toMatchObject({
        exitCode: 1,
        stderr: "Value must be a number.\n",
      });
      expect(await readResolvedProperty(key)).toBe(32);
    }
  },
);
