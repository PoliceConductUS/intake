import { parse as parseHtml } from "node-html-parser";
import { classifyGazetteerRole, type GazetteerRole } from "../lib/roles.js";

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

type DiscoveredLink = { searchText: string; url: string };

type ClassifiedLinks = {
  singles: Map<GazetteerRole, string>;
  placeTigerUrls: string[];
};

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
  for (const link of links) {
    const role = classifyGazetteerRole(link.searchText);
    if (role === undefined) continue;
    if (role === "placeTigerZips") {
      placeTigerUrls.push(link.url);
    } else if (!singles.has(role)) {
      singles.set(role, link.url);
    }
  }
  return { singles, placeTigerUrls };
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
