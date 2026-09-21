import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/transform/source-transform.js";
import {
  assertPublishedSourceLinks,
  discoverLatestGazetteerLinks,
  selectPublishedGazetteerPage,
} from "./acquire/discovery.js";
import {
  downloadGazetteerSources,
  gazetteerSourceUrls,
} from "./acquire/download.js";

const DEFAULT_PAGE_URL =
  "https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html";
const TIGER_INDEX_URL = "https://www2.census.gov/geo/tiger/";

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
  const html = await (await fetchOk(pageUrl)).text();
  const selected = selectPublishedGazetteerPage(
    html,
    pageUrl,
    await (await fetchOk(TIGER_INDEX_URL)).text(),
    TIGER_INDEX_URL,
  );
  log.info(
    `census: selected shared Gazetteer/TIGER shapefile release ${selected.year}`,
  );
  const links = discoverLatestGazetteerLinks(
    selected.pageUrl === pageUrl
      ? html
      : await (await fetchOk(selected.pageUrl)).text(),
    selected.pageUrl,
  );
  if (links.year !== selected.year) {
    throw new Error(
      `census: expected Gazetteer ${selected.year}, received ${links.year}`,
    );
  }
  const tigerUrls = [
    links.stateTigerUrl,
    links.countyTigerUrl,
    ...links.placeTigerUrls,
    ...links.countySubdivisionTigerUrls,
    ...links.consolidatedCityTigerUrls,
  ];
  const directoryUrls = [
    ...new Set(tigerUrls.map((url) => new URL(".", url).href)),
  ];
  await Promise.all(
    directoryUrls.map(async (directoryUrl) => {
      assertPublishedSourceLinks(
        await (await fetchOk(directoryUrl)).text(),
        directoryUrl,
        tigerUrls.filter((url) => new URL(".", url).href === directoryUrl),
      );
    }),
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
