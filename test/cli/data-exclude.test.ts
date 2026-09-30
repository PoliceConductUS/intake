import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runIntake } from "../../src/cli/index.js";
import { loadExcludedRecords } from "../../src/shared/io/excluded-records.js";
import { excludeManifestRecords } from "../../src/cli/transform/exclude-records.js";

let root: string;
let sourceDir: string;
let stateDir: string;
const args = [
  "data",
  "exclude",
  "test.source",
  "Agency",
  "515001",
  "--reason",
  "administrative placeholder, not an agency",
];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "data-exclude-"));
  sourceDir = path.join(root, "sources", "test.source");
  stateDir = path.join(root, "workspace", "state", "test.source");
  vi.stubEnv("INTAKE_WORKSPACE_TEST", path.join(root, "workspace"));
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    path.join(sourceDir, "transform.ts"),
    'export const produces = ["Agencies", "AgencyPersonnel", "Personnel"];',
  );
  vi.spyOn(process, "cwd").mockReturnValue(root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

test("saves an exclusion used by the transform cascade, preserving existing entries and comments", async () => {
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, "excluded.yaml"),
    '# Existing curation\nexcluded:\n  - kind: Agency\n    key: "10"\n    reason: not an agency\n',
  );
  const result = await runIntake(args);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("data transform test.source");
  expect(result.stdout).toContain("data generate test.source");
  const exclusions = await loadExcludedRecords(stateDir);
  expect(exclusions.get("Agency:515001")).toMatchObject({
    kind: "Agency",
    key: "515001",
    reason: args[6],
  });
  expect(exclusions.get("Agency:10")?.reason).toBe("not an agency");
  expect(
    await readFile(path.join(stateDir, "excluded.yaml"), "utf8"),
  ).toContain("# Existing curation");
  const { manifest, removed } = excludeManifestRecords(
    {
      artifacts: [
        {
          kind: "Agencies",
          records: {
            "515001": { spec: { name: "STATE OF ALABAMA" } },
            keep: { spec: { name: "Keep PD" } },
          },
        },
        {
          kind: "AgencyPersonnel",
          records: {
            excluded: { spec: { agency_id: "515001", personnel_id: "p1" } },
            keep: { spec: { agency_id: "keep", personnel_id: "p1" } },
          },
        },
        { kind: "Personnel", records: { p1: { spec: { first_name: "Pat" } } } },
      ],
    },
    exclusions,
  );
  expect(removed).toEqual({ Agency: 1, AgencyPersonnel: 1 });
  expect(Object.keys(manifest.artifacts[0].records)).toEqual(["keep"]);
  expect(Object.keys(manifest.artifacts[1].records)).toEqual(["keep"]);
  expect(Object.keys(manifest.artifacts[2].records)).toEqual(["p1"]);
});

test("creates the list and refuses to overwrite an existing exclusion", async () => {
  expect((await runIntake(args)).exitCode).toBe(0);
  const file = path.join(stateDir, "excluded.yaml");
  const before = await readFile(file, "utf8");
  const result = await runIntake([...args.slice(0, 6), "different reason"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(args[6]);
  expect(await readFile(file, "utf8")).toBe(before);
});

test.each([
  [
    "unknown source",
    [
      "data",
      "exclude",
      "absent",
      "Agency",
      "515001",
      "--reason",
      "placeholder",
    ],
  ],
  [
    "wrong kind",
    [
      "data",
      "exclude",
      "test.source",
      "Agencies",
      "515001",
      "--reason",
      "placeholder",
    ],
  ],
  [
    "blank source ID",
    [
      "data",
      "exclude",
      "test.source",
      "Agency",
      " ",
      "--reason",
      "placeholder",
    ],
  ],
  ["blank reason", [...args.slice(0, 6), " "]],
  ["missing reason", args.slice(0, 5)],
])("rejects %s without writing an exclusion", async (_, command) => {
  expect((await runIntake(command)).exitCode).toBe(1);
  expect((await loadExcludedRecords(stateDir)).size).toBe(0);
});

test("keeps exclusions in the selected workspace without reading or changing repository curation", async () => {
  const repositoryFile = path.join(sourceDir, "excluded.yaml");
  const original =
    'excluded:\n  - kind: Agency\n    key: "515001"\n    reason: repository exclusion\n';
  await writeFile(repositoryFile, original);
  expect((await runIntake(args)).exitCode).toBe(0);
  expect(
    (await loadExcludedRecords(stateDir)).get("Agency:515001")?.reason,
  ).toBe(args[6]);
  vi.stubEnv("INTAKE_WORKSPACE_TEST", path.join(root, "other-workspace"));
  expect(
    (await runIntake([...args.slice(0, 6), "other workspace reason"])).exitCode,
  ).toBe(0);
  expect(
    (
      await loadExcludedRecords(
        path.join(root, "other-workspace", "state", "test.source"),
      )
    ).get("Agency:515001")?.reason,
  ).toBe("other workspace reason");
  expect(
    (await loadExcludedRecords(stateDir)).get("Agency:515001")?.reason,
  ).toBe(args[6]);
  expect(await readFile(repositoryFile, "utf8")).toBe(original);
});
