import { it, expect, vi } from "vitest";
import { runDaily } from "../../../sources/google.news/daily.js";
import type { NewsStorage } from "../../../sources/google.news/storage.js";
import type { PublicationBatch } from "../../../sources/google.news/publication.js";
const origin = "https://site.example",
  path = "/personnel/test/",
  agency = "/area/test/",
  release = "prod-test";
it("saves one continuing article and combines query clicks across repeated daily runs", async () => {
  let serial = 0;
  const objects = new Map<string, { value: unknown; etag: string }>();
  const put = (k: string, v: unknown) =>
    objects.set(k, {
      value: JSON.parse(JSON.stringify(v)),
      etag: String(++serial),
    });
  put("snapshot", {
    agencies: [{ id: "a", name: "Test Agency", path: agency }],
    personnel: [{ id: "p", name: "Officer Example", path }],
    assignments: [{ id: "ap", agencyId: "a", personnelId: "p" }],
    coveragePaths: [],
  });
  put("builds/prod-test/data/alias.json", { CoverageLink: {} });
  put("builds/prod-test/data/index.json", { news: { data: { articles: [] } } });
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
    async readOriginal() {
      throw Error("unexpected");
    },
    async readOverrideEtag() {
      throw Error("unexpected");
    },
    async writeOverride() {
      throw Error("unexpected");
    },
    async makeVisible() {
      throw Error("unexpected");
    },
  };
  const queued: PublicationBatch[] = [];
  const current = new Date("2026-11-14T14:00:00Z");
  const readArticle = vi.fn(async (url: string) => ({
    url,
    html: '<article><h1>Story</h1><p>Officer Example with Test Agency reported the event.</p></article><meta property="article:published_time" content="2026-11-10">',
  }));
  const src = "https://source.example/news";
  const newsResults = vi.fn(async () => ({ urls: [src], nextStart: null }));
  const position = vi.fn(async (_term: string, _page: string, start: string) =>
    start === "2026-11-07" ? 5 : null,
  );
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
      rows: async (_w, offset) =>
        offset
          ? []
          : [
              {
                keys: ["officer", origin + path],
                clicks: 28,
                impressions: 100,
              },
              {
                keys: ["agency officer", origin + path],
                clicks: 22,
                impressions: 70,
              },
            ],
      position,
    },
    infer: async () => ({
      summary: "Site summary",
      support: [{ assignmentId: "ap", paragraphIndexes: [0] }],
    }),
    newsResults,
    readArticle,
    publish: async (_s, _k, batch) => {
      queued.push(structuredClone(batch));
      return Object.fromEntries(
        batch.destinations.map((d) => [d.path, current.toISOString()]),
      );
    },
    origin,
    bucket: "private",
    apiKey: "test",
  };
  await runDaily(current, deps);
  const ranking = () =>
    queued.at(-1)!.destinations.find((d) => d.path === "/")!.update.ranking!;
  expect(ranking().placements).toHaveLength(1);
  const [first] = ranking().placements;
  expect(first).toMatchObject({
    namespace: "google.news",
    sourceId: src,
    clicks: 50,
    position: 1,
  });
  expect(queued[0]!.destinations.map((d) => d.path)).toEqual([
    path,
    agency,
    "/",
  ]);
  await runDaily(current, deps);
  expect(ranking().placements).toEqual([first]);
  expect(readArticle).toHaveBeenCalledTimes(1);
  const outcomes = [...objects]
    .filter(([k]) => k.startsWith("news-discovery/outcomes/"))
    .map(([, v]) => v.value);
  expect(outcomes).toHaveLength(4);
  expect(outcomes).toMatchObject([
    { outcome: "matched", providerRequests: 1, newUrls: 1 },
    { outcome: "matched", providerRequests: 1, newUrls: 0 },
    { outcome: "matched", providerRequests: 0, newUrls: 0 },
    { outcome: "matched", providerRequests: 0, newUrls: 0 },
  ]);
  await runDaily(new Date("2026-11-15T14:00:00Z"), deps);
  expect(newsResults).toHaveBeenCalledTimes(4);
  expect(position).not.toHaveBeenCalled();
  deps.consoleApi.latestWindow = async () => ({
    startDate: "2026-11-15",
    endDate: "2026-11-21",
  });
  await runDaily(new Date("2026-11-23T14:00:00Z"), deps);
  for (const term of ["officer", "agency officer"]) {
    expect(position).toHaveBeenCalledWith(
      term,
      origin + path,
      "2026-11-07",
      "2026-11-13",
    );
    expect(position).toHaveBeenCalledWith(
      term,
      origin + path,
      "2026-11-15",
      "2026-11-21",
    );
  }
  const measurements = (
    objects.get("news-discovery/state.json")!.value as {
      comparisons: Record<string, unknown>;
    }
  ).comparisons;
  expect(Object.values(measurements)).toHaveLength(2);
  expect(Object.values(measurements)[0]).toMatchObject({
    before: { position: 5 },
    after: { position: null },
  });
  const baseline = queued[0]!.destinations[0]!.update.articles![0]!;
  const newerUrl = "https://source.example/previously-imported";
  const newer = {
    ...baseline,
    sourceId: newerUrl,
    preferredUrl: newerUrl,
    normalizedUrl: newerUrl,
    occurrences: {
      [newerUrl]: {
        ...baseline.occurrences[baseline.preferredUrl]!,
        url: newerUrl,
        sourceId: newerUrl,
        publishedAt: "2026-11-12",
        title: "Another story",
        paragraphs: [{ hash: "different", text: "A different report." }],
        publisherAttribution: null,
      },
    },
    relationships: baseline.relationships.map((r) => ({
      ...r,
      sourceId: "another",
      occurrenceUrl: newerUrl,
    })),
  };
  objects.clear();
  queued.length = 0;
  put("snapshot", {
    agencies: [{ id: "a", name: "Test Agency", path: agency }],
    personnel: [{ id: "p", name: "Officer Example", path }],
    assignments: [{ id: "ap", agencyId: "a", personnelId: "p" }],
    coveragePaths: [path],
  });
  put("builds/prod-test/data/alias.json", { CoverageLink: {} });
  put("builds/prod-test/data/index.json", { news: { data: { articles: [] } } });
  put("builds/prod-test/data" + path + "index.json", {
    news: { data: { articles: [baseline, newer] } },
  });
  await runDaily(current, deps);
  expect(ranking().placements).toMatchObject([
    { sourceId: newerUrl, clicks: 50 },
  ]);
  expect(
    (
      objects.get("news-discovery/state.json")!.value as {
        visible: Record<string, string | null>;
      }
    ).visible[
      JSON.stringify([
        path,
        JSON.stringify([baseline.namespace, baseline.sourceId]),
      ])
    ],
  ).toBeNull();
  await runDaily(new Date("2026-12-01T14:00:00Z"), deps);
  expect(ranking().placements).toEqual([]);
});

