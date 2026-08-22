import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";
import { parseFederalLeAgencies, slugify } from "./acquire/parse.js";
import {
  LOCATIONS_FILE,
  mergeLocationStubs,
  type AgencyLocation,
} from "./locations.js";

const DEFAULT_PAGE_URL =
  "https://en.wikipedia.org/wiki/List_of_federal_law_enforcement_agencies_of_the_United_States";

export const SOURCE_HTML_FILE = "federal-le.html";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readExistingLocations(
  filePath: string,
): Promise<AgencyLocation[]> {
  if (!(await fileExists(filePath))) return [];
  const parsed = parseYaml(await readFile(filePath, "utf8")) as {
    agencies?: AgencyLocation[];
  };
  return parsed.agencies ?? [];
}

/**
 * Maintain the curated agency-locations list in state: add a blank stub for
 * every agency discovered on the page that is not already listed, preserving
 * existing curated entries. `run` skips stubs until a curator fills them in.
 */
async function maintainLocations(
  stateDir: string,
  html: string,
  log: { info: (message: string) => void },
): Promise<void> {
  const { parents } = parseFederalLeAgencies(html);
  const discovered = parents
    .flatMap((parent) => parent.agencies)
    .map((name) => ({ slug: slugify(name), name }));

  await mkdir(stateDir, { recursive: true });
  const filePath = path.join(stateDir, LOCATIONS_FILE);
  const { agencies, added } = mergeLocationStubs(
    await readExistingLocations(filePath),
    discovered,
  );
  await writeFile(filePath, stringifyYaml({ agencies }));
  log.info(
    added.length === 0
      ? `federal-le: ${LOCATIONS_FILE} already covers ${agencies.length} agencies`
      : `federal-le: added ${added.length} agency location stub(s) to ${LOCATIONS_FILE}; fill them in to import`,
  );
}

export const acquire: SourceAcquire = async ({
  sourceDir,
  state,
  env,
  logger,
}: AcquireDeps) => {
  const log = logger ?? { info() {} };
  const pageUrl = env.FEDERAL_LE_PAGE_URL ?? DEFAULT_PAGE_URL;
  await mkdir(sourceDir, { recursive: true });
  const destination = path.join(sourceDir, SOURCE_HTML_FILE);

  if (await fileExists(destination)) {
    log.info(`federal-le: have ${SOURCE_HTML_FILE}`);
  } else {
    log.info(`federal-le: downloading ${pageUrl}`);
    const response = await fetch(pageUrl);
    if (!response.ok) {
      throw new Error(
        `federal-le: failed to fetch ${pageUrl}: ${response.status}`,
      );
    }
    await writeFile(destination, await response.text());
    log.info(`federal-le: saved ${SOURCE_HTML_FILE}`);
  }

  await maintainLocations(state, await readFile(destination, "utf8"), log);
};
