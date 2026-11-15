import { expect, it } from "vitest";
import {
  mergeCurrentNews,
  type NewsOccurrence,
} from "../../../sources/lib/news.js";
const now = new Date("2026-11-14T17:00:00Z");
const copy: NewsOccurrence = {
  url: "https://copy.example/a",
  publisherAttribution: "https://original.example/a",
  sourceName: null,
  title: "copy",
  summary: "summary",
  publishedAt: "2026-11-14",
  paragraphs: [{ text: "same body", hash: "s" }],
  support: [{ assignmentId: "a", paragraphHashes: ["s"] }],
};
it("loads the explicitly cited original before accepting a recent copy", async () => {
  const read = async () => ({
    ...copy,
    url: copy.publisherAttribution!,
    publisherAttribution: null,
    publishedAt: "2026-11-07",
  });
  const result = await mergeCurrentNews([], copy, {
    now,
    namespace: "n",
    mint: () => "id",
    read,
  });
  expect(result.article).toBeUndefined();
});
it("keeps an undated source as evidence when no qualifying article can be established", async () => {
  const result = await mergeCurrentNews(
    [],
    { ...copy, publishedAt: null },
    { now, namespace: "n", mint: () => "id", read: async () => null },
  );
  expect(result.article).toBeUndefined();
});
