import { parse as parseHtml } from "node-html-parser";

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
  hierarchyUrl?: string;
};

type DiscoveredLink = { label: string; searchText: string; url: string };

export function discoverLatestGazetteerLinks(
  html: string,
  pageUrl: string,
): GazetteerLinks {
  const links = extractLinks(html, pageUrl);
  const year = findLatestSourceYear(links);
  if (year === undefined) {
    throw new Error("No Census Gazetteer source year links were discovered");
  }
  const yearLinks = links.filter((link) =>
    link.searchText.includes(String(year)),
  );

  const stateUrl = findSourceUrl(yearLinks, isStateGazetteerLink);
  const administrativeAreaUrl = findSourceUrl(
    yearLinks,
    isAdministrativeAreaGazetteerLink,
  );
  const placesUrl = findSourceUrl(yearLinks, isPlaceGazetteerLink);
  const missing = Object.entries({
    stateUrl,
    administrativeAreaUrl,
    placesUrl,
  })
    .filter(([, url]) => url === undefined)
    .map(([field]) => field);
  if (missing.length > 0) {
    throw new Error(
      `Missing required ${year} Gazetteer source links: ${missing.join(", ")}`,
    );
  }

  return {
    year: String(year),
    stateUrl: stateUrl!,
    administrativeAreaUrl: administrativeAreaUrl!,
    placesUrl: placesUrl!,
    stateTigerUrl:
      findSourceUrl(yearLinks, isStateTigerLink) ??
      `https://www2.census.gov/geo/tiger/TIGER${year}/STATE/tl_${year}_us_state.zip`,
    countyTigerUrl:
      findSourceUrl(yearLinks, isCountyTigerLink) ??
      `https://www2.census.gov/geo/tiger/TIGER${year}/COUNTY/tl_${year}_us_county.zip`,
    placeTigerUrls:
      findPlaceTigerUrls(yearLinks) ??
      STATE_GEOIDS.map(
        (geoid) =>
          `https://www2.census.gov/geo/tiger/TIGER${year}/PLACE/tl_${year}_${geoid}_place.zip`,
      ),
    hierarchyUrl: findSourceUrl(yearLinks, isHierarchyLink),
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
      return [{ label, url, searchText: `${url} ${label}`.toLowerCase() }];
    });
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
    const yearLinks = links.filter((link) =>
      link.searchText.includes(String(year)),
    );
    if (
      findSourceUrl(yearLinks, isStateGazetteerLink) !== undefined &&
      findSourceUrl(yearLinks, isAdministrativeAreaGazetteerLink) !==
        undefined &&
      findSourceUrl(yearLinks, isPlaceGazetteerLink) !== undefined
    ) {
      return year;
    }
  }
  return descending[0];
}

function findSourceUrl(
  links: DiscoveredLink[],
  predicate: (link: DiscoveredLink) => boolean,
): string | undefined {
  return links.find(predicate)?.url;
}

function findPlaceTigerUrls(links: DiscoveredLink[]): string[] | undefined {
  const urls = links.filter(isPlaceTigerLink).map((link) => link.url);
  return urls.length > 0 ? urls : undefined;
}

function isZip(link: DiscoveredLink): boolean {
  return link.url.toLowerCase().endsWith(".zip");
}

function isGazetteerZip(link: DiscoveredLink): boolean {
  return isZip(link) && /gazetteer|_gaz_/.test(link.searchText);
}

function isStateGazetteerLink(link: DiscoveredLink): boolean {
  return (
    isGazetteerZip(link) && /gaz_state|state_national/.test(link.searchText)
  );
}

function isAdministrativeAreaGazetteerLink(link: DiscoveredLink): boolean {
  return (
    isGazetteerZip(link) &&
    /gaz_count|counties_national|county_national/.test(link.searchText)
  );
}

function isPlaceGazetteerLink(link: DiscoveredLink): boolean {
  return (
    isGazetteerZip(link) && /gaz_place|place_national/.test(link.searchText)
  );
}

function isStateTigerLink(link: DiscoveredLink): boolean {
  return (
    isZip(link) &&
    /tiger20\d{2}\/state|tl_20\d{2}_us_state/.test(link.searchText)
  );
}

function isCountyTigerLink(link: DiscoveredLink): boolean {
  return (
    isZip(link) &&
    /tiger20\d{2}\/county|tl_20\d{2}_us_county/.test(link.searchText)
  );
}

function isPlaceTigerLink(link: DiscoveredLink): boolean {
  return (
    isZip(link) &&
    /tiger20\d{2}\/place|tl_20\d{2}_\d{2}_place/.test(link.searchText)
  );
}

function isHierarchyLink(link: DiscoveredLink): boolean {
  return (
    /relationship|rel20\d{2}/.test(link.searchText) &&
    /place/.test(link.searchText) &&
    /count/.test(link.searchText)
  );
}
