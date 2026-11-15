import { describe, expect, it } from "vitest";
import {
  processNewsOccurrence,
  matchingArticles,
  mergeNewsOccurrence,
  eligibleNewsDate,
  selectPreferredOccurrence,
} from "../../../sources/lib/news.js";

const agency = "Example Police Department";
const assignments = [
  { id: "assignment-a", agencyName: agency, personnelName: "Alex Example" },
  { id: "assignment-b", agencyName: agency, personnelName: "Sam Example" },
];
const now = new Date("2026-11-15T02:00:00Z");
const example = async (
  url: string,
  person: number,
  common: number,
  date: string,
  original?: string,
) => {
  const selected = assignments[person]!;
  const lines = [
    agency,
    selected.personnelName,
    ...Array.from({ length: 8 }, (_, i) =>
      i < common ? "Same paragraph " + i : url + " " + i,
    ),
  ];
  return processNewsOccurrence({
    url,
    html: `<meta property="og:title" content="Source headline"><meta property="article:published_time" content="${date}"><meta property="article:modified_time" content="2026-11-14">${original ? '<link rel="canonical" href="' + original + '">' : ""}<article>${lines.map((line) => "<p>" + line + "</p>").join("")}</article>`,
    assignments,
    infer: async (body, candidates) => {
      expect(candidates).toEqual([selected]);
      expect(body).toContain(agency);
      return {
        summary: "Site summary",
        support: [{ assignmentId: selected.id, paragraphIndexes: [0, 1] }],
      };
    },
  });
};
describe("release news evidence", () => {
  it("uses seven Chicago dates and the original publication date including cached copies", async () => {
    const old = await example(
      "https://original.example/item",
      0,
      2,
      "2026-11-07",
    );
    const copy = await example(
      "https://copy.example/item",
      1,
      2,
      "2026-11-14",
      old.url,
    );
    expect(selectPreferredOccurrence([copy, old]).url).toBe(old.url);
    expect(eligibleNewsDate(old.publishedAt, now)).toBe(false);
    expect(eligibleNewsDate(null, now)).toBe(false);
    expect(eligibleNewsDate("2026-11-08", now)).toBe(true);
  });
  it("groups occurrences at three shared paragraphs out of ten and preserves supported copies", async () => {
    let next = 0;
    const mint = () => "record-" + ++next;
    const original = await example(
      "https://original.example/item",
      0,
      2,
      "2026-11-08",
    );
    const separate = await example(
      "https://separate.example/item",
      1,
      1,
      "2026-11-09",
    );
    const copy = await example(
      "https://copy.example/item",
      1,
      2,
      "2026-11-10",
      original.url,
    );
    const first = mergeNewsOccurrence(
      [],
      original,
      "com/serpapi/landing-page-search",
      mint,
    );
    expect(matchingArticles(separate, first.articles)).toHaveLength(0);
    const merged = mergeNewsOccurrence(
      first.articles,
      copy,
      "com/serpapi/landing-page-search",
      mint,
    );
    expect(merged.articles).toHaveLength(1);
    expect(merged.article!.relationships.map((r) => r.occurrenceUrl)).toEqual([
      original.url,
      copy.url,
    ]);
    expect(merged.article!.sourceId).toBe(first.article!.sourceId);
    const ambiguous = mergeNewsOccurrence(
      [
        ...first.articles,
        ...mergeNewsOccurrence(
          [],
          separate,
          "com/serpapi/landing-page-search",
          mint,
        ).articles,
      ],
      copy,
      "com/serpapi/landing-page-search",
      mint,
    );
    expect(ambiguous.ambiguous).toHaveLength(2);
    expect(ambiguous.articles).toHaveLength(2);
    const corrected = mergeNewsOccurrence(
      merged.articles,
      { ...copy, support: [] },
      "com/serpapi/landing-page-search",
      mint,
    );
    expect(corrected.needsCorrection).toHaveLength(1);
  });
});

it("reads the post's own publication date from JSON-LD, ignoring comment dates", async () => {
  const json = JSON.stringify({
    "@type": "SocialMediaPosting",
    comment: [{ "@type": "Comment", datePublished: "2026-11-14" }],
    datePublished: "2026-11-10T17:26:55.255Z",
  });
  const article = await processNewsOccurrence({
    html:
      '<body><h1>Agency announcement</h1><script type="application/ld+json">' +
      json +
      "</script><p>Agency statement.</p></body>",
    url: "https://publisher.example/post",
    assignments: [],
    infer: async () => {
      throw Error("unexpected");
    },
  });
  expect(article.publishedAt).toBe("2026-11-10");
});

it("keeps inference citations aligned when a publisher paragraph contains blank lines", async () => {
  const occurrence = await processNewsOccurrence({
    html: "<article><h1>Published report</h1><p>First line\n\nsecond line.</p><p>Alex Example of Example Police Department spoke.</p></article>",
    url: "https://publisher.example/story",
    assignments,
    infer: async (_body, candidates, paragraphs) => {
      expect(paragraphs).toHaveLength(2);
      expect(paragraphs?.[1]).toContain("Alex Example");
      return {
        summary: "Statement",
        support: [{ assignmentId: candidates[0]!.id, paragraphIndexes: [1] }],
      };
    },
  });
  expect(occurrence.support?.[0]?.paragraphHashes).toEqual([
    occurrence.paragraphs![1]!.hash,
  ]);
});
