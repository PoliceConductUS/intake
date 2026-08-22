import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";
import { parseFederalLeAgencies, slugify } from "./acquire/parse.js";
import { ORGS_FILE, mergeOrgs, type Org } from "./model.js";

const DEFAULT_PAGE_URL =
  "https://en.wikipedia.org/wiki/List_of_United_States_federal_law_enforcement_agencies";

export const SOURCE_HTML_FILE = "federal-le.html";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readExistingOrgs(filePath: string): Promise<Org[]> {
  if (!(await fileExists(filePath))) return [];
  const parsed = parseYaml(await readFile(filePath, "utf8")) as {
    agencies?: Org[];
  };
  return parsed.agencies ?? [];
}

async function maintainOrgs(
  stateDir: string,
  html: string,
  log: { info: (message: string) => void },
): Promise<void> {
  const { agencies } = parseFederalLeAgencies(html);
  const discovered: Org[] = agencies.map((name) => ({
    slug: slugify(name),
    name,
  }));

  await mkdir(stateDir, { recursive: true });
  const filePath = path.join(stateDir, ORGS_FILE);
  const { orgs, added } = mergeOrgs(
    await readExistingOrgs(filePath),
    discovered,
  );
  await writeFile(filePath, stringifyYaml({ agencies: orgs }));
  log.info(
    added.length === 0
      ? `federal-le: ${ORGS_FILE} already lists ${orgs.length} agencies`
      : `federal-le: added ${added.length} agency/agencies to ${ORGS_FILE}`,
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

  await maintainOrgs(state, await readFile(destination, "utf8"), log);
};
