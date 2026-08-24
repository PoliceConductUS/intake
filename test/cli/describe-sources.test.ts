import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import {
  describeSources,
  renderSourceCatalog,
} from "../../src/cli/describe-sources.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

async function makeSourcesRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "describe-sources-"));
  tempDirs.push(dir);
  return dir;
}

async function writeSource(
  root: string,
  id: string,
  files: { run?: string; acquire?: string },
): Promise<void> {
  const dir = path.join(root, id);
  await mkdir(dir, { recursive: true });
  if (files.run !== undefined)
    await writeFile(path.join(dir, "run.ts"), files.run);
  if (files.acquire !== undefined)
    await writeFile(path.join(dir, "acquire.ts"), files.acquire);
}

describe("describeSources", () => {
  it("derives phases from module presence and description from the module", async () => {
    const root = await makeSourcesRoot();
    await writeSource(root, "beta-source", {
      run: `export const description = "Beta produces records.";\nexport const run = () => {};\n`,
    });
    await writeSource(root, "alpha-source", {
      run: `export const description = "Alpha produces records.";\nexport const run = () => {};\n`,
      acquire: `export const acquire = async () => {};\n`,
    });

    const sources = await describeSources(root);

    expect(sources).toEqual([
      {
        id: "alpha-source",
        description: "Alpha produces records.",
        phases: ["acquire", "run"],
      },
      {
        id: "beta-source",
        description: "Beta produces records.",
        phases: ["run"],
      },
    ]);
  });

  it("ignores directories without a run module and omits a missing description", async () => {
    const root = await makeSourcesRoot();
    await writeSource(root, "not-a-source", {
      acquire: `export const acquire = async () => {};\n`,
    });
    await writeSource(root, "plain-source", {
      run: `export const run = () => {};\n`,
    });

    const sources = await describeSources(root);

    expect(sources).toEqual([
      { id: "plain-source", description: undefined, phases: ["run"] },
    ]);
  });
});

describe("renderSourceCatalog", () => {
  it("renders id, phases, and description; omits the description line when absent", () => {
    expect(
      renderSourceCatalog([
        { id: "with-desc", description: "Does a thing.", phases: ["run"] },
        { id: "no-desc", phases: ["acquire", "run"] },
      ]),
    ).toBe("with-desc  [run]\n    Does a thing.\nno-desc  [acquire, run]\n");
  });

  it("renders produces and the derived consumes when produces is present", () => {
    expect(
      renderSourceCatalog([
        {
          id: "civil",
          phases: ["run"],
          produces: ["CivilCases", "CivilCaseOfficers", "CivilCaseLinks"],
        },
      ]),
    ).toBe(
      "civil  [run]\n" +
        "    produces: CivilCases, CivilCaseOfficers, CivilCaseLinks\n" +
        "    consumes: LocationPaths, AgencyPersonnel\n",
    );
  });
});
