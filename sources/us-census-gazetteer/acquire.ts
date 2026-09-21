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

async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`census: failed to fetch ${url}: ${response.status}`);
  }
  return response;
}

async function readBytes(response: Response): Promise<Uint8Array> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const length = response.headers.get("content-length");
  if (length !== null && bytes.length !== Number(length)) {
    throw new Error(`census: incomplete download from ${response.url}`);
  }
  return bytes;
}

export const acquire: SourceAcquire = async ({
  sourceDir,
  previousSourceDirs,
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
    previousSourceDirs,
    urls,
    fetchBytes: async (url) => readBytes(await fetchOk(url)),
    fetchRange: async (url) => {
      const response = await fetchOk(url, {
        headers: { Range: "bytes=-65557" },
      });
      const bytes = await readBytes(response);
      if (response.status === 200)
        return { bytes, totalSize: bytes.length, full: true };
      const range = response.headers
        .get("content-range")
        ?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (
        response.status !== 206 ||
        !range ||
        Number(range[2]) + 1 !== Number(range[3]) ||
        Number(range[2]) - Number(range[1]) + 1 !== bytes.length
      ) {
        throw new Error(`census: invalid range response from ${url}`);
      }
      return { bytes, totalSize: Number(range[3]), full: false };
    },
    logger: log,
  });
};
