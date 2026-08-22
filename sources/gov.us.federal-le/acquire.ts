import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";

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

export const acquire: SourceAcquire = async ({
  sourceDir,
  env,
  logger,
}: AcquireDeps) => {
  const log = logger ?? { info() {} };
  const pageUrl = env.FEDERAL_LE_PAGE_URL ?? DEFAULT_PAGE_URL;
  await mkdir(sourceDir, { recursive: true });
  const destination = path.join(sourceDir, SOURCE_HTML_FILE);

  if (await fileExists(destination)) {
    log.info(`federal-le: have ${SOURCE_HTML_FILE}`);
    return;
  }

  log.info(`federal-le: downloading ${pageUrl}`);
  const response = await fetch(pageUrl);
  if (!response.ok) {
    throw new Error(
      `federal-le: failed to fetch ${pageUrl}: ${response.status}`,
    );
  }
  await writeFile(destination, await response.text());
  log.info(`federal-le: saved ${SOURCE_HTML_FILE}`);
};
