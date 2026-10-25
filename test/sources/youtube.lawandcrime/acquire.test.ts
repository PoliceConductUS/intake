import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { acquire } from "../../../sources/youtube.lawandcrime/acquire.js";
import { CHANNEL_ID } from "../../../sources/youtube.lawandcrime/channel.js";
import type { AcquireAgencyRecord } from "../../../src/cli/transform/source-transform.js";

const tempDirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

const IRVING: AcquireAgencyRecord = {
  agencyId: "a1",
  name: "Irving Police Department",
  state: "TX",
  county: "Dallas",
  place: "Irving",
};

type Hit = { videoId: string; publishedAt: string; title?: string };

/**
 * Stand in for the network the way the source actually reaches it: one global
 * `fetch`, so the test covers the keyed/retrying wiring and can assert exactly
 * which URLs the source is willing to request.
 */
function stubYoutube(options: {
  channelItems?: unknown[];
  hitsByUrl?: (url: string) => Hit[];
}) {
  const urls: string[] = [];
  const fetchStub = vi.fn(async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/channels?")) {
      return new Response(
        JSON.stringify({
          items: options.channelItems ?? [
            {
              id: CHANNEL_ID,
              snippet: {
                customUrl: "@lawandcrime",
                title: "Law&Crime Network",
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/search?")) {
      const hits = options.hitsByUrl?.(url) ?? [];
      return new Response(
        JSON.stringify({
          items: hits.map((hit) => ({
            id: { videoId: hit.videoId },
            snippet: {
              title: hit.title ?? hit.videoId,
              description: "",
              publishedAt: hit.publishedAt,
              channelId: CHANNEL_ID,
            },
          })),
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchStub);
  return { urls };
}

async function run(
  options: Parameters<typeof stubYoutube>[0] & {
    agencies?: AcquireAgencyRecord[];
    sourceDir?: string;
    state?: string;
  } = {},
) {
  const dir = options.sourceDir ?? (await mkdtemp(path.join(tmpdir(), "lac-")));
  const state = options.state ?? (await mkdtemp(path.join(tmpdir(), "lac-s-")));
  if (options.sourceDir === undefined) tempDirs.push(dir);
  if (options.state === undefined) tempDirs.push(state);
  const { urls } = stubYoutube(options);
  const logs: string[] = [];
  await acquire({
    sourceDir: dir,
    state,
    env: { YOUTUBE_API_KEY: "test-key" },
    data: {
      agencies: async () => ({ items: options.agencies ?? [IRVING] }),
    },
    logger: { info: (message) => logs.push(message) },
  });
  return { dir, state, urls, logs };
}

async function envelope(dir: string) {
  return JSON.parse(
    await readFile(
      path.join(dir, "irving-police-department.videos.json"),
      "utf8",
    ),
  );
}

describe("youtube.lawandcrime acquire", () => {
  it("requires an API key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lac-"));
    tempDirs.push(dir);
    await expect(
      acquire({
        sourceDir: dir,
        state: dir,
        env: {},
        data: { agencies: async () => ({ items: [] }) },
      }),
    ).rejects.toThrow(/YOUTUBE_API_KEY is required/);
  });

  it("verifies the pinned channel id and records the handle as provenance", async () => {
    const { dir, urls } = await run({});
    expect(urls[0]).toContain(`/channels?part=snippet&id=${CHANNEL_ID}`);
    expect(
      JSON.parse(await readFile(path.join(dir, "channel.json"), "utf8")),
    ).toEqual({
      channelId: CHANNEL_ID,
      handle: "@lawandcrime",
      title: "Law&Crime Network",
    });
  });

  it("fails loudly when the pinned id resolves to no channel", async () => {
    await expect(run({ channelItems: [] })).rejects.toThrow(
      /resolves to no channel/,
    );
  });

  it("keeps the pinned id and logs drift when the handle has changed", async () => {
    const { logs, urls } = await run({
      channelItems: [
        {
          id: CHANNEL_ID,
          snippet: { customUrl: "@somethingelse", title: "X" },
        },
      ],
    });
    expect(
      logs.some((l) => l.includes("now publishes as @somethingelse")),
    ).toBe(true);
    expect(urls.filter((u) => u.includes("/search?"))[0]).toContain(
      `channelId=${CHANNEL_ID}`,
    );
  });

  it("bounds the search to the rolling five-year window", async () => {
    const { urls } = await run({});
    const search = new URL(urls.filter((u) => u.includes("/search?"))[0]);
    const after = search.searchParams.get("publishedAfter");
    const before = search.searchParams.get("publishedBefore");
    const now = Date.now();
    const fiveYears = new Date();
    fiveYears.setUTCFullYear(fiveYears.getUTCFullYear() - 5);

    expect(search.searchParams.get("q")).toBe(
      "Irving Police Department Irving",
    );
    expect(Date.parse(after!)).toBeGreaterThanOrEqual(
      fiveYears.getTime() - 1000,
    );
    expect(Date.parse(before!)).toBeLessThanOrEqual(now + 1000);
  });

  it("never requests a path the publisher's robots.txt disallows", async () => {
    const { urls } = await run({
      hitsByUrl: () => [{ videoId: "v1", publishedAt: isoYearsAgo(1) }],
    });
    // youtube.com/robots.txt carries `Disallow: /api/`, which is where the
    // timedtext caption track lives. Everything this source asks for is the
    // keyed Data API on googleapis.com.
    expect(urls.every((u) => u.startsWith("https://www.googleapis.com/"))).toBe(
      true,
    );
    expect(urls.some((u) => u.includes("timedtext"))).toBe(false);
  });

  it("preserves link provenance for every in-window video", async () => {
    const publishedAt = isoYearsAgo(1);
    const { dir } = await run({
      hitsByUrl: () => [{ videoId: "v1", publishedAt, title: "Bodycam" }],
    });
    const written = await envelope(dir);

    expect(written.agency).toEqual({
      id: "a1",
      name: "Irving Police Department",
      state: "TX",
      county: "Dallas",
      place: "Irving",
    });
    expect(written.channel.channelId).toBe(CHANNEL_ID);
    expect(Date.parse(written.window.from)).toBeLessThan(
      Date.parse(written.window.to),
    );
    expect(written.videos).toHaveLength(1);
    expect(written.videos[0]).toMatchObject({
      videoId: "v1",
      url: "https://www.youtube.com/watch?v=v1",
      channelId: CHANNEL_ID,
      publishedAt,
    });
    expect(Date.parse(written.videos[0].retrievedAt)).not.toBeNaN();
    // No video media, only the link and its text.
    expect(Object.keys(written.videos[0]).sort()).toEqual([
      "channelId",
      "description",
      "publishedAt",
      "retrievedAt",
      "title",
      "url",
      "videoId",
    ]);
  });

  it("keeps an out-of-window video out of the envelope", async () => {
    const { dir } = await run({
      hitsByUrl: () => [
        { videoId: "fresh", publishedAt: isoYearsAgo(1) },
        // A hit the API should not have returned for a window-bounded request;
        // the envelope filter is the backstop that keeps it from linking.
        { videoId: "ancient", publishedAt: isoYearsAgo(9) },
      ],
    });
    expect(
      (await envelope(dir)).videos.map((v: { videoId: string }) => v.videoId),
    ).toEqual(["fresh"]);
  });

  it("re-writes a cached in-window video on a later run without searching it again", async () => {
    const state = await mkdtemp(path.join(tmpdir(), "lac-s-"));
    const dir = await mkdtemp(path.join(tmpdir(), "lac-"));
    tempDirs.push(state, dir);
    const publishedAt = isoYearsAgo(1);

    const first = await run({
      sourceDir: dir,
      state,
      hitsByUrl: () => [{ videoId: "v1", publishedAt }],
    });
    const firstSearch = new URL(
      first.urls.filter((u) => u.includes("/search?"))[0],
    );
    const firstYear = firstSearch.searchParams
      .get("publishedAfter")!
      .slice(0, 4);

    // A second run backfills the next year down; it does not re-search the year
    // it already has, yet the envelope still carries the cached video so the
    // transform reconsiders it.
    const second = await run({
      sourceDir: dir,
      state,
      hitsByUrl: () => [],
    });
    const secondYear = new URL(
      second.urls.filter((u) => u.includes("/search?"))[0],
    ).searchParams
      .get("publishedAfter")!
      .slice(0, 4);

    expect(secondYear).not.toBe(firstYear);
    expect(
      (await envelope(dir)).videos.map((v: { videoId: string }) => v.videoId),
    ).toEqual(["v1"]);
  });

  it("does not drop a cached video when a re-search of the same year returns fewer hits", async () => {
    const state = await mkdtemp(path.join(tmpdir(), "lac-s-"));
    const dir = await mkdtemp(path.join(tmpdir(), "lac-"));
    tempDirs.push(state, dir);
    const publishedAt = isoYearsAgo(0);

    // Backfill every year in the window so the next run re-searches the still
    // open current year. The fake answers like the API does: a hit comes back
    // only from the request whose window actually contains it.
    for (let i = 0; i <= 5; i += 1) {
      await run({
        sourceDir: dir,
        state,
        hitsByUrl: (url) => {
          const params = new URL(url).searchParams;
          const at = Date.parse(publishedAt);
          return at >= Date.parse(params.get("publishedAfter")!) &&
            at <= Date.parse(params.get("publishedBefore")!)
            ? [{ videoId: "v1", publishedAt }]
            : [];
        },
      });
    }
    // The re-search of the current year returns nothing (search caps at 50 hits
    // and reorders), but v1 is still in the window and must keep being offered.
    await run({ sourceDir: dir, state, hitsByUrl: () => [] });
    expect(
      (await envelope(dir)).videos.map((v: { videoId: string }) => v.videoId),
    ).toEqual(["v1"]);
  });
});

function isoYearsAgo(years: number): string {
  const at = new Date();
  at.setUTCFullYear(at.getUTCFullYear() - years);
  // Step inside the boundary so a same-instant comparison cannot flip, and so
  // `isoYearsAgo(0)` is a moment that has already happened.
  return new Date(at.getTime() - 60_000).toISOString();
}
