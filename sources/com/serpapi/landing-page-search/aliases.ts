import { moduleSourceNamespace } from "../../../../src/cli/source-namespace.js";
import { normalizeCoverageUrl } from "../../../../src/cli/import/artifacts/facades/coverage-resolvers.js";
import type {
  NewsOccurrence,
  ReleaseArticle,
  ReleaseIdentity,
} from "../../../lib/news.js";
import type { NewsStorage } from "./storage.js";

export const newsNamespace = moduleSourceNamespace(import.meta.url);
export const publisherRef = (url: string) => ({
  namespace: newsNamespace,
  sourceId: normalizeCoverageUrl(url),
});
export type NewsAliases = Record<string, string>;
export function resolveNewsAliases(input: unknown): NewsAliases {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Expected a CoverageLink alias map");
  const edges: NewsAliases = {};
  for (const [from, to] of Object.entries(input)) {
    for (const url of [from, to])
      if (
        typeof url !== "string" ||
        !URL.canParse(url) ||
        !url.startsWith("https://") ||
        normalizeCoverageUrl(url) !== url
      )
        throw Error(
          "Expected normalized publisher URL in CoverageLink aliases",
        );
    edges[from] = to;
  }
  const resolved: NewsAliases = {};
  for (const from of Object.keys(edges)) {
    let target = from;
    const seen = new Set<string>();
    while (edges[target] && !resolved[target]) {
      if (seen.has(target))
        throw Error("Cycle in CoverageLink aliases at " + target);
      seen.add(target);
      target = edges[target];
    }
    for (const url of seen) resolved[url] = resolved[target] ?? target;
  }
  return resolved;
}
function releaseKey(release: string) {
  return `builds/${release}/data/alias.json`;
}
async function readFile(store: NewsStorage, release: string) {
  const record = await store.readJson<Record<string, unknown>>(
    releaseKey(release),
  );
  if (!record) throw Error("Missing release alias file for " + release);
  return { ...record, aliases: resolveNewsAliases(record.value?.CoverageLink) };
}
export async function readNewsAliases(store: NewsStorage, release: string) {
  return (await readFile(store, release)).aliases;
}
export async function saveNewsAliases(
  store: NewsStorage,
  release: string,
  articles: ReleaseArticle[],
) {
  for (;;) {
    const saved = await readFile(store, release);
    const aliases = { ...saved.aliases };
    for (const article of articles) {
      const urls = Object.values(article.occurrences)
        .filter((o) => o.namespace === newsNamespace && o.sourceId)
        .map((o) => o.sourceId!);
      if (!urls.length) continue;
      const first =
        urls.includes(article.sourceId ?? "") &&
        article.namespace === newsNamespace
          ? article.sourceId!
          : urls[0];
      const root = (url: string) => {
        while (aliases[url]) url = aliases[url];
        return url;
      };
      const target = root(first);
      for (const url of urls) {
        const other = root(url);
        if (other !== target) aliases[other] = target;
      }
    }
    if (Object.keys(aliases).length === Object.keys(saved.aliases).length)
      return saved.aliases;
    const flattened = resolveNewsAliases(aliases);
    if (
      await store.writeJson(
        releaseKey(release),
        { ...saved.value, CoverageLink: flattened },
        saved.etag,
      )
    )
      return flattened;
  }
}
export function recordKey(ref: ReleaseIdentity, aliases: NewsAliases = {}) {
  if (ref.namespace && ref.sourceId)
    return JSON.stringify([
      ref.namespace,
      (ref.namespace === newsNamespace && aliases[ref.sourceId]) ||
        ref.sourceId,
    ]);
  if (ref.canonicalId) return JSON.stringify([ref.canonicalId]);
  throw Error("Missing record identity");
}
export function articleKeys(article: ReleaseArticle, aliases: NewsAliases) {
  const keys = new Set([recordKey(article, aliases)]);
  if (article.canonicalId)
    keys.add(recordKey({ canonicalId: article.canonicalId }));
  for (const o of Object.values(article.occurrences)) {
    if (o.namespace && o.sourceId) keys.add(recordKey(o, aliases));
    else if (article.canonicalId)
      keys.add(recordKey(publisherRef(o.url), aliases));
  }
  return keys;
}
export function samePublisherGroup(
  a: NewsOccurrence,
  b: NewsOccurrence,
  aliases: NewsAliases,
) {
  if (
    (a.namespace && a.namespace !== newsNamespace) ||
    (b.namespace && b.namespace !== newsNamespace)
  )
    return false;
  return (
    recordKey(a.sourceId ? a : publisherRef(a.url), aliases) ===
    recordKey(b.sourceId ? b : publisherRef(b.url), aliases)
  );
}
