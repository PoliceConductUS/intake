export type SearchRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  position?: number;
};
export type QueryProfile = { term: string; path: string };
export type Traffic = QueryProfile & { clicks: number; impressions: number };
export type Match = QueryProfile & { articleKey: string };
export const pairKey = ({ term, path }: QueryProfile) =>
  JSON.stringify([path, term]);

export async function collectTraffic(
  read: (offset: number) => Promise<SearchRow[]>,
  paths: Set<string>,
  origin: string,
) {
  const pairs: Traffic[] = [];
  let offset = 0;
  while (true) {
    const rows = await read(offset);
    if (!rows.length) break;
    for (const {
      keys: [term, page],
      clicks,
      impressions,
    } of rows) {
      const url = new URL(page);
      if (
        url.origin === origin &&
        !url.search &&
        !url.hash &&
        paths.has(url.pathname)
      )
        pairs.push({ term, path: url.pathname, clicks, impressions });
    }
    offset += rows.length;
  }
  return pairs.sort(
    (a, b) =>
      b.impressions - a.impressions || pairKey(a).localeCompare(pairKey(b)),
  );
}
export function homepageRanking(
  pairs: Traffic[],
  matches: Match[],
  newestByProfile: Map<string, string>,
) {
  const matched = new Set(matches.map(pairKey));
  const counted = new Set<string>();
  const scores = new Map<string, number>();
  for (const pair of pairs) {
    const key = pairKey(pair);
    const article = newestByProfile.get(pair.path);
    if (!article || !matched.has(key) || counted.has(key)) continue;
    counted.add(key);
    scores.set(article, (scores.get(article) ?? 0) + pair.clicks);
  }
  return Array.from(scores, ([articleKey, clicks]) => ({ articleKey, clicks }))
    .sort(
      (a, b) => b.clicks - a.clicks || a.articleKey.localeCompare(b.articleKey),
    )
    .slice(0, 25)
    .map((s, i) => ({ ...s, position: i + 1 }));
}
export async function searchFirst<T>(
  urls: Iterable<string> | AsyncIterable<string>,
  inspect: (
    url: string,
  ) => Promise<{ cached: boolean; exhausted?: boolean; match?: T }>,
  limit = 10,
) {
  let checked = 0;
  const seen = new Set<string>();
  for await (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const result = await inspect(url);
    if (!result.cached) checked++;
    if (result.match !== undefined || result.exhausted || checked === limit)
      return { checked, match: result.match };
  }
  return { checked, match: undefined };
}
export function shiftDate(iso: string, days: number) {
  const date = new Date(iso + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
