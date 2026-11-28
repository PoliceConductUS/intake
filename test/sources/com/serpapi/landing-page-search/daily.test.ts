import { it, expect, vi } from "vitest";
import { newsResults as searchSerpApi } from "../../../../../sources/com/serpapi/landing-page-search/providers.js";
import { runDaily } from "../../../../../sources/com/serpapi/landing-page-search/daily.js";
import { personnelSearchNames } from "../../../../../sources/lib/personnel-names.js";
import type { NewsStorage } from "../../../../../sources/com/serpapi/landing-page-search/storage.js";
import type { PublicationBatch } from "../../../../../sources/com/serpapi/landing-page-search/publication.js";
const origin = "https://site.example",
  path = "/personnel/test/",
  agency = "/area/test/",
  release = "prod-test";
function dailyStorage() {
  let serial = 0;
  const objects = new Map<string, { value: unknown; etag: string }>();
  const put = (k: string, v: unknown) =>
    objects.set(k, {
      value: JSON.parse(JSON.stringify(v)),
      etag: String(++serial),
    });
  put("snapshot", {
    agencies: [{ id: "a", name: "Test Agency", state: "TX", path: agency }],
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
  return { store, put, objects };
}
it("saves one continuing article and combines query clicks across repeated daily runs", async () => {
  const { store, put, objects } = dailyStorage();
  const queued: PublicationBatch[] = [];
  const current = new Date("2026-11-14T14:00:00Z");
  const blocked = "https://source.example/blocked";
  const empty = "https://source.example/empty";
  const readArticle = vi.fn(async (url: string) =>
    url === blocked
      ? { url, html: "", reason: "Publisher URL or redirect unavailable" }
      : url === empty
        ? { url, html: "<h1>Title</h1><article></article>" }
        : {
            url,
            html: '<article><h1>Story</h1><p>Officer Example with Test Agency reported the event.</p></article><meta property="article:published_time" content="2026-11-10">',
          },
  );
  const src = "https://source.example/news";
  const newsResults = vi.fn(async () => ({
    response: {
      organic_results: [blocked, empty, src].map((link) => ({ link })),
    },
    urls: [blocked, empty, src],
    nextStart: null,
  }));
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
    namespace: "com/serpapi/landing-page-search",
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
  expect(readArticle.mock.calls.map(([url]) => url)).toEqual([
    blocked,
    empty,
    src,
  ]);
  const outcomes = [...objects]
    .filter(([k]) => k.startsWith("com/serpapi/landing-page-search/outcomes/"))
    .map(([, v]) => v.value);
  expect(outcomes).toHaveLength(2);
  expect(outcomes[0]).toMatchObject({
    personnel: { id: "p", name: "Officer Example" },
    variations: ["Officer Example"],
    decisions: [
      {
        url: blocked,
        matched: false,
        reason: "Publisher URL or redirect unavailable",
        matchingNames: null,
      },
      { url: empty, matched: false, matchingAgencies: null },
      {
        url: src,
        matched: true,
        matchingNames: ["Officer Example"],
        nameEvidence: [
          {
            name: "Officer Example",
            paragraphHashes: [expect.stringMatching(/^[a-f0-9]{64}$/)],
          },
        ],
        matchingAgencies: ["Test Agency"],
      },
    ],
  });
  expect(outcomes).toMatchObject([
    { outcome: "matched", providerRequests: 1, newUrls: 3 },
    { outcome: "matched", providerRequests: 1, newUrls: 0 },
  ]);
  await runDaily(new Date("2026-11-15T14:00:00Z"), deps);
  expect(newsResults).toHaveBeenCalledTimes(2);
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
    objects.get("com/serpapi/landing-page-search/state.json")!.value as {
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
    agencies: [{ id: "a", name: "Test Agency", state: "TX", path: agency }],
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
      objects.get("com/serpapi/landing-page-search/state.json")!.value as {
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
      agencies: [{ id: "a", name: "Test Agency", state: "TX", path: agency }],
      assignments: [{ id: "ap", personnelId: "p", agencyId: "a" }],
      coveragePaths: [path],
    };
    const occurrence = {
      url: a,
      namespace: "com/serpapi/landing-page-search",
      sourceId: a,
      title: "Wire story",
      sourceName: "Wire",
      summary: "Wire report",
      publishedAt: "2026-11-10",
      paragraphs: [{ hash: "first", text: "Earlier paragraph." }],
    };
    const article = {
      namespace: "com/serpapi/landing-page-search",
      sourceId: a,
      preferredUrl: a,
      normalizedUrl: a,
      occurrences: { [a]: occurrence },
      relationships: [
        {
          namespace: "com/serpapi/landing-page-search",
          sourceId: "existing-link",
          agencyPersonnelId: "ap",
          occurrenceUrl: a,
          confidence: "documented",
          notes: null,
        },
      ],
    };
    const key = JSON.stringify(["com/serpapi/landing-page-search", a]);
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
        namespace: "com/serpapi/landing-page-search",
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
      ["com/serpapi/landing-page-search/state.json", state],
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
      newsResults: async () => ({
        response: { organic_results: [{ link: b }] },
        urls: [b],
        nextStart: null,
      }),
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
    const after = records.get(
      "com/serpapi/landing-page-search/state.json",
    ) as typeof state;
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
        [b + "?utm_source=test"]: {
          namespace: "com/serpapi/landing-page-search",
          sourceId: b,
        },
      },
    });
    expect(
      batches.at(-1)!.destinations[0].update.ranking!.placements,
    ).toMatchObject([{ clicks: 22, position: 1, canonicalId: "canonical" }]);
  },
);

