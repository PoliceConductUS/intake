import { readFile } from "node:fs/promises";
import type {
  SourceManifest,
  SourceTransform,
  EmittedRecords,
} from "../../src/cli/transform/source-transform.js";
import {
  selectPreferredOccurrence,
  selectSupportedOccurrence,
  type ReleaseIdentity,
  type ReleaseArticle,
  type ReleaseRelationship,
} from "./news.js";
import { normalizeCoverageUrl } from "../../src/cli/import/artifacts/facades/coverage-resolvers.js";
export type NewsRanking = {
  windowEnd: string;
  placements: Array<ReleaseIdentity & { position: number; clicks: number }>;
};
export type NewsData = { articles: ReleaseArticle[]; ranking?: NewsRanking };
import type { NewsImportContext } from "../../src/shared/release-news.js";
export type { NewsImportContext } from "../../src/shared/release-news.js";
export const produces = [
  "CoverageLinks",
  "CoverageLinkAgencyPersonnel",
  "CoverageHomepageWindows",
  "CoverageHomepagePlacements",
] as const;
function recordKey(record: ReleaseIdentity) {
  if (record.namespace && record.sourceId)
    return JSON.stringify([record.namespace, record.sourceId]);
  if (record.canonicalId) return JSON.stringify([record.canonicalId]);
  throw new Error(
    "News record requires a complete originating identity or an existing canonical ID.",
  );
}
function origin(record: ReleaseIdentity) {
  return record.namespace && record.sourceId
    ? { source_namespace: record.namespace, source_id: record.sourceId }
    : {};
}
function metadata(record: ReleaseIdentity): {
  metadata?: { action: "PATCH"; selector: { id: string } };
} {
  return record.canonicalId
    ? { metadata: { action: "PATCH", selector: { id: record.canonicalId } } }
    : {};
}
export function mergeImportedArticle(
  existing: ReleaseArticle | undefined,
  incoming: ReleaseArticle,
): ReleaseArticle {
  if (!existing) return incoming;
  const occurrences = { ...incoming.occurrences, ...existing.occurrences };
  for (const [url, o] of Object.entries(incoming.occurrences)) {
    const prior = existing.occurrences[url];
    if (
      !prior ||
      (!prior.body && o.body) ||
      (o.observedAt && o.observedAt > (prior.observedAt ?? ""))
    )
      occurrences[url] = o;
  }
  const relationships = new Map<string, ReleaseRelationship>(
    existing.relationships.map((r) => [r.agencyPersonnelId, r]),
  );
  for (const r of incoming.relationships) {
    const saved = relationships.get(r.agencyPersonnelId);
    relationships.set(r.agencyPersonnelId, {
      ...r,
      ...saved,
      occurrenceUrl: saved?.occurrenceUrl ?? r.occurrenceUrl,
    });
  }
  for (const [assignmentId, relationship] of relationships) {
    if (relationship.occurrenceUrl === null) continue;
    const selected = selectSupportedOccurrence(relationship, occurrences);
    const updated = { ...relationship };
    if (selected) {
      updated.occurrenceUrl = selected.url;
      delete updated.needsCorrection;
    } else {
      updated.needsCorrection = true;
    }
    relationships.set(assignmentId, updated);
  }
  const preferred = selectPreferredOccurrence(Object.values(occurrences));
  return {
    ...incoming,
    ...existing,
    preferredUrl: preferred.url,
    normalizedUrl: normalizeCoverageUrl(preferred.url),
    occurrences,
    relationships: [...relationships.values()],
  };
}
export async function newsManifest(
  articles: readonly ReleaseArticle[],
  ranking: NewsRanking | undefined,
  data: NewsImportContext,
): Promise<SourceManifest> {
  const links: EmittedRecords = {},
    relationships: EmittedRecords = {},
    windows: EmittedRecords = {},
    placements: EmittedRecords = {};
  const unique = new Map<string, ReleaseArticle>();
  for (const article of articles)
    unique.set(
      recordKey(article),
      mergeImportedArticle(unique.get(recordKey(article)), article),
    );
  for (const [key, incoming] of unique) {
    const article = mergeImportedArticle(
      await data.existingArticle(incoming),
      incoming,
    );
    const preferred = article.occurrences[article.preferredUrl];
    if (!preferred) throw Error("Missing preferred occurrence for " + key);
    const hasEvidence = Object.values(article.occurrences).some(
      (o) => o.body !== undefined,
    );
    links[key] = {
      ...metadata(article),
      spec: {
        ...origin(article),
        url: preferred.url,
        normalized_url: article.normalizedUrl,
        title: preferred.title,
        source_name: preferred.sourceName,
        published_at: preferred.publishedAt,
        summary: preferred.summary,
        ...(incoming.notes === undefined ? {} : { notes: incoming.notes }),
        ...(hasEvidence || !article.canonicalId
          ? { occurrences: article.occurrences }
          : {}),
      },
    };
    for (const r of article.relationships) {
      if (r.occurrenceUrl !== null && !article.occurrences[r.occurrenceUrl])
        throw Error("Missing assignment occurrence for " + recordKey(r));
      relationships[recordKey(r)] = {
        ...metadata(r),
        spec: {
          ...origin(r),
          coverage_link_id: key,
          agency_personnel_id: await data.assignmentRef(r.agencyPersonnelId),
          occurrence_url: r.occurrenceUrl,
          ...(r.occurrenceUrl === null
            ? {}
            : {
                correction_reason: r.needsCorrection
                  ? "Last supporting passage was removed"
                  : null,
              }),
          confidence: r.confidence,
          notes: r.notes,
        },
      };
    }
  }
  if (ranking) {
    windows[ranking.windowEnd] = {
      spec: {
        window_end: ranking.windowEnd,
        placement_count: ranking.placements.length,
      },
    };
    for (const placement of ranking.placements) {
      const key = recordKey(placement);
      if (!links[key]) throw Error("Missing homepage article " + key);
      placements[JSON.stringify([ranking.windowEnd, placement.position])] = {
        spec: {
          window_id: ranking.windowEnd,
          coverage_link_id: key,
          position: placement.position,
          clicks: placement.clicks,
        },
      };
    }
  }
  return {
    artifacts: [
      { kind: "CoverageLinks", records: links },
      { kind: "CoverageLinkAgencyPersonnel", records: relationships },
      { kind: "CoverageHomepageWindows", records: windows },
      { kind: "CoverageHomepagePlacements", records: placements },
    ],
  };
}
export async function transformNews(
  paths: string[],
  data: NewsImportContext,
  canonicalAssignment?: (name: string) => Promise<string>,
): ReturnType<SourceTransform> {
  const pages = await Promise.all(
    paths
      .filter((p) => p.endsWith(".news.json"))
      .map(
        async (file) => JSON.parse(await readFile(file, "utf8")) as NewsData,
      ),
  );
  if (!pages.length) throw Error("No acquired news data.");
  if (canonicalAssignment)
    for (const page of pages)
      for (const article of page.articles) {
        for (const relationship of article.relationships)
          relationship.agencyPersonnelId = await canonicalAssignment(
            relationship.agencyPersonnelId,
          );
        for (const occurrence of Object.values(article.occurrences))
          for (const support of occurrence.support ?? [])
            support.assignmentId = await canonicalAssignment(
              support.assignmentId,
            );
      }
  const rankings = pages
    .flatMap((p) => (p.ranking ? [p.ranking] : []))
    .sort((a, b) => b.windowEnd.localeCompare(a.windowEnd));
  return newsManifest(
    pages.flatMap((p) => p.articles),
    rankings[0],
    data,
  );
}
