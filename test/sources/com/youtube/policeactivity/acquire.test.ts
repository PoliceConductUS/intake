import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquire } from "../../../../../sources/com/youtube/policeactivity/acquire.js";
import type {
  AcquireAgencyRecord,
  AcquireDataContext,
} from "../../../../../src/cli/transform/source-transform.js";
import { unusedServiceClients } from "../../../../shared/services/harness.js";

const tempDirs: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

function agency(
  agencyId: string,
  name: string,
  state: string,
  place: string,
): AcquireAgencyRecord {
  return { agencyId, name, state, county: null, place };
}

function dataWith(agencies: AcquireAgencyRecord[]): AcquireDataContext {
  return {
    agencies: async () => ({ items: agencies }),
  } as unknown as AcquireDataContext;
}

function searchItem(videoId: string) {
  return {
    id: { videoId },
    snippet: {
      title: `Title ${videoId}`,
      description: `Description ${videoId}`,
      publishedAt: "2026-02-03T00:00:00Z",
      channelId: "UCpa",
    },
  };
}

type Reply = { status: number; body: unknown };

function stubFetch(handlers: { search: (url: URL, call: number) => Reply }) {
  const searches: URL[] = [];
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    requests.push(input);
    const url = new URL(input);
    let reply: Reply;
    if (url.pathname.endsWith("/channels")) {
      reply = { status: 200, body: { items: [{ id: "UCpa" }] } };
    } else if (url.pathname.endsWith("/search")) {
      searches.push(url);
      reply = handlers.search(url, searches.length);
    } else {
      throw new Error(`unexpected request ${input}`);
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  return Object.assign(searches, { requests });
}

async function run(
  agencies: AcquireAgencyRecord[],
  options: {
    env?: Record<string, string>;
    cache?: unknown;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "youtube-pa-acquire-"));
  tempDirs.push(root);
  const sourceDir = path.join(root, "output");
  const state = path.join(root, "state");
  if (options.cache !== undefined) {
    await mkdir(state, { recursive: true });
    await writeFile(
      path.join(state, "video-cache.json"),
      JSON.stringify(options.cache),
    );
  }
  const logs: string[] = [];
  const result = acquire({
    clients: unusedServiceClients(),
    sourceDir,
    state,
    env: { YOUTUBE_API_KEY: "key", ...options.env },
    data: dataWith(agencies),
    logger: { info: (message) => logs.push(message) },
  });
  return {
    result,
    logs,
    files: async () =>
      (await readdir(sourceDir)).filter((f) => f.endsWith(".videos.json")),
    file: async (name: string) =>
      JSON.parse(await readFile(path.join(sourceDir, name), "utf8")),
    cache: async () =>
      JSON.parse(await readFile(path.join(state, "video-cache.json"), "utf8")),
  };
}

function cachedVideo(videoId: string) {
  return {
    videoId,
    title: `Title ${videoId}`,
    description: "",
    publishedAt: "2025-05-05T00:00:00Z",
    channelId: "UCpa",
    url: `https://www.youtube.com/watch?v=${videoId}`,
    retrievedAt: "2026-01-02T00:00:00.000Z",
  };
}

// Every window year before 2026 searched after it ended, so the next slice is 2026.
function pastYearsSearched(): Record<
  string,
  { searchedAt: string; videos: unknown[] }
> {
  const years: Record<string, { searchedAt: string; videos: unknown[] }> = {};
  for (let year = 2021; year <= 2025; year += 1) {
    years[String(year)] = {
      searchedAt: "2026-01-02T00:00:00.000Z",
      videos: [],
    };
  }
  return years;
}

