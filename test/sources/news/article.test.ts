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
    const first = mergeNewsOccurrence([], original, "google.news", mint);
    expect(matchingArticles(separate, first.articles)).toHaveLength(0);
    const merged = mergeNewsOccurrence(
      first.articles,
      copy,
      "google.news",
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
        ...mergeNewsOccurrence([], separate, "google.news", mint).articles,
      ],
      copy,
      "google.news",
      mint,
    );
    expect(ambiguous.ambiguous).toHaveLength(2);
    expect(ambiguous.articles).toHaveLength(2);
    const corrected = mergeNewsOccurrence(
      merged.articles,
      { ...copy, support: [] },
      "google.news",
      mint,
    );
    expect(corrected.needsCorrection).toHaveLength(1);
  });
});
