import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { acquire } from "../../../sources/youtube.policeactivity/acquire.js";
import type {
  AcquireAgencyPage,
  AcquireDataContext,
} from "../../../src/cli/transform/source-transform.js";
import type { VideoEnvelope } from "../../../sources/youtube.policeactivity/video-envelope.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const agencies: AcquireDataContext = {
  agencies: async (): Promise<AcquireAgencyPage> => ({
    items: [
      {
        agencyId: "a1",
        name: "Irving Police Department",
        state: "TX",
        county: "Dallas",
        place: "Irving",
      },
    ],
  }),
};

function hit(videoId: string, publishedAt: string) {
  return {
    id: { videoId },
    snippet: {
      title: `Bodycam ${videoId}`,
      description: "Officer John Smith responds to a call.",
      publishedAt,
      channelId: "UCpa123",
    },
  };
}

/**
 * Stub the Data API: the handle resolves to UCpa123 and every search returns one
 * video stamped inside the slice it asked for, so the envelope can be checked
 * against the bounds the run used.
 */
function stubYoutube(options: { channelId?: string } = {}) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    requested.push(url);
    if (url.includes("/channels?")) {
      return new Response(
        JSON.stringify({ items: [{ id: options.channelId ?? "UCpa123" }] }),
      );
    }
    if (url.includes("/search?")) {
      // One hit per slice, published a day inside the slice's lower bound —
      // what a date-bounded search can actually return. (Exactly on the bound
      // would age out of the next run's slightly later window.)
      const after = new URL(url).searchParams.get("publishedAfter") ?? "";
      const publishedAt = new Date(
        Date.parse(after) + 86_400_000,
      ).toISOString();
      return new Response(
        JSON.stringify({ items: [hit(`v${after.slice(0, 4)}`, publishedAt)] }),
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  return { requested };
}

async function runAcquire(state: string): Promise<string> {
  const sourceDir = await tempDir("youtube-pa-out-");
  await acquire({
    sourceDir,
    state,
    env: { YOUTUBE_API_KEY: "test-key" },
    data: agencies,
  });
  return sourceDir;
}

async function envelopeIn(sourceDir: string): Promise<VideoEnvelope> {
  const names = (await readdir(sourceDir)).filter((name) =>
    name.endsWith(".videos.json"),
  );
  expect(names).toEqual(["irving-police-department.videos.json"]);
  return JSON.parse(
    await readFile(path.join(sourceDir, names[0]), "utf8"),
  ) as VideoEnvelope;
}

describe("youtube.policeactivity acquire", () => {
  it("fails loudly without an API key", async () => {
    await expect(
      acquire({
        sourceDir: await tempDir("youtube-pa-out-"),
        state: await tempDir("youtube-pa-state-"),
        env: {},
        data: agencies,
      }),
    ).rejects.toThrow(/YOUTUBE_API_KEY is required/);
  });

  it("stamps the agency, the channel, and the run's five-year window on the evidence", async () => {
    stubYoutube();
    const state = await tempDir("youtube-pa-state-");
    const envelope = await envelopeIn(await runAcquire(state));

    expect(envelope.source).toEqual({
      name: "PoliceActivity",
      handle: "@PoliceActivity",
      channelUrl: "https://www.youtube.com/PoliceActivity",
      channelId: "UCpa123",
    });
    expect(envelope.agency).toEqual({
      id: "a1",
      name: "Irving Police Department",
      state: "TX",
      county: "Dallas",
      place: "Irving",
    });

    const end = new Date(envelope.window.end);
    const start = new Date(envelope.window.start);
    expect(end.getUTCFullYear()).toBe(new Date().getUTCFullYear());
    expect(start.getUTCFullYear()).toBe(end.getUTCFullYear() - 5);

    // The channel id is persisted for later runs to assert against.
    expect(
      JSON.parse(await readFile(path.join(state, "channel.json"), "utf8")),
    ).toEqual({ handle: "@PoliceActivity", channelId: "UCpa123" });
  });

  it("searches the newest slice first, bounded by the window, with a retrieval time per video", async () => {
    const { requested } = stubYoutube();
    const state = await tempDir("youtube-pa-state-");
    const envelope = await envelopeIn(await runAcquire(state));
    const year = new Date().getUTCFullYear();

    const searches = requested.filter((url) => url.includes("/search?"));
    expect(searches).toHaveLength(1);
    const params = new URL(searches[0]).searchParams;
    expect(params.get("channelId")).toBe("UCpa123");
    expect(params.get("q")).toBe("Irving Police Department Irving");
    expect(params.get("publishedAfter")).toBe(`${year}-01-01T00:00:00.000Z`);
    expect(params.get("publishedBefore")).toBe(envelope.window.end);

    expect(envelope.videos).toHaveLength(1);
    expect(envelope.videos[0].videoId).toBe(`v${year}`);
    expect(Date.parse(envelope.videos[0].retrievedAt)).toBeGreaterThan(0);
  });

  it("fetches only the Data API — no media and no robots-disallowed path", async () => {
    const { requested } = stubYoutube();
    await runAcquire(await tempDir("youtube-pa-state-"));
    expect(
      requested.every((url) =>
        url.startsWith("https://www.googleapis.com/youtube/v3/"),
      ),
    ).toBe(true);
    expect(requested.some((url) => url.includes("/api/timedtext"))).toBe(false);
  });

  it("backfills one older slice per run and accumulates evidence without duplicating it", async () => {
    stubYoutube();
    const state = await tempDir("youtube-pa-state-");
    const year = new Date().getUTCFullYear();

    await runAcquire(state);
    const second = await envelopeIn(await runAcquire(state));
    expect(second.videos.map((v) => v.videoId)).toEqual([
      `v${year}`,
      `v${year - 1}`,
    ]);

    // Six runs cover the six calendar years the window touches; the seventh
    // re-searches the window's end year and adds nothing new.
    for (let run = 0; run < 5; run += 1) await runAcquire(state);
    const after = await envelopeIn(await runAcquire(state));
    expect(after.videos).toHaveLength(6);
    expect(new Set(after.videos.map((v) => v.videoId)).size).toBe(6);
  });

  it("halts when the handle starts resolving to a different channel", async () => {
    stubYoutube();
    const state = await tempDir("youtube-pa-state-");
    await runAcquire(state);

    vi.unstubAllGlobals();
    stubYoutube({ channelId: "UCimposter" });
    await expect(runAcquire(state)).rejects.toThrow(
      /already ingested channel UCpa123/,
    );
  });
});
