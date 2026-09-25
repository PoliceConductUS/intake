import {
  loadPropertyCorrections,
  inspectPropertyCorrection,
} from "../../src/shared/io/property-corrections.js";
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
  expect(result.stdout).toContain("source-one");
  expect(result.stdout).toContain("manual-place-id");
  expect(
    (await loadPropertyCorrections(workspace, "test.source"))(
      "Agency",
      "source-one",
      {},
    ).location_path_id,
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
  expect(rejected.stderr).toContain(
    'Current cache:\n{\n  "subject": {\n    "apiVersion":',
  );
  expect(await readResolvedProperty(key)).toBe("wrong-place-id");
  expect(
    (await runIntake([...args("set"), "right-place-id", "--force"])).exitCode,
  ).toBe(0);
  expect(
    (await loadPropertyCorrections(workspace, "test.source"))(
      "Agency",
      "source-one",
      {},
    ).location_path_id,
  ).toBe("right-place-id");
  expect(await readResolvedProperty(key)).toBe("wrong-place-id");
  expect(
    (await runIntake([...args("set"), "another-place-id", "--force"])).exitCode,
  ).toBe(0);
  const read = await runIntake(args("get"));
  expect(await readResolvedProperty(key)).toBe("wrong-place-id");
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
    (await loadPropertyCorrections(workspace, "test.source"))(
      "Agency",
      "source-one",
      {},
    ).city,
  ).toBe("True");
  expect(
    (await runIntake([...args("set", "latitude"), "33.767"])).exitCode,
  ).toBe(0);
  expect(
    (await loadPropertyCorrections(workspace, "test.source"))(
      "Agency",
      "source-one",
      {},
    ).latitude,
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
    applyPropertyCorrections: await loadPropertyCorrections(
      workspace,
      "test.source",
    ),
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

test("rejects unknown kinds and properties", async () => {
  for (const invalid of [
    ["cache", "get", "test.source", "Unknown", "source-one", "city"],
    [...args("set", "not_a_property"), "Test"],
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

test("accepts a conditional correction for a source property before a canonical mapping exists", async () => {
  const base = [
    "cache",
    "set",
    "new.source",
    "Agency",
    "new-one",
    "name",
    "Correct Name",
    "--from",
    "Wrong Name",
  ];
  expect(await runIntake(base)).toMatchObject({ exitCode: 0 });
  const read = await runIntake([
    "cache",
    "get",
    "new.source",
    "Agency",
    "new-one",
    "name",
  ]);
  expect(read.exitCode).toBe(0);
  expect(read.stdout).toContain("Wrong Name");
  expect(read.stdout).toContain("Correct Name");
  expect((await runIntake(base)).stderr).toContain("--force");
});

test("--from and no-from replace one rule, never chain, and distinguish blank from missing", async () => {
  expect(
    (await runIntake([...args("set", "name"), "A", "--from", ""])).exitCode,
  ).toBe(0);
  const first = await loadPropertyCorrections(workspace, "test.source");
  expect(first("Agency", "source-one", { name: "" }).name).toBe("A");
  expect(first("Agency", "source-one", {}).name).toBeUndefined();
  expect((await runIntake([...args("set", "name"), "B"])).exitCode).toBe(1);
  expect(
    (await runIntake([...args("set", "name"), "B", "--force"])).exitCode,
  ).toBe(0);
  const second = await loadPropertyCorrections(workspace, "test.source");
  expect(second("Agency", "source-one", { name: "" }).name).toBe("");
  expect(second("Agency", "source-one", {}).name).toBe("B");
  expect(second("Agency", "source-one", { name: "A" }).name).toBe("A");
});

test("generation applies a source correction before dependent address resolution", async () => {
  expect(
    (
      await runIntake([
        ...args("set", "address"),
        "2 Main St",
        "--from",
        "PO BOX 1",
      ])
    ).exitCode,
  ).toBe(0);
  const resolveAddress = vi.fn(async (_input: unknown) => ({
    latitude: 32,
    longitude: -96,
  }));
  const context = new DataContext({
    client: new EmptyDatabaseClient(),
    ledger: createSourceNameToCanonicalIdLedger({ rootDir: workspace }),
    applyPropertyCorrections: await loadPropertyCorrections(
      workspace,
      "test.source",
    ),
    resolveAddress,
  });
  const facade = context.facadeFromSource("Agency", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "test.source",
    name: "source-one",
    spec: {
      name: "Test",
      address: "PO BOX 1",
      city: "Town",
      state: "TX",
      zip_code: "12345",
    },
  });
  expect(await facade.value("latitude")).toBe(32);
  expect(resolveAddress.mock.calls[0]?.[0]).toMatchObject({
    address: "2 Main St",
  });
});

test("a forced conditional rule retires the old unconditional correction", async () => {
  const { setManualResolvedProperty } =
    await import("../../src/cli/state/resolved-property/index.js");
  await setManualResolvedProperty({
    rootDir: workspace,
    subject,
    targetProperty: "latitude",
    value: 30,
    source: { namespace: "test.source", kind: "Agency", name: "source-one" },
    force: false,
    commandId: "old-command",
  });
  expect(
    (
      await runIntake([
        ...args("set", "latitude"),
        "32",
        "--from",
        "31",
        "--force",
      ])
    ).exitCode,
  ).toBe(0);
  expect(
    await readResolvedProperty({
      rootDir: workspace,
      subject,
      targetProperty: "latitude",
      inputFingerprint: "changed",
    }),
  ).toBeUndefined();
  const apply = await loadPropertyCorrections(workspace, "test.source");
  expect(apply("Agency", "source-one", { latitude: 31 }).latitude).toBe(32);
  expect(apply("Agency", "source-one", {}).latitude).toBeUndefined();
});

test("explicit identity changes fail instead of silently bypassing the durable mapping", async () => {
  expect((await runIntake([...args("set", "id"), "another-id"])).exitCode).toBe(
    0,
  );
  const context = new DataContext({
    client: new EmptyDatabaseClient(),
    ledger: createSourceNameToCanonicalIdLedger({ rootDir: workspace }),
    applyPropertyCorrections: await loadPropertyCorrections(
      workspace,
      "test.source",
    ),
  });
  const facade = context.facadeFromSource("Agency", {
    apiVersion: INTAKE_API_VERSION,
    namespace: "test.source",
    name: "source-one",
    spec: {},
  });
  await expect(facade.value("id")).rejects.toThrow(
    "conflicts with durable identity",
  );
});

test("accepts an explicit null replacement for a nullable property", async () => {
  expect(
    (
      await runIntake([
        ...args("set", "contact_name"),
        "null",
        "--from",
        "Unknown",
      ])
    ).exitCode,
  ).toBe(0);
  const apply = await loadPropertyCorrections(workspace, "test.source");
  expect(
    apply("Agency", "source-one", { contact_name: "Unknown" }).contact_name,
  ).toBeNull();
});

test("a CLI name correction is applied before a location path is derived during generation", async () => {
  const key = "place:GEOID:2416620";
  const result = await runIntake([
    "cache",
    "set",
    "test.source",
    "LocationPath",
    key,
    "display_name",
    "Chevy Chase town",
    "--from",
    "Chevy Chase",
  ]);
  expect(result.exitCode).toBe(0);
  const ledger = createSourceNameToCanonicalIdLedger({ rootDir: workspace });
  await ledger.findOrCreate(
    "test.source",
    "LocationPath",
    key,
    async () => "existing-town-id",
  );
  const context = new DataContext({
    client: new EmptyDatabaseClient(),
    ledger,
    resolvedPropertyStore: {
      read: (input) => readResolvedProperty({ ...input, rootDir: workspace }),
      write: (input) => writeResolvedProperty({ ...input, rootDir: workspace }),
    },
    applyPropertyCorrections: await loadPropertyCorrections(
      workspace,
      "test.source",
    ),
  });
  const source = {
    apiVersion: INTAKE_API_VERSION,
    namespace: "test.source",
  } as const;
  context.facadeFromSource("LocationPath", {
    ...source,
    name: "/md/",
    spec: {
      location_path_id: "/md/",
      path: "/md/",
      display_name: "Maryland",
      level: "state",
      parent_location_path_id: null,
    },
  });
  context.facadeFromSource("LocationPath", {
    ...source,
    name: "/md/montgomery-county/",
    spec: {
      location_path_id: "/md/montgomery-county/",
      path: "/md/montgomery-county/",
      display_name: "Montgomery County",
      level: "administrative_area",
      parent_location_path_id: "/md/",
    },
  });
  const common = {
    level: "place",
    display_name: "Chevy Chase",
    parent_location_path_id: "/md/montgomery-county/",
  };
  const town = context.facadeFromSource("LocationPath", {
    ...source,
    name: key,
    spec: { ...common, location_path_id: key },
  });
  const cdp = context.facadeFromSource("LocationPath", {
    ...source,
    name: "place:GEOID:2416625",
    spec: { ...common, location_path_id: "place:GEOID:2416625" },
  });
  expect(await town.value("path")).toBe(
    "/md/montgomery-county/chevy-chase-town/",
  );
  expect(await cdp.value("path")).toBe("/md/montgomery-county/chevy-chase/");
  expect(await town.value("location_path_id")).toBe("existing-town-id");
  context.facadeFromSource("LocationPath", {
    ...source,
    name: "administrative_area:GEOID:24033",
    spec: {
      location_path_id: "administrative_area:GEOID:24033",
      display_name: "Prince George's County",
      level: "administrative_area",
      parent_location_path_id: "/md/",
    },
  });
  const alias = context.facadeFromSource("LocationPathAlias", {
    ...source,
    name: `${key}:administrative_area:GEOID:24033`,
    spec: {
      location_path_id: key,
      parent_location_path_id: "administrative_area:GEOID:24033",
    },
  });
  expect(await alias.toMutation()).toMatchObject({
    kind: "LocationPathAliasCreate",
    spec: {
      alias_path: "/md/prince-george-s-county/chevy-chase-town/",
      location_path_id: "existing-town-id",
    },
  });
  const mutations = await context.toMutations();
  expect(mutations.filter((m) => m.kind === "LocationPathCreate")).toHaveLength(
    5,
  );
});

test("generation rejects equal derived paths for distinct source identities", async () => {
  const context = new DataContext({
    client: new EmptyDatabaseClient(),
    ledger: createSourceNameToCanonicalIdLedger({ rootDir: workspace }),
  });
  for (const name of ["state:GEOID:01", "state:GEOID:02"]) {
    context.facadeFromSource("LocationPath", {
      apiVersion: INTAKE_API_VERSION,
      namespace: "test.source",
      name,
      spec: {
        location_path_id: name,
        path: "/same/",
        level: "state",
        display_name: "Same",
        parent_location_path_id: null,
      },
    });
  }
  await expect(context.toMutations()).rejects.toThrow(
    /Duplicate.*LocationPath.*path.*state:GEOID:01.*state:GEOID:02/,
  );
});

test("corrected source references resolve to canonical parent IDs", async () => {
  const context = new DataContext({
    client: new EmptyDatabaseClient(),
    ledger: {
      read: async (_namespace, _kind, key) => `canonical-${key}`,
      findOrCreate: async (_namespace, _kind, key) => `canonical-${key}`,
      sourceIdFor: async (_namespace, _kind, id) => id,
    },
    applyPropertyCorrections: (_kind, key, spec, applied) => {
      if (key !== "child") return spec;
      applied?.("parent_location_path_id");
      return { ...spec, parent_location_path_id: "b" };
    },
  });
  const source = {
    apiVersion: INTAKE_API_VERSION,
    namespace: "test.source",
  } as const;
  context.facadeFromSource("LocationPath", {
    ...source,
    name: "b",
    spec: {
      location_path_id: "b",
      path: "/b/",
      level: "state",
      display_name: "B",
      parent_location_path_id: null,
    },
  });
  const child = context.facadeFromSource("LocationPath", {
    ...source,
    name: "child",
    spec: {
      location_path_id: "child",
      level: "administrative_area",
      display_name: "Child",
      parent_location_path_id: "a",
    },
  });
  expect(await child.toMutation()).toMatchObject({
    spec: { path: "/b/child/", parent_location_path_id: "canonical-b" },
  });
});

test.each(["alias", "canonical"])(
  "a conflicting %s URL fails before aliases can converge",
  async (collision) => {
    const context = new DataContext({
      client: new EmptyDatabaseClient(),
      ledger: createSourceNameToCanonicalIdLedger({ rootDir: workspace }),
    });
    const source = {
      apiVersion: INTAKE_API_VERSION,
      namespace: "test.source",
    } as const;
    for (const [key, url] of [
      ["a", "/a/"],
      ["b", "/b/"],
    ])
      context.facadeFromSource("LocationPath", {
        ...source,
        name: key,
        spec: {
          location_path_id: key,
          path: url,
          display_name: key,
          level: "state",
          parent_location_path_id: null,
        },
      });
    context.facadeFromSource("LocationPathAlias", {
      ...source,
      name: "alias-a",
      spec: {
        alias_path: collision === "canonical" ? "/b/" : "/shared/",
        location_path_id: "a",
      },
    });
    if (collision === "alias")
      context.facadeFromSource("LocationPathAlias", {
        ...source,
        name: "alias-b",
        spec: { alias_path: "/shared/", location_path_id: "b" },
      });
    await expect(context.toMutations()).rejects.toThrow(/URL.*already.*owned/);
  },
);