it("uses five distinct Chicago-day slots and resumes SerpApi pagination without restarting the seven-day wait", async () => {
  const { store, put } = dailyStorage();
  const other = "/personnel/other/";
  put("snapshot", {
    agencies: [
      { id: "a", name: "Test Agency", state: "TX", path: agency },
      { id: "b", name: "Other Agency", state: "MN", path: null },
    ],
    assignments: [
      { id: "ap", personnelId: "p", agencyId: "a" },
      { id: "ao", personnelId: "other", agencyId: "a" },
      { id: "bo", personnelId: "other", agencyId: "b" },
      { id: "bo2", personnelId: "other", agencyId: "b" },
    ],
    coveragePaths: [],
    personnel: [
      { id: "p", name: "First Officer", path },
      { id: "other", name: "Other Officer", path: other },
    ],
  });
  let activeRelease = release;
  const rows = Array.from({ length: 7 }, (_, i) => ({
    keys: ["term" + i, origin + path],
    impressions: 100 - i,
    clicks: 1,
  }));
  rows.push({ keys: ["term0", origin + other], impressions: 101, clicks: 2 });
  const calls: string[] = [];
  let allowance = 4;
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/account.json")
      return Response.json({
        plan_monthly_price: 0,
        plan_searches_left: allowance,
        this_hour_searches: 0,
        account_rate_limit_per_hour: 50,
      });
    expect(url.origin + url.pathname).toBe("https://serpapi.com/search.json");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      engine: "google",
      tbs: "qdr:w",
    });
    expect(url.searchParams.has("tbm")).toBe(false);
    const query = url.searchParams.get("q")!;
    const offset = url.searchParams.get("start");
    calls.push(query + "/" + offset);
    allowance--;
    if (query.startsWith('"term3" ') && offset === "0")
      return Response.json({
        organic_results: [],
        serpapi_pagination: {
          next: "https://serpapi.com/search.json?start=10&q=corrected+query",
        },
      });
    return Response.json({
      error: "Google hasn't returned any results for this query.",
    });
  });
  const unexpected = async () => {
    throw Error("Unexpected article operation");
  };
  const deps: NonNullable<Parameters<typeof runDaily>[1]> = {
    store,
    origin,
    bucket: "private",
    apiKey: "fixture",
    snapshot: async () => ({
      releaseId: activeRelease,
      roster: { bucket: "private", key: "snapshot" },
    }),
    consoleApi: {
      latestWindow: async () => ({
        startDate: "2026-11-06",
        endDate: "2026-11-12",
      }),
      rows: async (_window, offset) => (offset ? [] : rows),
      position: unexpected,
    },
    infer: unexpected,
    readArticle: unexpected,
    newsResults: searchSerpApi,
    publish: async () => ({}),
  };
  const run = (date: string) => runDaily(new Date(date), deps);
  vi.stubGlobal("fetch", fetch);
  try {
    await run("2026-11-14T13:00:00Z");
    expect(calls).toEqual([
      '"term0" "Other Officer" (("Other Agency" MN) OR ("Test Agency" TX))/0',
      '"term1" "First Officer" "Test Agency" TX/0',
      '"term2" "First Officer" "Test Agency" TX/0',
      '"term3" "First Officer" "Test Agency" TX/0',
    ]);
    allowance = 100;
    // Midnight UTC is still the same Chicago day.
    await run("2026-11-15T00:00:00Z");
    expect(calls.splice(4)).toEqual([
      '"term3" "First Officer" "Test Agency" TX/10',
      '"term4" "First Officer" "Test Agency" TX/0',
    ]);
    calls.length = 0;
    await run("2026-11-15T05:59:59Z");
    expect(calls).toEqual([]);
    activeRelease = "next-release";
    put("builds/next-release/data/alias.json", { CoverageLink: {} });
    put("builds/next-release/data/index.json", {
      news: { data: { articles: [] } },
    });
    await run("2026-11-15T06:00:00Z");
    expect(calls.splice(0)).toEqual([
      '"term5" "First Officer" "Test Agency" TX/0',
      '"term6" "First Officer" "Test Agency" TX/0',
    ]);
    await run("2026-11-21T12:59:59.999Z");
    expect(calls).toEqual([]);
    await run("2026-11-21T13:00:00Z");
    expect(calls).toEqual([
      '"term0" "Other Officer" (("Other Agency" MN) OR ("Test Agency" TX))/0',
      '"term1" "First Officer" "Test Agency" TX/0',
      '"term2" "First Officer" "Test Agency" TX/0',
      '"term3" "First Officer" "Test Agency" TX/0',
      '"term3" "First Officer" "Test Agency" TX/10',
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("builds case-insensitive name checks from the stored profile with an embedded suffix", async () => {
  const { bodyNameMatcher } =
    await import("../../../../../sources/lib/news.js");
  const variants = personnelSearchNames({
    name: "Example Allan Person II",
    firstName: "Example",
    middleName: "Allan",
    lastName: "Person II",
  });
  expect(variants).toEqual([
    "Example Allan Person II",
    "Example Allan Person",
    "Example A. Person II",
    "Example A. Person",
    "Example Person II",
    "Example Person",
  ]);
  for (const form of [
    "EXAMPLE ALLAN PERSON",
    "EXAMPLE A PERSON II",
    "example person",
    "Example Person II",
  ])
    expect(
      variants.some(bodyNameMatcher("About " + form + " at the agency")),
    ).toBe(true);
  expect(variants.some(bodyNameMatcher("Example Allen Person"))).toBe(false);
});
