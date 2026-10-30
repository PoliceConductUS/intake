import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Artifacts } from "../../../src/shared/io/Artifacts.js";
import { acquire } from "../../../sources/org.policeconduct.manual/acquire.js";
import { expect, test } from "vitest";
import { transformOneSource } from "../../../src/cli/data/source-pipeline.js";

test("location-only manual preparation retains agency exclusions without applying them", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "scoped-transform-"));
  const state = path.join(workspace, "state", "org.policeconduct.manual");
  const evidence =
    "excluded:\n  - kind: Agency\n    key: retired-duplicate\n    reason: User-retired duplicate page\n";
  try {
    await mkdir(state, { recursive: true });
    await writeFile(path.join(state, "excluded.yaml"), evidence);
    await acquire({
      sourceDir: workspace,
      state,
      env: {
        MANUAL_KIND: "LocationPath",
        MANUAL_RECORD: JSON.stringify({
          location_path_id: "/tx/example-county/",
          path: "/tx/example-county/",
          level: "administrative_area",
          display_name: "Texas",
          parent_location_path_id: "/tx/",
        }),
      },
      data: {} as never,
    });
    const result = await transformOneSource(
      "org.policeconduct.manual",
      { INTAKE_WORKSPACE: workspace },
      undefined,
      ["LocationPaths", "LocationPathAliases"],
    );
    expect(result).toHaveProperty("artifactsPath");
    if ("artifactsPath" in result)
      expect(
        (await Artifacts.read(result.artifactsPath)).spec.artifacts[0].kind,
      ).toBe("LocationPaths");
    expect(await readFile(path.join(state, "excluded.yaml"), "utf8")).toBe(
      evidence,
    );
    const full = await transformOneSource("org.policeconduct.manual", {
      INTAKE_WORKSPACE: workspace,
    });
    expect(full).toHaveProperty("error");
    if ("error" in full)
      expect(full.error.stderr).toContain("exactly one explicitly mapped");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("full manual transform publishes explicitly assigned exclusions on their authority", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "owned-transform-"));
  const state = path.join(workspace, "state", "org.policeconduct.manual");
  const exclusion = {
    kind: "Agency",
    key: "retired",
    reason: "Recorded duplicate exclusion",
  };
  try {
    await mkdir(state, { recursive: true });
    await writeFile(
      path.join(state, "excluded.yaml"),
      "excluded:\n  - kind: Agency\n    key: retired\n    reason: Recorded duplicate exclusion\n",
    );
    await acquire({
      sourceDir: workspace,
      state,
      env: {
        MANUAL_KIND: "LicensingAuthority",
        MANUAL_RECORD: JSON.stringify({
          id: "board",
          name: "Test board",
          location_path_id: "tx",
          source_exclusions: { "org.policeconduct.manual": [exclusion] },
        }),
      },
      data: {} as never,
    });
    const result = await transformOneSource("org.policeconduct.manual", {
      INTAKE_WORKSPACE: workspace,
    });
    expect(result).toHaveProperty("artifactsPath");
    if ("artifactsPath" in result) {
      const output = await Artifacts.read(result.artifactsPath);
      expect(
        output.spec.artifacts.find((a) => a.kind === "LicensingAuthorities")
          ?.spec.records.board,
      ).toMatchObject({
        spec: {
          source_exclusions: { "org.policeconduct.manual": [exclusion] },
        },
      });
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
