import { describe, expect, it } from "vitest";
import {
  collectTraffic,
  homepageRanking,
  searchFirst,
} from "../../../sources/google.news/discovery.js";
describe("daily news", () => {
  it("reads every row before prioritizing eligible profiles", async () => {
    const responses = [
      [
        {
          keys: ["same", "https://example.org/personnel/a/"],
          impressions: 1,
          clicks: 28,
        },
        {
          keys: ["generic", "https://example.org/tx/"],
          impressions: 999,
          clicks: 200,
        },
      ],
      [
        {
          keys: ["variant", "https://example.org/personnel/a/"],
          impressions: 100,
          clicks: 22,
        },
      ],
      [],
    ];
    const offsets: number[] = [];
    const pairs = await collectTraffic(
      async (offset) => {
        offsets.push(offset);
        return responses.shift()!;
      },
      new Set(["/personnel/a/"]),
      "https://example.org",
    );
    expect(offsets).toEqual([0, 2, 3]);
    expect(pairs.map((p) => p.term)).toEqual(["variant", "same"]);
    const m = pairs.map((p) => ({ ...p, articleKey: "old" }));
    m.push({ ...m[0], articleKey: "new" });
    expect(
      homepageRanking(pairs, m, new Map([["/personnel/a/", "new"]])),
    ).toEqual([{ articleKey: "new", clicks: 50, position: 1 }]);
  });
  it("assigns all matched pair clicks to the newest qualifying story supported on the profile", () => {
    const pairs = [
      { path: "/a/", term: "one", clicks: 28, impressions: 60 },
      { path: "/a/", term: "two", clicks: 22, impressions: 55 },
    ];
    expect(
      homepageRanking(
        pairs,
        pairs.map((pair) => ({ ...pair, articleKey: "expired" })),
        new Map([["/a/", "recent"]]),
      ),
    ).toEqual([{ articleKey: "recent", clicks: 50, position: 1 }]);
  });
  it("stops at a qualifying cached URL", async () => {
    const inspect = async (url: string) => ({
      cached: url === "cached",
      match: url === "cached" ? "saved" : undefined,
    });
    const result = await searchFirst(["one", "cached", "three"], inspect);
    expect(result).toEqual({ checked: 1, match: "saved" });
  });
});

it("combines profiles that select one story and stops at 25 distinct stories", () => {
  const pairs = Array.from({ length: 28 }, (_, i) => ({
    term: "query",
    path: "/personnel/" + i + "/",
    clicks: i + 1,
    impressions: 100,
  }));
  const stories = new Map(
    pairs.map((p, i) => [p.path, String(Math.max(1, i))]),
  );
  const matches = pairs.map((p) => ({
    ...p,
    articleKey: stories.get(p.path)!,
  }));
  const placements = homepageRanking(pairs, matches, stories);
  expect(placements).toHaveLength(25);
  expect(placements[0]).toEqual({ articleKey: "27", clicks: 28, position: 1 });
  expect(homepageRanking(pairs.slice(0, 2), matches, stories)).toEqual([
    { articleKey: "1", clicks: 3, position: 1 },
  ]);
});
it("ends the search after ten new URLs", async () => {
  const checked: string[] = [];
  const result = await searchFirst(
    Array.from({ length: 11 }, (_, i) => String(i)),
    async (url) => {
      checked.push(url);
      return { cached: false };
    },
  );
  expect(checked).toHaveLength(10);
  expect(result).toEqual({ checked: 10, match: undefined });
});
