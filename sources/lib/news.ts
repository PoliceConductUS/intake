import { createHash } from "node:crypto";
import { parse } from "node-html-parser";
import { normalizeCoverageUrl } from "../../src/cli/import/artifacts/facades/coverage-resolvers.js";

export class NewsExtractionError extends Error {}
import type {
  NewsAssignment,
  NewsOccurrence,
  ReleaseArticle,
  ReleaseRelationship,
  NewsInference,
} from "../../src/shared/release-news.js";
export type {
  SourceRef,
  NewsAssignment,
  NewsOccurrence,
  ReleaseIdentity,
  ReleaseRelationship,
  ReleaseArticle,
  NewsInference,
} from "../../src/shared/release-news.js";
export function normalizedParagraph(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\p{P}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}
export function chicagoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function eligibleNewsDate(
  publishedAt: string | null,
  now: Date,
): boolean {
  if (!publishedAt || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) return false;
  const today = Date.parse(chicagoDate(now) + "T00:00:00Z");
  const published = Date.parse(publishedAt + "T00:00:00Z");
  return (
    Number.isFinite(published) &&
    new Date(published).toISOString().slice(0, 10) === publishedAt &&
    published <= today &&
    published >= today - 6 * 86400000
  );
}
function dateOnly(raw: string | undefined): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw))
    return /^\d{4}-\d{2}-\d{2}T/.test(raw) ? raw.slice(0, 10) : null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? null : chicagoDate(parsed);
}
export async function processNewsOccurrence({
  html,
  url,
  correctedSelector,
  domainRank,
  assignments,
  infer,
}: {
  html: string;
  url: string;
  correctedSelector?: string;
  domainRank?: number | null;
  assignments: readonly NewsAssignment[];
  infer: NewsInference;
}): Promise<NewsOccurrence> {
  const doc = parse(html);
  const meta = (field: string) =>
    doc
      .querySelector(`meta[property="${field}"],meta[name="${field}"]`)
      ?.getAttribute("content")
      ?.trim();
  const title =
    meta("og:title") ??
    doc.querySelector("h1")?.text.trim() ??
    doc.querySelector("title")?.text.trim();
  if (!title)
    throw new NewsExtractionError("Article has no source title: " + url);
  const selector =
    correctedSelector ??
    ["article", "main", "body"].find((s) => doc.querySelector(s)) ??
    "body";
  const selected = doc.querySelector(selector);
  if (!selected)
    throw new NewsExtractionError(
      "Body selector did not match at " + url + ": " + selector,
    );
  for (const node of selected.querySelectorAll(
    "nav,aside,footer,script,style,header,form",
  ))
    node.remove();
  const texts = selected
    .querySelectorAll("p")
    .map((p) => p.text.trim())
    .filter(Boolean);
  const paragraphs = (
    texts.length ? texts : [selected.structuredText.trim()].filter(Boolean)
  ).map((text) => ({
    text,
    hash: createHash("sha256").update(normalizedParagraph(text)).digest("hex"),
  }));
  if (!paragraphs.length)
    throw new NewsExtractionError("Selected body is empty at " + url);
  const body = paragraphs.map((p) => p.text).join("\n\n");
  const haystack =
    " " + normalizedParagraph(body).replace(/[^\p{L}\p{N}]+/gu, " ") + " ";
  const hasName = (name: string) =>
    haystack.includes(
      " " + normalizedParagraph(name).replace(/[^\p{L}\p{N}]+/gu, " ") + " ",
    );
  const candidates = assignments.filter(
    (a) => hasName(a.agencyName) && hasName(a.personnelName),
  );
  const result = candidates.length
    ? await infer(body, candidates)
    : { summary: null, support: [] };
  const support = result.support.map((item) => {
    if (
      !candidates.some((a) => a.id === item.assignmentId) ||
      !item.paragraphIndexes.length ||
      item.paragraphIndexes.some((i) => !Number.isInteger(i) || !paragraphs[i])
    )
      throw new Error(
        "Inference returned unsupported assignment or passage for " + url,
      );
    return {
      assignmentId: item.assignmentId,
      paragraphHashes: [
        ...new Set(item.paragraphIndexes.map((i) => paragraphs[i]!.hash)),
      ],
    };
  });
  const original = selected
    .querySelectorAll("a[href]")
    .find((link) =>
      /originally (published|reported|appeared)|original (article|story|publisher)/i.test(
        link.parentNode?.text ?? link.text,
      ),
    );
  const attribution =
    original?.getAttribute("href") ??
    doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  return {
    url,
    title,
    sourceName: meta("og:site_name") ?? null,
    publishedAt: dateOnly(
      meta("article:published_time") ??
        meta("datePublished") ??
        doc
          .querySelector('[itemprop="datePublished"]')
          ?.getAttribute("datetime"),
    ),
    summary: result.summary,
    selector,
    observedAt: new Date().toISOString(),
    body,
    paragraphs,
    publisherAttribution: attribution ? new URL(attribution, url).href : null,
    domainRank: domainRank ?? null,
    support,
    ...(selector === "body" || !texts.length
      ? {
          uncertainty:
            "No distinct article paragraphs or main article container identified.",
        }
      : {}),
  };
}
export function selectPreferredOccurrence(
  occurrences: readonly NewsOccurrence[],
): NewsOccurrence {
  if (!occurrences.length)
    throw new Error("Article has no source occurrences.");
  const cited = new Set(
    occurrences.flatMap((o) =>
      o.publisherAttribution && o.publisherAttribution !== o.url
        ? [normalizeCoverageUrl(o.publisherAttribution)]
        : [],
    ),
  );
  return [...occurrences].sort(
    (a, b) =>
      Number(cited.has(normalizeCoverageUrl(b.url))) -
        Number(cited.has(normalizeCoverageUrl(a.url))) ||
      (a.domainRank ?? Infinity) - (b.domainRank ?? Infinity) ||
      (a.publishedAt ?? "9999").localeCompare(b.publishedAt ?? "9999") ||
      a.url.localeCompare(b.url),
  )[0]!;
}
export async function mergeCurrentNews(
  current: ReleaseArticle[],
  occurrence: NewsOccurrence,
  options: {
    now: Date;
    namespace: string;
    mint: () => string;
    read: (url: string) => Promise<NewsOccurrence | null>;
    known?: readonly NewsOccurrence[];
    sameSource?: (a: NewsOccurrence, b: NewsOccurrence) => boolean;
    summarize?: (body: string) => Promise<string>;
  },
) {
  const unchanged = {
    articles: current,
    article: undefined,
    ambiguous: [] as string[],
    needsCorrection: [] as string[],
  };
  let result = mergeNewsOccurrence(
    current,
    occurrence,
    options.namespace,
    options.mint,
    options.sameSource,
  );
  if (!result.article) return result;
  const related = (options.known ?? []).filter(
    (other) =>
      other.url !== occurrence.url &&
      matchingArticles(other, [result.article!], options.sameSource).length,
  );
  const cited = occurrence.publisherAttribution;
  if (
    cited &&
    normalizeCoverageUrl(cited) !== normalizeCoverageUrl(occurrence.url)
  ) {
    const original =
      Object.values(result.article.occurrences).find(
        (o) => normalizeCoverageUrl(o.url) === normalizeCoverageUrl(cited),
      ) ??
      related.find(
        (o) => normalizeCoverageUrl(o.url) === normalizeCoverageUrl(cited),
      ) ??
      (await options.read(cited));
    if (!original || !eligibleNewsDate(original.publishedAt, options.now))
      return unchanged;
    if (
      !matchingArticles(original, [result.article], options.sameSource).length
    )
      return unchanged;
    if (!related.some((o) => o.url === original.url)) related.push(original);
  }
  for (const other of related) {
    const merged = mergeNewsOccurrence(
      result.articles,
      other,
      options.namespace,
      options.mint,
      options.sameSource,
    );
    if (merged.ambiguous.length)
      return { ...unchanged, ambiguous: merged.ambiguous };
    if (merged.article) result = merged;
  }
  if (
    !eligibleNewsDate(occurrence.publishedAt, options.now) ||
    !eligibleNewsDate(
      result.article!.occurrences[result.article!.preferredUrl]!.publishedAt,
      options.now,
    )
  )
    return unchanged;
  const preferred = result.article!.occurrences[result.article!.preferredUrl]!;
  if (!preferred.summary && preferred.body && options.summarize) {
    const summarized = {
      ...preferred,
      summary: await options.summarize(preferred.body),
    };
    result = mergeNewsOccurrence(
      result.articles,
      summarized,
      options.namespace,
      options.mint,
      options.sameSource,
    );
  }
  return result;
}
export function matchingArticles(
  occurrence: NewsOccurrence,
  articles: readonly ReleaseArticle[],
  sameSource?: (a: NewsOccurrence, b: NewsOccurrence) => boolean,
): ReleaseArticle[] {
  const hashes = new Set(occurrence.paragraphs?.map((p) => p.hash));
  return articles.filter((article) =>
    Object.values(article.occurrences).some((other) => {
      if (
        sameSource?.(other, occurrence) ||
        normalizeCoverageUrl(other.url) === normalizeCoverageUrl(occurrence.url)
      )
        return true;
      const others = new Set(other.paragraphs?.map((p) => p.hash));
      const size = Math.min(hashes.size, others.size);
      return (
        size > 0 &&
        [...others].filter((hash) => hashes.has(hash)).length / size >= 0.3
      );
    }),
  );
}
export function selectSupportedOccurrence(
  relationship: ReleaseRelationship,
  occurrences: Record<string, NewsOccurrence>,
): NewsOccurrence | undefined {
  const supported = Object.values(occurrences).filter((o) =>
    o.support === undefined
      ? o.url === relationship.occurrenceUrl
      : o.support.some(
          (s) => s.assignmentId === relationship.agencyPersonnelId,
        ),
  );
  return supported.length ? selectPreferredOccurrence(supported) : undefined;
}
export function mergeNewsOccurrence(
  current: readonly ReleaseArticle[],
  occurrence: NewsOccurrence,
  namespace: string,
  mint: () => string,
  sameSource?: (a: NewsOccurrence, b: NewsOccurrence) => boolean,
): {
  articles: ReleaseArticle[];
  article?: ReleaseArticle;
  ambiguous: string[];
  needsCorrection: string[];
} {
  const matches = matchingArticles(occurrence, current, sameSource);
  if (matches.length > 1)
    return {
      articles: [...current],
      ambiguous: matches.map((a) =>
        JSON.stringify([a.namespace, a.sourceId, a.canonicalId]),
      ),
      needsCorrection: [],
    };
  if (!matches.length && !occurrence.support?.length)
    return { articles: [...current], ambiguous: [], needsCorrection: [] };
  const old = matches[0];
  const occurrences = { ...old?.occurrences, [occurrence.url]: occurrence };
  const preferred = selectPreferredOccurrence(Object.values(occurrences));
  const relationships = (old?.relationships ?? []).map((r) => ({ ...r }));
  const needsCorrection: string[] = [];
  for (const rel of relationships) {
    if (rel.occurrenceUrl === null) continue;
    const supported = selectSupportedOccurrence(rel, occurrences);
    if (!supported) {
      rel.needsCorrection = true;
      needsCorrection.push(rel.agencyPersonnelId);
      continue;
    }
    delete rel.needsCorrection;
    rel.occurrenceUrl = supported.url;
  }
  for (const support of occurrence.support ?? []) {
    if (
      !relationships.some((r) => r.agencyPersonnelId === support.assignmentId)
    )
      relationships.push({
        namespace,
        sourceId: mint(),
        agencyPersonnelId: support.assignmentId,
        occurrenceUrl: occurrence.url,
        confidence: "documented",
        notes: null,
      });
  }
  const article = {
    ...(old ?? { namespace, sourceId: occurrence.sourceId ?? mint() }),
    preferredUrl: preferred.url,
    normalizedUrl: normalizeCoverageUrl(preferred.url),
    occurrences,
    relationships,
  };
  return {
    articles: old
      ? current.map((a) => (a === old ? article : a))
      : [...current, article],
    article,
    ambiguous: [],
    needsCorrection,
  };
}
