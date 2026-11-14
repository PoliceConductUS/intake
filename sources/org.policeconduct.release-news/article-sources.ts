import type {
  NewsImportContext,
  ReleaseArticle,
  SourceRef,
} from "../../src/shared/release-news.js";
import {
  newsNamespace,
  publisherRef,
  recordKey,
  type NewsAliases,
} from "../google.news/aliases.js";
import { recordOrigin } from "../../src/cli/transform/source-transform.js";

// The alias file names Google publisher URLs. A built article can additionally
// identify the same record by its database ID and its original source.
export async function releaseArticleKeys(
  articles: ReleaseArticle[],
  aliases: NewsAliases,
  data: NewsImportContext,
): Promise<Map<string, string>> {
  const groups = new Map<
    string,
    {
      sources: Map<string, SourceRef>;
      canonicalIds: Set<string>;
      normalizedUrls: Set<string>;
    }
  >();
  function sourceGroup(url: string) {
    const target = aliases[url] ?? url;
    let group = groups.get(target);
    if (!group) {
      group = {
        sources: new Map(),
        canonicalIds: new Set(),
        normalizedUrls: new Set(),
      };
      groups.set(target, group);
    }
    for (const sourceId of [target, url]) {
      const ref = { namespace: newsNamespace, sourceId };
      group.sources.set(recordKey(ref), ref);
      group.normalizedUrls.add(sourceId);
    }
    return group;
  }
  for (const url of Object.keys(aliases)) sourceGroup(url);
  const originTargets = new Map<string, string>();
  for (const article of articles) {
    const urls = new Set<string>();
    for (const occurrence of Object.values(article.occurrences)) {
      if (occurrence.namespace !== newsNamespace) continue;
      if (occurrence.sourceId !== publisherRef(occurrence.url).sourceId)
        throw Error("Invalid publisher URL source ID at " + occurrence.url);
      urls.add(occurrence.sourceId);
    }
    if (article.namespace === newsNamespace && !article.canonicalId) {
      if (!article.sourceId || !urls.has(article.sourceId))
        throw Error(
          "Article source ID does not identify one of its publisher occurrences.",
        );
    }
    if (!urls.size) continue;
    const targets = new Set([...urls].map((url) => aliases[url] ?? url));
    if (targets.size !== 1)
      throw Error(
        "Missing CoverageLink alias for publisher occurrences: " +
          [...urls].join(", "),
      );
    const group = sourceGroup([...urls][0]!);
    if (article.canonicalId) group.canonicalIds.add(article.canonicalId);
    const origin = recordOrigin({
      source_namespace: article.namespace,
      source_id: article.sourceId,
    });
    if (origin) {
      const key = recordKey(article);
      const target = [...targets][0]!;
      if (originTargets.has(key) && originTargets.get(key) !== target)
        throw Error(
          "Conflicting CoverageLink alias groups for article source " + key,
        );
      originTargets.set(key, target);
      group.sources.set(key, {
        namespace: origin.namespace,
        sourceId: origin.name,
      });
    }
  }
  const plans = [...groups.values()].map((group) => ({
    sources: [...group.sources.values()],
    canonicalIds: [...group.canonicalIds],
    normalizedUrls: [...group.normalizedUrls],
  }));
  const ids = await data.bindArticleSources(plans);
  const keys = new Map<string, string>();
  plans.forEach((plan, i) => {
    const key = recordKey({ canonicalId: ids[i]! });
    for (const ref of plan.sources) keys.set(recordKey(ref), key);
    keys.set(key, key);
  });
  return keys;
}
