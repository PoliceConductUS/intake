import { parse as parseHtml } from "node-html-parser";
import {
  classifyGazetteerRole,
  type GazetteerRole,
  CONSOLIDATED_CITY_STATES,
} from "../lib/roles.js";

const STATE_GEOIDS = [
  "01",
  "02",
  "04",
  "05",
  "06",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
  "30",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
  "39",
  "40",
  "41",
  "42",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "50",
  "51",
  "53",
  "54",
  "55",
  "56",
];

export type GazetteerLinks = {
  year: string;
  stateUrl: string;
  administrativeAreaUrl: string;
  placesUrl: string;
  stateTigerUrl: string;
  countyTigerUrl: string;
  placeTigerUrls: string[];
  countySubdivisionTigerUrls: string[];
  consolidatedCityTigerUrls: string[];
  hierarchyUrl?: string;
};

type DiscoveredLink = { searchText: string; url: string };

type ClassifiedLinks = {
  singles: Map<GazetteerRole, string>;
  placeTigerUrls: string[];
  countySubdivisionTigerUrls: string[];
  consolidatedCityTigerUrls: string[];
};

export function selectPublishedGazetteerPage(
  html: string,
  pageUrl: string,
  tigerIndexHtml: string,
  tigerIndexUrl: string,
): { year: string; pageUrl: string } {
  const current = discoverLatestGazetteerLinks(html, pageUrl);
  const pages = new Map<string, string>([[current.year, pageUrl]]);
  for (const link of extractLinks(html, pageUrl)) {
    const url = new URL(link.url);
    const year = url.pathname.match(/gazetteer-files\.(20\d{2})\.html$/)?.[1];
    if (year && Number(year) < Number(current.year)) {
      url.hash = "";
      pages.set(year, url.href);
    }
  }
  const years = extractLinks(tigerIndexHtml, tigerIndexUrl)
    .map((link) => link.url.match(/\/TIGER(20\d{2})\/$/)?.[1])
    .filter((year): year is string => year !== undefined && pages.has(year))
    .sort((a, b) => Number(b) - Number(a));
  if (!years.length) {
    throw new Error(
      "census: no shared published Gazetteer/TIGER shapefile year",
    );
  }
  return { year: years[0], pageUrl: pages.get(years[0])! };
}

export function assertPublishedSourceLinks(
  html: string,
  directoryUrl: string,
  expectedUrls: readonly string[],
): void {
  const published = new Set(
    extractLinks(html, directoryUrl).map((link) => link.url),
  );
  const missing = expectedUrls.filter((url) => !published.has(url));
  if (missing.length) {
    throw new Error(
      `census: required TIGER files are not published: ${missing.join(", ")}`,
    );
  }
}

export function discoverLatestGazetteerLinks(
  html: string,
  pageUrl: string,
): GazetteerLinks {
  const links = extractLinks(html, pageUrl);
  const year = findLatestSourceYear(links);
  if (year === undefined) {
    throw new Error("No Census Gazetteer source year links were discovered");
  }
  const classified = classifyLinks(forYear(links, year));

  const missing = (["statesZip", "adminAreasZip", "placesZip"] as const).filter(
    (role) => !classified.singles.has(role),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required ${year} Gazetteer source links: ${missing.join(", ")}`,
    );
  }

  const selectedStates = classified.placeTigerUrls.length
    ? classified.placeTigerUrls.map(
        (url) => new URL(url).pathname.match(/tl_\d{4}_(\d{2})_place\.zip/)![1],
      )
    : STATE_GEOIDS;
  return {
    year: String(year),
    stateUrl: classified.singles.get("statesZip")!,
    administrativeAreaUrl: classified.singles.get("adminAreasZip")!,
    placesUrl: classified.singles.get("placesZip")!,
    stateTigerUrl:
      classified.singles.get("stateTigerZip") ??
      `https://www2.census.gov/geo/tiger/TIGER${year}/STATE/tl_${year}_us_state.zip`,
    countyTigerUrl:
      classified.singles.get("countyTigerZip") ??
      `https://www2.census.gov/geo/tiger/TIGER${year}/COUNTY/tl_${year}_us_county.zip`,
    placeTigerUrls:
      classified.placeTigerUrls.length > 0
        ? classified.placeTigerUrls
        : STATE_GEOIDS.map(
            (geoid) =>
              `https://www2.census.gov/geo/tiger/TIGER${year}/PLACE/tl_${year}_${geoid}_place.zip`,
          ),
    countySubdivisionTigerUrls:
      classified.countySubdivisionTigerUrls.length > 0
        ? classified.countySubdivisionTigerUrls
        : selectedStates.map(
            (geoid) =>
              `https://www2.census.gov/geo/tiger/TIGER${year}/COUSUB/tl_${year}_${geoid}_cousub.zip`,
          ),
    consolidatedCityTigerUrls:
      classified.consolidatedCityTigerUrls.length > 0
        ? classified.consolidatedCityTigerUrls
        : CONSOLIDATED_CITY_STATES.filter((geoid) =>
            selectedStates.includes(geoid),
          ).map(
            (geoid) =>
              `https://www2.census.gov/geo/tiger/TIGER${year}/CONCITY/tl_${year}_${geoid}_concity.zip`,
          ),
    hierarchyUrl: classified.singles.get("hierarchyFile"),
  };
}

function extractLinks(html: string, pageUrl: string): DiscoveredLink[] {
  return parseHtml(html)
    .querySelectorAll("a")
    .flatMap((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href) return [];
      let url: string;
      try {
        url = new URL(href, pageUrl).href;
      } catch {
        return [];
      }
      const label = anchor.text.replace(/\s+/g, " ").trim();
      return [{ url, searchText: `${url} ${label}`.toLowerCase() }];
    });
}

function forYear(links: DiscoveredLink[], year: number): DiscoveredLink[] {
  return links.filter((link) => link.searchText.includes(String(year)));
}

function classifyLinks(links: DiscoveredLink[]): ClassifiedLinks {
  const singles = new Map<GazetteerRole, string>();
  const placeTigerUrls: string[] = [];
  const countySubdivisionTigerUrls: string[] = [];
  const consolidatedCityTigerUrls: string[] = [];
  for (const link of links) {
    const role = classifyGazetteerRole(link.searchText);
    if (role === undefined) continue;
    if (role === "placeTigerZips") {
      placeTigerUrls.push(link.url);
    } else if (role === "countySubdivisionTigerZips") {
      countySubdivisionTigerUrls.push(link.url);
    } else if (role === "consolidatedCityTigerZips") {
      consolidatedCityTigerUrls.push(link.url);
    } else if (!singles.has(role)) {
      singles.set(role, link.url);
    }
  }
  return {
    singles,
    placeTigerUrls,
    countySubdivisionTigerUrls,
    consolidatedCityTigerUrls,
  };
}

function findLatestSourceYear(links: DiscoveredLink[]): number | undefined {
  const years = new Set<number>();
  for (const link of links) {
    for (const match of link.searchText.matchAll(/(?<!\d)20\d{2}(?!\d)/g)) {
      years.add(Number(match[0]));
    }
  }
  const descending = [...years].sort((left, right) => right - left);
  for (const year of descending) {
    const { singles } = classifyLinks(forYear(links, year));
    if (
      singles.has("statesZip") &&
      singles.has("adminAreasZip") &&
      singles.has("placesZip")
    ) {
      return year;
    }
  }
  return descending[0];
}
