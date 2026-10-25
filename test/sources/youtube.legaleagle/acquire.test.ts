import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { acquire } from "../../../sources/youtube.legaleagle/acquire.js";
import { config } from "../../../sources/youtube.legaleagle/config.js";
import type {
  AcquireAgencyRecord,
  AcquireDataContext,
} from "../../../src/cli/transform/source-transform.js";
import {
  CACHE_FILE,
  type ChannelCache,
} from "../../../sources/lib/youtube-channel-cache.js";
import type { VideoEnvelope } from "../../../sources/lib/youtube-channel.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const RUN_AT = new Date("2026-10-24T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({
    now: RUN_AT,
    // Real timers for the polite inter-search delay, so the run still advances.
    toFake: ["Date"],
  });
});

function agency(
  agencyId: string,
  name: string,
  place = "Irving",
): AcquireAgencyRecord {
  return { agencyId, name, state: "TX", county: "Dallas", place };
}

/** A YouTube Data API stub: records every URL, answers from fixed pages. */
function fakeYoutube(
  options: {
    /** null = the pinned id returns no channel. */
    channelId?: string | null;
    liveHandle?: string;
    videosByQuery?: Record<string, string[]>;
  } = {},
) {
  const urls: string[] = [];
  // `?? ` would swallow an explicit null, which is the unverifiable-id case.
  const channelId =
    "channelId" in options ? options.channelId : config.channelId;
  const fetchImpl = async (input: unknown): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), { status: 200 });

    if (url.includes("/channels?")) {
      return json({
        items:
          channelId === null
            ? []
            : [
                {
                  id: channelId,
                  snippet: {
                    title: "LegalEagle",
                    customUrl: options.liveHandle ?? "@legaleagle",
                  },
                },
              ],
      });
    }
    if (url.includes("/search?")) {
      const query = decodeURIComponent(
        new URL(url).searchParams.get("q") ?? "",
      );
      const ids = options.videosByQuery?.[query] ?? [];
      return json({
        items: ids.map((id) => ({
          id: { videoId: id },
          snippet: {
            title: `Real lawyer reacts to ${id}`,
            description: `Officer John Smith in ${id}`,
            publishedAt: "2024-03-05T12:00:00Z",
            channelId,
          },
        })),
      });
    }
    return new Response("unexpected request", { status: 404 });
  };
  return { urls, fetchImpl };
}

function dataContext(agencies: AcquireAgencyRecord[]): AcquireDataContext {
  return {
    agencies: async ({ cursor }) => {
      // One agency per page, to exercise the paging loop.
      const index = cursor === undefined ? 0 : Number(cursor);
      const item = agencies[index];
      if (item === undefined) return { items: [] };
      return {
        items: [item],
        nextCursor: index + 1 < agencies.length ? String(index + 1) : undefined,
      };
    },
  };
}

async function run(options: {
  agencies: AcquireAgencyRecord[];
  youtube: ReturnType<typeof fakeYoutube>;
  state?: string;
  env?: Record<string, string | undefined>;
}): Promise<{ sourceDir: string; state: string; logs: string[] }> {
  const root = await mkdtemp(path.join(tmpdir(), "youtube-le-acq-"));
  tempDirs.push(root);
  const sourceDir = path.join(root, "source");
  const state = options.state ?? path.join(root, "state");
  const logs: string[] = [];
  vi.stubGlobal("fetch", options.youtube.fetchImpl);
  await acquire({
    sourceDir,
    state,
    env: options.env ?? { YOUTUBE_API_KEY: "test-key" },
    data: dataContext(options.agencies),
    logger: { info: (message) => logs.push(message) },
  });
  return { sourceDir, state, logs };
}

async function readEnvelope(
  sourceDir: string,
  name: string,
): Promise<VideoEnvelope> {
  return JSON.parse(
    await readFile(path.join(sourceDir, name), "utf8"),
  ) as VideoEnvelope;
}

