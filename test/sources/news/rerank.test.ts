import { it, expect } from "vitest";
import {
  newsManifest,
  mergeImportedArticle,
} from "../../../sources/lib/news-import.js";
import type { ReleaseArticle } from "../../../sources/lib/news.js";
it("selects the newly preferred evidence-bearing source and flags lost last support", () => {
  const old = article("https://copy.example/news"),
    updated = structuredClone(old);
  const relationship = {
    namespace: "n",
    sourceId: "r",
    agencyPersonnelId: "p",
    confidence: "documented",
    notes: null,
    occurrenceUrl: old.preferredUrl,
  };
  old.relationships = [relationship];
  const preferred = "https://original.example/news";
  updated.preferredUrl = preferred;
  updated.occurrences[preferred] = {
    ...old.occurrences[old.preferredUrl]!,
    url: preferred,
    domainRank: 1,
    support: [{ assignmentId: "p", paragraphHashes: ["a"] }],
  };
  updated.relationships = [{ ...relationship, occurrenceUrl: preferred }];
  expect(
    mergeImportedArticle(old, updated).relationships[0]?.occurrenceUrl,
  ).toBe(preferred);
  const stripped = structuredClone(old);
  Object.assign(stripped.occurrences[old.preferredUrl]!, {
    observedAt: "2026-11-11T00:00:00Z",
    support: [],
  });
  expect(
    mergeImportedArticle(old, stripped).relationships[0]?.needsCorrection,
  ).toBe(true);
});
const article = (id: string): ReleaseArticle => ({
  namespace: "google.news",
  sourceId: id,
  preferredUrl: id,
  normalizedUrl: id,
  occurrences: {
    [id]: {
      url: id,
      title: id,
      sourceName: null,
      publishedAt: "2026-11-08",
      summary: "Source summary",
      body: "Original body",
      observedAt: "2026-11-10T00:00:00Z",
    },
  },
  relationships: [],
});
it("replaces positions when the same ranking window shrinks or empties", async () => {
  const data = {
    bindArticleSources: async () => [],
    assignmentRef: async (id: string) => id,
    existingArticle: async () => undefined,
  };
  const articles = [article("a"), article("b")];
  const window = async (ids: string[]) =>
    newsManifest(
      articles,
      {
        windowEnd: "2026-11-13",
        placements: ids.map((sourceId, i) => ({
          namespace: "google.news",
          sourceId,
          position: i + 1,
          clicks: 3 - i,
        })),
      },
      data,
    );
  const full = await window(["a", "b"]),
    short = await window(["b"]),
    empty = await window([]);
  const records = (m: typeof full, kind: string) =>
    m.artifacts.find((a) => a.kind === kind)!.records;
  expect(Object.keys(records(full, "CoverageHomepagePlacements"))[0]).toBe(
    Object.keys(records(short, "CoverageHomepagePlacements"))[0],
  );
  expect(
    Object.values(records(empty, "CoverageHomepageWindows"))[0]!.spec,
  ).toMatchObject({ placement_count: 0 });
});
it("imports a corrected body and preserves it across historical imports", () => {
  const old = article("https://example.org/story"),
    corrected = structuredClone(old);
  Object.assign(corrected.occurrences[old.preferredUrl]!, {
    body: "Corrected passage",
    observedAt: "2026-11-12T00:00:00Z",
  });
  for (const result of [
    mergeImportedArticle(old, corrected),
    mergeImportedArticle(corrected, old),
  ])
    expect(result.occurrences[old.preferredUrl]!.body).toBe(
      "Corrected passage",
    );
});
