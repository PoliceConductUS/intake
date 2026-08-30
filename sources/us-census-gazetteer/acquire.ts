import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/transform/source-transform.js";
import { discoverLatestGazetteerLinks } from "./acquire/discovery.js";
import {
  downloadGazetteerSources,
  gazetteerSourceUrls,
} from "./acquire/download.js";

const DEFAULT_PAGE_URL =
  "https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html";

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`census: failed to fetch ${url}: ${response.status}`);
  }
  return response;
}

export const acquire: SourceAcquire = async ({
  sourceDir,
  env,
  logger,
}: AcquireDeps) => {
  const log = logger ?? { info() {} };
  const pageUrl = env.CENSUS_GAZETTEER_PAGE_URL ?? DEFAULT_PAGE_URL;

  log.info(`census: discovering sources from ${pageUrl}`);
  const links = discoverLatestGazetteerLinks(
    await (await fetchOk(pageUrl)).text(),
    pageUrl,
  );
  const urls = gazetteerSourceUrls(links);
  log.info(`census: ${links.year} — ${urls.length} source files`);

  await downloadGazetteerSources({
    sourceDir,
    urls,
    fetchBytes: async (url) =>
      new Uint8Array(await (await fetchOk(url)).arrayBuffer()),
    logger: log,
  });
};