it.each([undefined, "previous-article-id"])(
  "replays a pending release and reconciles baseline source ID %s with a partial copy",
  async (previousSourceId) => {
    const active = "production-b",
      previous = "production-a";
    const a = "https://wire.example/story",
      b = "https://publisher.example/story";
    const snapshot = {
      personnel: [{ id: "p", name: "Officer Example", path }],
      agencies: [{ id: "a", name: "Test Agency", path: agency }],
      assignments: [{ id: "ap", personnelId: "p", agencyId: "a" }],
      coveragePaths: [path],
    };
    const occurrence = {
      url: a,
      namespace: "google.news",
      sourceId: a,
      title: "Wire story",
      sourceName: "Wire",
      summary: "Wire report",
      publishedAt: "2026-11-10",
      paragraphs: [{ hash: "first", text: "Earlier paragraph." }],
    };
    const article = {
      namespace: "google.news",
      sourceId: a,
      preferredUrl: a,
      normalizedUrl: a,
      occurrences: { [a]: occurrence },
      relationships: [
        {
          namespace: "google.news",
          sourceId: "existing-link",
          agencyPersonnelId: "ap",
          occurrenceUrl: a,
          confidence: "documented",
          notes: null,
        },
      ],
    };
    const key = JSON.stringify(["google.news", a]);
    const pair = { path, term: "officer", clicks: 22, impressions: 30 },
      window = { startDate: "2026-11-06", endDate: "2026-11-12" };
    const batch = {
      releaseId: previous,
      destinations: [{ path, update: { articles: [article] } }],
    };
    const state = {
      releaseId: previous,
      articles: [article],
      matches: [{ ...pair, articleKey: key }],
      visible: {},
      comparisons: {},
      pending: { key: "unfinished", batch, articleKey: key, advance: true },
      queue: {
        runId: "previous",
        pairs: [pair],
        window,
        index: 0,
        searchStart: 0,
        checked: 1,
        requestedPages: [],
        seen: [],
      },
    };
    const baseline = {
      canonicalId: "canonical",
      ...(previousSourceId && {
        namespace: "google.news",
        sourceId: previousSourceId,
      }),
      preferredUrl: a,
      normalizedUrl: a,
      occurrences: {
        [a]: { ...occurrence, sourceId: undefined, namespace: undefined },
      },
      relationships: [
        {
          ...article.relationships[0],
          canonicalId: "canonical-link",
          namespace: undefined,
          sourceId: undefined,
        },
      ],
    };
    const records = new Map<string, unknown>([
      ["current-roster", snapshot],
      [
        `builds/${previous}/data/dynamic.json`,
        {
          ...snapshot,
          agencies: [{ ...snapshot.agencies[0], name: "Previous Agency" }],
        },
      ],
      [`builds/${active}/data/alias.json`, { CoverageLink: { [b]: a } }],
      [
        `builds/${active}/data/index.json`,
        { news: { data: { articles: [] } } },
      ],
      [
        `builds/${active}/data${path}index.json`,
        { news: { data: { articles: [baseline] } } },
      ],
      ["news-discovery/state.json", state],
    ]);
    const unexpected = async () => {
      throw Error("Unexpected page operation");
    };
    const store: NewsStorage = {
      readOriginal: unexpected,
      readOverrideEtag: unexpected,
      writeOverride: unexpected,
      makeVisible: unexpected,
      readJson: async (k: string) =>
        records.has(k)
          ? { etag: k, value: JSON.parse(JSON.stringify(records.get(k))) }
          : null,
      writeJson: async (k: string, v: unknown) => {
        records.set(k, structuredClone(v));
        return true;
      },
    };
    const batches: PublicationBatch[] = [];
    const now = new Date("2026-11-14T14:00:00Z");
    await runDaily(now, {
      store,
      origin,
      bucket: "private",
      apiKey: "test",
      snapshot: async () => ({
        releaseId: active,
        roster: { bucket: "private", key: "current-roster" },
      }),
      consoleApi: {
        latestWindow: async () => window,
        rows: async (_w, offset) =>
          offset
            ? []
            : [
                {
                  keys: ["officer", origin + path],
                  clicks: 22,
                  impressions: 30,
                },
              ],
        position: async () => null,
      },
      readArticle: async () => ({
        url: b + "?utm_source=test",
        html: '<meta property="article:published_time" content="2026-11-10"><h1>Original</h1><article><p>Officer Example with Test Agency.</p></article>',
      }),
      newsResults: async () => ({ urls: [b], nextStart: null }),
      infer: async () => ({
        summary: "Summary",
        support: [{ assignmentId: "ap", paragraphIndexes: [0] }],
      }),
      publish: async (_s, _k, batch, roster) => {
        batches.push(batch);
        if (batch.releaseId === previous)
          expect(roster.agencies[0].name).toBe("Previous Agency");
        return { [path]: now.toISOString() };
      },
    });
    expect(batches.map((b) => b.releaseId)).toEqual([previous, active, active]);
    const after = records.get("news-discovery/state.json") as typeof state;
    expect(after.articles).toHaveLength(1);
    expect(after.matches).toHaveLength(1);
    if (previousSourceId)
      expect(after.articles[0].sourceId).toBe(previousSourceId);
    expect(after.articles[0]).toMatchObject({
      canonicalId: "canonical",
      relationships: [
        { sourceId: "existing-link", canonicalId: "canonical-link" },
      ],
      occurrences: {
        [b + "?utm_source=test"]: { namespace: "google.news", sourceId: b },
      },
    });
    expect(
      batches.at(-1)!.destinations[0].update.ranking!.placements,
    ).toMatchObject([{ clicks: 22, position: 1, canonicalId: "canonical" }]);
  },
);