describe("youtube.legaleagle acquire", () => {
  it("verifies the PINNED channel id by id, never by handle, and preserves it", async () => {
    const youtube = fakeYoutube();
    const { sourceDir } = await run({
      agencies: [agency("ag-1", "Irving Police Department")],
      youtube,
    });

    // Looked up by id...
    expect(
      youtube.urls.some((url) =>
        url.includes(`/channels?part=snippet&id=${config.channelId}`),
      ),
    ).toBe(true);
    // ...and never by handle, which could be renamed or transferred.
    expect(youtube.urls.some((url) => url.includes("forHandle"))).toBe(false);

    const channel = JSON.parse(
      await readFile(path.join(sourceDir, "channel.json"), "utf8"),
    );
    expect(channel).toEqual({
      channelId: config.channelId,
      handle: "@LegalEagle",
      liveHandle: "@legaleagle",
      liveTitle: "LegalEagle",
      window: {
        start: "2021-10-24T12:00:00.000Z",
        end: "2026-10-24T12:00:00.000Z",
      },
      retrievedAt: "2026-10-24T12:00:00.000Z",
    });

    // Every search is scoped to the pinned channel id.
    const searches = youtube.urls.filter((url) => url.includes("/search?"));
    expect(searches).not.toHaveLength(0);
    expect(
      searches.every((url) => url.includes(`channelId=${config.channelId}`)),
    ).toBe(true);
  });

  it("refuses to run when the pinned channel id returns no channel", async () => {
    await expect(
      run({
        agencies: [agency("ag-1", "Irving Police Department")],
        youtube: fakeYoutube({ channelId: null }),
      }),
    ).rejects.toThrow(/returned no channel/);
  });

  it("logs handle drift but still selects by the pinned id", async () => {
    const youtube = fakeYoutube({ liveHandle: "@SomethingElse" });
    const { logs } = await run({
      agencies: [agency("ag-1", "Irving Police Department")],
      youtube,
    });
    expect(logs.some((line) => /handle drift/.test(line))).toBe(true);
    expect(
      youtube.urls
        .filter((url) => url.includes("/search?"))
        .every((url) => url.includes(`channelId=${config.channelId}`)),
    ).toBe(true);
  });

  it("never requests the robots-disallowed caption endpoint", async () => {
    const youtube = fakeYoutube({
      videosByQuery: { "Irving Police Department Irving": ["v1"] },
    });
    await run({
      agencies: [agency("ag-1", "Irving Police Department")],
      youtube,
    });
    // youtube.com/robots.txt carries `Disallow: /api/`.
    expect(youtube.urls.some((url) => url.includes("/api/"))).toBe(false);
    expect(youtube.urls.some((url) => url.includes("timedtext"))).toBe(false);
    // Everything this source fetches goes to the keyed Data API host.
    expect(
      youtube.urls.every((url) =>
        url.startsWith("https://www.googleapis.com/"),
      ),
    ).toBe(true);
  });

  it("requires YOUTUBE_API_KEY before any network call", async () => {
    const youtube = fakeYoutube();
    await expect(
      run({
        agencies: [agency("ag-1", "Irving Police Department")],
        youtube,
        env: { YOUTUBE_API_KEY: "  " },
      }),
    ).rejects.toThrow(/YOUTUBE_API_KEY is required/);
    expect(youtube.urls).toEqual([]);
  });

  it("clips the search to the rolling window and stamps it on the envelope", async () => {
    const youtube = fakeYoutube({
      videosByQuery: { "Irving Police Department Irving": ["v1"] },
    });
    const { sourceDir } = await run({
      agencies: [agency("ag-1", "Irving Police Department")],
      youtube,
    });

    const search = youtube.urls.find((url) => url.includes("/search?")) ?? "";
    const params = new URL(search).searchParams;
    // The newest window year, clipped to the run instant.
    expect(params.get("publishedAfter")).toBe("2026-01-01T00:00:00.000Z");
    expect(params.get("publishedBefore")).toBe("2026-10-24T12:00:00.000Z");

    const envelope = await readEnvelope(sourceDir, "ag-1.videos.json");
    expect(envelope.window).toEqual({
      start: "2021-10-24T12:00:00.000Z",
      end: "2026-10-24T12:00:00.000Z",
    });
    expect(envelope.retrievedAt).toBe("2026-10-24T12:00:00.000Z");
    expect(envelope.channelId).toBe(config.channelId);
    expect(envelope.handle).toBe("@LegalEagle");
    expect(envelope.agency.id).toBe("ag-1");
  });

  it("stores a link and its provenance, never video media", async () => {
    const youtube = fakeYoutube({
      videosByQuery: { "Irving Police Department Irving": ["v1"] },
    });
    const { sourceDir } = await run({
      agencies: [agency("ag-1", "Irving Police Department")],
      youtube,
    });

    const envelope = await readEnvelope(sourceDir, "ag-1.videos.json");
    expect(envelope.videos).toEqual([
      {
        videoId: "v1",
        title: "Real lawyer reacts to v1",
        description: "Officer John Smith in v1",
        publishedAt: "2024-03-05T12:00:00Z",
        channelId: config.channelId,
        url: "https://www.youtube.com/watch?v=v1",
        retrievedAt: "2026-10-24T12:00:00.000Z",
      },
    ]);
    // No request ever asks for media.
    expect(
      youtube.urls.some((url) => /videoplayback|\.mp4|download/.test(url)),
    ).toBe(false);
  });

  it("searches one agency-year per agency per run, newest first", async () => {
    const youtube = fakeYoutube();
    const { state } = await run({
      agencies: [agency("ag-1", "Irving Police Department")],
      youtube,
    });

    expect(youtube.urls.filter((url) => url.includes("/search?"))).toHaveLength(
      1,
    );
    const cache = JSON.parse(
      await readFile(path.join(state, CACHE_FILE), "utf8"),
    ) as ChannelCache;
    expect(Object.keys(cache.agencies["ag-1"].years)).toEqual(["2026"]);
  });

  it("backfills the next older year on the following run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "youtube-le-state-"));
    tempDirs.push(root);
    const state = path.join(root, "state");

    await run({
      agencies: [agency("ag-1", "Irving Police Department")],
      youtube: fakeYoutube(),
      state,
    });
    await run({
      agencies: [agency("ag-1", "Irving Police Department")],
      youtube: fakeYoutube(),
      state,
    });

    const cache = JSON.parse(
      await readFile(path.join(state, CACHE_FILE), "utf8"),
    ) as ChannelCache;
    expect(Object.keys(cache.agencies["ag-1"].years).sort()).toEqual([
      "2025",
      "2026",
    ]);
  });

  it("searches never-searched agencies before ones already searched", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "youtube-le-fair-"));
    tempDirs.push(root);
    const state = path.join(root, "state");
    const first = agency("ag-1", "Irving Police Department", "Irving");
    const second = agency("ag-2", "Plano Police Department", "Plano");

    // Run one sees only ag-1, so ag-1 becomes the searched agency.
    await run({ agencies: [first], youtube: fakeYoutube(), state });

    // Run two sees ag-1 first in cursor order, but ag-2 has never been searched.
    const youtube = fakeYoutube();
    await run({ agencies: [first, second], youtube, state });

    const queries = youtube.urls
      .filter((url) => url.includes("/search?"))
      .map((url) =>
        decodeURIComponent(new URL(url).searchParams.get("q") ?? ""),
      );
    expect(queries[0]).toBe("Plano Police Department Plano");
  });

  it("writes an envelope for every agency with cached evidence, including ones this run did not search", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "youtube-le-env-"));
    tempDirs.push(root);
    const state = path.join(root, "state");
    const first = agency("ag-1", "Irving Police Department", "Irving");
    const second = agency("ag-2", "Plano Police Department", "Plano");

    await run({ agencies: [first], youtube: fakeYoutube(), state });
    const { sourceDir } = await run({
      agencies: [first, second],
      youtube: fakeYoutube(),
      state,
    });

    const written = (await readdir(sourceDir))
      .filter((name) => name.endsWith(".videos.json"))
      .sort();
    expect(written).toEqual(["ag-1.videos.json", "ag-2.videos.json"]);
  });

  it("halts the run on an exhausted quota and leaves the rest for the next run", async () => {
    const urls: string[] = [];
    const fetchImpl = async (input: unknown): Promise<Response> => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/channels?")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: config.channelId,
                snippet: { title: "LegalEagle", customUrl: "@legaleagle" },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          error: { errors: [{ reason: "quotaExceeded" }] },
        }),
        { status: 403 },
      );
    };

    const { logs, state } = await run({
      agencies: [
        agency("ag-1", "Irving Police Department", "Irving"),
        agency("ag-2", "Plano Police Department", "Plano"),
      ],
      youtube: { urls, fetchImpl },
    });

    // One search attempt, then the run stops rather than hammering the quota.
    expect(urls.filter((url) => url.includes("/search?"))).toHaveLength(1);
    expect(logs.some((line) => /quota exhausted/.test(line))).toBe(true);
    expect(logs.some((line) => /stopped on quota/.test(line))).toBe(true);
    const cache = JSON.parse(
      await readFile(path.join(state, CACHE_FILE), "utf8").catch(
        () => '{"agencies":{}}',
      ),
    ) as ChannelCache;
    expect(cache.agencies).toEqual({});
  });
});
