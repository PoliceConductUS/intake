import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { runDaily } from "../../../sources/com/serpapi/landing-page-search/daily.js";
import type { NewsStorage } from "../../../sources/com/serpapi/landing-page-search/storage.js";

const origin = "https://site.example",
  path = "/personnel/test/",
  release = "prod-test",
  prefix = "com/serpapi/landing-page-search/";

function fixture(
  rows: { keys: string[]; clicks: number; impressions: number }[],
) {
  let serial = 0;
  const objects = new Map<string, { value: unknown; etag: string }>();
  const put = (k: string, v: unknown) =>
    objects.set(k, { value: structuredClone(v), etag: String(++serial) });
  put("snapshot", {
    agencies: [
      { id: "a", name: "Test Agency", state: "TX", path: "/area/test/" },
    ],
    personnel: [{ id: "p", name: "Officer Example", path }],
    assignments: [{ id: "ap", agencyId: "a", personnelId: "p" }],
    coveragePaths: [],
  });
  put("builds/prod-test/data/alias.json", { CoverageLink: {} });
  put("builds/prod-test/data/index.json", { news: { data: { articles: [] } } });
  const unexpected = async () => {
    throw Error("unexpected");
  };
  const store: NewsStorage = {
    async readJson<T>(k: string) {
      const ref = objects.get(k);
      return ref
        ? { value: structuredClone(ref.value) as T, etag: ref.etag }
        : null;
    },
    async writeJson(k, v, tag) {
      if ((objects.get(k)?.etag ?? null) !== tag) return false;
      put(k, v);
      return true;
    },
    readOriginal: unexpected,
    readOverrideEtag: unexpected,
    writeOverride: unexpected,
    makeVisible: unexpected,
  };
  const now = new Date("2026-11-14T14:00:00Z");
  const deps: NonNullable<Parameters<typeof runDaily>[1]> = {
    store,
    snapshot: async () => ({
      releaseId: release,
      roster: { bucket: "private", key: "snapshot" },
    }),
    consoleApi: {
      latestWindow: async () => ({
        startDate: "2026-11-06",
        endDate: "2026-11-12",
      }),
      rows: async (_w, offset) => (offset ? [] : rows),
      position: async () => null,
    },
    infer: async () => ({
      summary: "Site summary",
      support: [{ assignmentId: "ap", paragraphIndexes: [0] }],
    }),
    newsResults: unexpected,
    readArticle: async (url) => ({
      url,
      html: '<article><h1>Story</h1><p>Officer Example with Test Agency reported the event.</p></article><meta property="article:published_time" content="2026-11-10">',
    }),
    publish: async (_s, _k, batch) =>
      Object.fromEntries(
        batch.destinations.map((d) => [d.path, now.toISOString()]),
      ),
    origin,
    bucket: "private",
    apiKey: "test",
  };
  return { objects, put, deps, now };
}

it("fails when a saved match names an article that is not saved", async () => {
  const { put, deps, now } = fixture([]);
  const articleKey = JSON.stringify([
    "com/serpapi/landing-page-search",
    "https://source.example/gone",
  ]);
  put(prefix + "state.json", {
    releaseId: release,
    articles: [],
    matches: [{ term: "officer", path, articleKey }],
    visible: {},
    comparisons: {},
  });

  await expect(runDaily(now, deps)).rejects.toThrow(
    `Missing article ${articleKey} for the match of "officer" on ${path}`,
  );
});

it("fails when a paragraph names a URL whose saved evidence is missing", async () => {
  const first = "https://source.example/first",
    second = "https://other.example/second";
  const { objects, deps, now } = fixture([
    { keys: ["officer", origin + path], clicks: 28, impressions: 100 },
    { keys: ["agency officer", origin + path], clicks: 22, impressions: 70 },
  ]);
  const evidenceKey =
    prefix +
    "urls/" +
    createHash("sha256").update(first).digest("hex") +
    ".json";
  let searches = 0;
  deps.newsResults = async () => {
    const url = searches++ === 0 ? first : second;
    if (url === second) expect(objects.delete(evidenceKey)).toBe(true);
    return {
      response: { organic_results: [{ link: url }] },
      urls: [url],
      nextStart: null,
    };
  };

  await expect(runDaily(now, deps)).rejects.toThrow(
    `Missing saved evidence for ${first}, named by a paragraph of ${second}`,
  );
});
