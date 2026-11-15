import { matchSourceIds } from "../../src/cli/source-glob.js";
import { Command } from "commander";
import { registerCliCommand } from "../../src/cli/sources/index.js";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  describeSources,
  renderSourceCatalog,
} from "../../src/cli/describe-sources.js";

const tempDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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
  definition: string,
): Promise<void> {
  const dir = path.join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "intake.source.ts"),
    "export const source = " + definition + ";",
  );
}

describe("describeSources", () => {
  it("reads the operations and description from the exported source", async () => {
    const root = await makeSourcesRoot();
    await writeSource(
      root,
      "org/example/beta-source",
      '{ description: "Beta produces records.", transform() {} }',
    );
    await writeSource(
      root,
      "org/example/alpha-source",
      '{ description: "Alpha produces records.", acquire() {}, transform() {} }',
    );

    const sources = await describeSources(root);

    expect(sources).toEqual([
      {
        id: "org/example/alpha-source",
        description: "Alpha produces records.",
        phases: ["acquire", "transform"],
      },
      {
        id: "org/example/beta-source",
        description: "Beta produces records.",
        phases: ["transform"],
      },
    ]);
  });

  it("includes a marked daily worker and ignores unmarked modules", async () => {
    const root = await makeSourcesRoot();
    await mkdir(path.join(root, "org/example/search"), { recursive: true });
    await writeFile(
      path.join(root, "org/example/search/intake.source.ts"),
      "export const source = { daily: () => import('./daily.ts') };",
    );
    await writeFile(
      path.join(root, "org/example/search/daily.ts"),
      'throw Error("daily worker must not run during listing");',
    );
    await writeFile(
      path.join(root, "org/transform.ts"),
      "export const transform = () => {};",
    );
    expect(await describeSources(root)).toEqual([
      { id: "org/example/search", phases: ["daily"] },
    ]);
  });
  it("runs the exported daily operation through the CLI", async () => {
    const root = await makeSourcesRoot();
    const output = path.join(root, "sources/org/example/search/calls");
    await writeSource(
      path.join(root, "sources"),
      "org/example/search",
      "{ daily: async () => (await import('node:fs/promises')).appendFile(new URL('calls', import.meta.url), 'called') }",
    );
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const program = new Command();
    const setResult = vi.fn();
    registerCliCommand(program, { setResult });
    await program.parseAsync(["sources", "daily", "org/example/search"], {
      from: "user",
    });
    expect(await readFile(output, "utf8")).toBe("called");
    expect(setResult).toHaveBeenCalledWith({ exitCode: 0 });
  });
  it("selects an acquire-only source for acquisition and a transform-only source for local staging", async () => {
    const root = await makeSourcesRoot();
    await writeSource(root, "download", "{ acquire() {} }");
    await writeSource(root, "workbook", "{ transform() {}, produces: [] }");
    expect(await matchSourceIds(root, "*", ["acquire"])).toEqual(["download"]);
    expect(await matchSourceIds(root, "*", ["transform"])).toEqual([
      "workbook",
    ]);
    expect(await matchSourceIds(root, "*", ["acquire", "transform"])).toEqual([
      "download",
      "workbook",
    ]);
  });
  it("rejects a marker that does not export the source object", async () => {
    const root = await makeSourcesRoot();
    await mkdir(path.join(root, "example"));
    await writeFile(path.join(root, "example/intake.source.ts"), "export {};");
    await expect(describeSources(root)).rejects.toThrow(
      /must export a source object/,
    );
  });
  it("ignores unmarked directories and omits a missing description", async () => {
    const root = await makeSourcesRoot();
    await mkdir(path.join(root, "not-a-source"));
    await writeFile(
      path.join(root, "not-a-source", "acquire.ts"),
      "export const acquire = () => {};",
    );
    await writeSource(root, "plain-source", "{ transform() {} }");

    const sources = await describeSources(root);

    expect(sources).toEqual([
      { id: "plain-source", description: undefined, phases: ["transform"] },
    ]);
  });
});

describe("renderSourceCatalog", () => {
  it("renders id, phases, and description; omits the description line when absent", () => {
    expect(
      renderSourceCatalog([
        {
          id: "with-desc",
          description: "Does a thing.",
          phases: ["transform"],
        },
        { id: "no-desc", phases: ["acquire", "transform"] },
      ]),
    ).toBe(
      "with-desc  [transform]\n    Does a thing.\nno-desc  [acquire, transform]\n",
    );
  });

  it("renders produces and the derived consumes when produces is present", () => {
    expect(
      renderSourceCatalog([
        {
          id: "civil",
          phases: ["transform"],
          produces: ["CivilCases", "CivilCasePersonnel", "CivilCaseLinks"],
        },
      ]),
    ).toBe(
      "civil  [transform]\n" +
        "    produces: CivilCases, CivilCasePersonnel, CivilCaseLinks\n" +
        "    consumes: LocationPaths, AgencyPersonnel\n",
    );
  });
});