describe("com/youtube/policeactivity acquire", () => {
  it("throws on an agency with a blank name, naming the agency's ID", async () => {
    stubFetch({ search: () => ({ status: 200, body: { items: [] } }) });
    const { result } = await run([agency("sa-blank", "  ", "TX", "Irving")]);
    await expect(result).rejects.toThrow(
      "com/youtube/policeactivity: agency sa-blank has a blank name.",
    );
  });

  it("keeps two agencies with one name in different states in separate cache entries and files named by agency ID", async () => {
    stubFetch({
      search: (_url, call) => ({
        status: 200,
        body: { items: [searchItem(call === 1 ? "vIL" : "vMO")] },
      }),
    });
    const { result, files, file, cache } = await run([
      agency("sa-il", "Springfield Police Department", "IL", "Springfield"),
      agency("sa/mo", "Springfield Police Department", "MO", "Springfield"),
    ]);
    await result;

    expect((await files()).sort()).toEqual([
      "sa%2Fmo.videos.json",
      "sa-il.videos.json",
    ]);
    const illinois = await file("sa-il.videos.json");
    expect(illinois.agency).toEqual({
      id: "sa-il",
      name: "Springfield Police Department",
      state: "IL",
      county: "",
      place: "Springfield",
    });
    expect(illinois.videos.map((v: { videoId: string }) => v.videoId)).toEqual([
      "vIL",
    ]);
    const missouri = await file("sa%2Fmo.videos.json");
    expect(missouri.agency.id).toBe("sa/mo");
    expect(missouri.agency.state).toBe("MO");
    expect(missouri.videos.map((v: { videoId: string }) => v.videoId)).toEqual([
      "vMO",
    ]);
    expect(Object.keys((await cache()).agencies).sort()).toEqual([
      "sa-il",
      "sa/mo",
    ]);
  });

  it("requests only the YouTube Data API and saves each video without caption text", async () => {
    const { requests } = stubFetch({
      search: () => ({ status: 200, body: { items: [searchItem("v1")] } }),
    });
    const { result, file, logs } = await run([
      agency("sa-1", "Irving Police Department", "TX", "Irving"),
    ]);
    await result;

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(new URL(request).origin).toBe("https://www.googleapis.com");
    }
    expect((await file("sa-1.videos.json")).videos).toEqual([
      {
        videoId: "v1",
        title: "Title v1",
        description: "Description v1",
        publishedAt: "2026-02-03T00:00:00Z",
        channelId: "UCpa",
        url: "https://www.youtube.com/watch?v=v1",
        retrievedAt: "2026-06-15T12:00:00.000Z",
      },
    ]);
    expect(logs.join("\n")).not.toMatch(/caption/i);
  });

  it("writes the cached years of an agency whose search failed, with the failure in the file", async () => {
    stubFetch({ search: () => ({ status: 404, body: { error: {} } }) });
    const { result, file, logs, cache } = await run(
      [agency("sa-1", "Irving Police Department", "TX", "Irving")],
      {
        cache: {
          agencies: {
            "sa-1": {
              years: {
                "2025": {
                  searchedAt: "2026-01-02T00:00:00.000Z",
                  videos: [cachedVideo("v2025")],
                },
              },
            },
          },
        },
      },
    );
    await result;

    const saved = await file("sa-1.videos.json");
    expect(saved.videos.map((v: { videoId: string }) => v.videoId)).toEqual([
      "v2025",
    ]);
    expect(saved.searchFailure.year).toBe(2026);
    expect(saved.searchFailure.error).toContain("404");
    expect(Object.keys((await cache()).agencies["sa-1"].years)).toEqual([
      "2025",
    ]);
    expect(logs.at(-1)).toContain("1 failed");
  });

  it("writes no file for an agency whose search failed and that has no cached year", async () => {
    stubFetch({ search: () => ({ status: 404, body: { error: {} } }) });
    const { result, files, logs } = await run([
      agency("sa-1", "Irving Police Department", "TX", "Irving"),
    ]);
    await result;
    expect(await files()).toEqual([]);
    expect(logs.at(-1)).toContain("1 failed");
  });

  it("searches the current year again and replaces its cached videos", async () => {
    const searches = stubFetch({
      search: () => ({ status: 200, body: { items: [searchItem("vNew")] } }),
    });
    const { result, cache } = await run(
      [agency("sa-1", "Irving Police Department", "TX", "Irving")],
      {
        cache: {
          agencies: {
            "sa-1": {
              years: {
                ...pastYearsSearched(),
                "2026": {
                  searchedAt: "2026-03-01T00:00:00.000Z",
                  videos: [],
                },
              },
            },
          },
        },
      },
    );
    await result;

    expect(searches).toHaveLength(1);
    expect(searches[0].searchParams.get("publishedAfter")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    const year = (await cache()).agencies["sa-1"].years["2026"];
    expect(year.searchedAt).toBe("2026-06-15T12:00:00.000Z");
    expect(year.videos.map((v: { videoId: string }) => v.videoId)).toEqual([
      "vNew",
    ]);
  });

  it("searches a never-searched agency before the agencies searched before, oldest search first", async () => {
    const searches = stubFetch({
      search: () => ({ status: 200, body: { items: [] } }),
    });
    const searchedOn = (searchedAt: string) => ({
      years: { ...pastYearsSearched(), "2026": { searchedAt, videos: [] } },
    });
    const { result } = await run(
      [
        agency("sa-a", "Alpha Police Department", "TX", ""),
        agency("sa-b", "Bravo Police Department", "TX", ""),
        agency("sa-c", "Charlie Police Department", "TX", ""),
      ],
      {
        cache: {
          agencies: {
            "sa-a": searchedOn("2026-05-01T00:00:00.000Z"),
            "sa-b": searchedOn("2026-04-01T00:00:00.000Z"),
          },
        },
      },
    );
    await result;

    expect(searches.map((url) => url.searchParams.get("q"))).toEqual([
      "Charlie Police Department",
      "Bravo Police Department",
      "Alpha Police Department",
    ]);
  });

  it("stops searching on a spent quota and still writes the cached years of the agencies after it", async () => {
    const searches = stubFetch({
      search: () => ({
        status: 403,
        body: { error: { errors: [{ reason: "quotaExceeded" }] } },
      }),
    });
    const cached = (videoId: string, searchedAt: string) => ({
      years: { "2026": { searchedAt, videos: [cachedVideo(videoId)] } },
    });
    const { result, files, file, logs } = await run(
      [
        agency("sa-a", "Alpha Police Department", "TX", ""),
        agency("sa-b", "Bravo Police Department", "TX", ""),
      ],
      {
        cache: {
          agencies: {
            "sa-a": cached("vA", "2026-04-01T00:00:00.000Z"),
            "sa-b": cached("vB", "2026-05-01T00:00:00.000Z"),
          },
        },
      },
    );
    await result;

    expect(searches).toHaveLength(1);
    expect((await files()).sort()).toEqual([
      "sa-a.videos.json",
      "sa-b.videos.json",
    ]);
    expect(
      (await file("sa-b.videos.json")).videos.map(
        (v: { videoId: string }) => v.videoId,
      ),
    ).toEqual(["vB"]);
    expect(logs.at(-1)).toContain("stopped on quota");
    expect(logs.at(-1)).toContain("1 not searched after the quota stop");
  });

  it("stamps the channel and the run's five-year window on the evidence and persists the channel id", async () => {
    stubFetch({ search: () => ({ status: 200, body: { items: [] } }) });
    const { result, file } = await run(
      [agency("sa-1", "Irving Police Department", "TX", "Irving")],
      { cache: { agencies: { "sa-1": { years: pastYearsSearched() } } } },
    );
    await result;
    const saved = await file("sa-1.videos.json");
    expect(saved.source).toEqual({
      name: "PoliceActivity",
      handle: "@PoliceActivity",
      channelUrl: "https://www.youtube.com/PoliceActivity",
      channelId: "UCpa",
    });
    expect(saved.window).toEqual({
      start: "2021-06-15T12:00:00.000Z",
      end: "2026-06-15T12:00:00.000Z",
    });
  });

  it("bounds the first slice by the window: the newest year, ending at the run", async () => {
    const searches = stubFetch({
      search: () => ({ status: 200, body: { items: [] } }),
    });
    const { result } = await run([
      agency("sa-1", "Irving Police Department", "TX", "Irving"),
    ]);
    await result;
    expect(searches).toHaveLength(1);
    expect(searches[0].searchParams.get("publishedAfter")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(searches[0].searchParams.get("publishedBefore")).toBe(
      "2026-06-15T12:00:00.000Z",
    );
  });

  it("backfills one older slice per run, clipping the oldest to the window start, then re-searches the end year", async () => {
    const searches = stubFetch({
      search: (url) => {
        const after = url.searchParams.get("publishedAfter") ?? "";
        const publishedAt = new Date(
          Date.parse(after) + 86_400_000,
        ).toISOString();
        return {
          status: 200,
          body: {
            items: [
              {
                ...searchItem(`v${after.slice(0, 4)}`),
                snippet: { ...searchItem("x").snippet, publishedAt },
              },
            ],
          },
        };
      },
    });
    const root = await mkdtemp(path.join(tmpdir(), "youtube-pa-backfill-"));
    tempDirs.push(root);
    const sourceDir = path.join(root, "output");
    const state = path.join(root, "state");
    const once = () =>
      acquire({
        clients: unusedServiceClients(),
        sourceDir,
        state,
        env: { YOUTUBE_API_KEY: "key" },
        data: dataWith([
          agency("sa-1", "Irving Police Department", "TX", "Irving"),
        ]),
      });
    for (let i = 0; i < 7; i += 1) await once();

    expect(
      searches.map((url) => url.searchParams.get("publishedAfter")),
    ).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2025-01-01T00:00:00.000Z",
      "2024-01-01T00:00:00.000Z",
      "2023-01-01T00:00:00.000Z",
      "2022-01-01T00:00:00.000Z",
      "2021-06-15T12:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
    const saved = JSON.parse(
      await readFile(path.join(sourceDir, "sa-1.videos.json"), "utf8"),
    );
    expect(saved.videos.map((v: { videoId: string }) => v.videoId)).toEqual([
      "v2026",
      "v2025",
      "v2024",
      "v2023",
      "v2022",
      "v2021",
    ]);
  });

  it("halts when the handle starts resolving to a different channel", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "youtube-pa-channel-"));
    tempDirs.push(root);
    const state = path.join(root, "state");
    await mkdir(state, { recursive: true });
    await writeFile(
      path.join(state, "channel.json"),
      JSON.stringify({ handle: "@PoliceActivity", channelId: "UCother" }),
    );
    const searches = stubFetch({
      search: () => ({ status: 200, body: { items: [] } }),
    });
    await expect(
      acquire({
        clients: unusedServiceClients(),
        sourceDir: path.join(root, "output"),
        state,
        env: { YOUTUBE_API_KEY: "key" },
        data: dataWith([
          agency("sa-1", "Irving Police Department", "TX", "Irving"),
        ]),
      }),
    ).rejects.toThrow(
      "com/youtube/policeactivity: @PoliceActivity now resolves to channel UCpa but this source already ingested channel UCother. Resolve which channel is official before acquiring again.",
    );
    expect(searches).toHaveLength(0);
  });
});
