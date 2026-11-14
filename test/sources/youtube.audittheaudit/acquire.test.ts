import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { acquire } from "../../../sources/youtube.audittheaudit/acquire.js";
import type { AcquireAgencyRecord } from "../../../src/cli/transform/source-transform.js";

const CHANNEL_ID = "UCc-0YpRpqgA5lPTpSQ5uo-Q";
const NOW = "2026-10-24T12:00:00.000Z";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

function agency(
  agencyId: string,
  name: string,
  state: string,
  place: string,
): AcquireAgencyRecord {
  return { agencyId, name, state, county: null, place };
}

function hit(videoId: string, publishedAt: string, channelId = CHANNEL_ID) {
  return {
    id: { videoId },
    snippet: {
      title: `${videoId} title`,
      description: `${videoId} description`,
      publishedAt,
      channelId,
    },
  };
}

type Scenario = {
  agencies?: AcquireAgencyRecord[];
  channelItems?: unknown[];
  searchItems?: (url: string) => unknown[];
  searchStatus?: (url: string) => number;
  state?: string;
};

async function run(scenario: Scenario = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "youtube-ata-acquire-"));
  tempDirs.push(dir);
  const sourceDir = path.join(dir, "source");
  const state = scenario.state ?? path.join(dir, "state");
  const urls: string[] = [];
  const logs: string[] = [];

  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    if (url.includes("/channels?")) {
      return new Response(
        JSON.stringify({
          items: scenario.channelItems ?? [{ id: CHANNEL_ID }],
        }),
        { status: 200 },
      );
    }
    const status = scenario.searchStatus?.(url) ?? 200;
    if (status === 200) {
      return new Response(
        JSON.stringify({ items: scenario.searchItems?.(url) ?? [] }),
        { status },
      );
    }
    // 403 is how YouTube reports a spent daily quota; any other failure is an
    // ordinary error.
    const body =
      status === 403
        ? { error: { errors: [{ reason: "quotaExceeded" }] } }
        : { error: { errors: [{ reason: "notFound" }] } };
    return new Response(JSON.stringify(body), { status });
  });

  await acquire({
    sourceDir,
    state,
    env: { YOUTUBE_API_KEY: "KEY123" },
    data: {
      agencies: async () => ({
        items: scenario.agencies ?? [
          agency("a1", "Irving Police Department", "TX", "Irving"),
        ],
      }),
    },
    logger: { info: (message) => logs.push(message) },
  });

  return { dir, sourceDir, state, urls, logs };
}

async function envelopes(sourceDir: string): Promise<string[]> {
  return (await readdir(sourceDir)).filter((f) => f.endsWith(".videos.json"));
}

describe("youtube.audittheaudit acquire", () => {
  it("requires an api key", async () => {
    await expect(
      acquire({
        sourceDir: ".",
        state: ".",
        env: {},
        data: { agencies: async () => ({ items: [] }) },
      }),
    ).rejects.toThrow(/YOUTUBE_API_KEY is required/);
  });

  it("stops when the handle no longer resolves to the configured channel", async () => {
    await expect(
      run({ channelItems: [{ id: "UCsomeoneelse" }] }),
    ).rejects.toThrow(
      /resolves to UCsomeoneelse, not the configured channel id/,
    );
    await expect(run({ channelItems: [] })).rejects.toThrow(
      /resolves to no channel/,
    );
  });

  it("records the resolved channel and the window it acquired for", async () => {
    const { sourceDir } = await run();
    expect(
      JSON.parse(await readFile(path.join(sourceDir, "channel.json"), "utf8")),
    ).toEqual({
      handle: "@AuditTheAudit",
      channelId: CHANNEL_ID,
      window: { startsAt: "2021-10-24T12:00:00.000Z", endsAt: NOW },
      retrievedAt: NOW,
    });
  });

  it("searches the channel bounded to the rolling five-year window", async () => {
    const { urls } = await run();
    const search = urls.find((url) => url.includes("/search?"))!;
    expect(search).toContain(`channelId=${CHANNEL_ID}`);
    expect(search).toContain("q=Irving+Police+Department+Irving");
    // First run: the open year, clamped to the run instant.
    expect(search).toContain("publishedAfter=2026-01-01T00%3A00%3A00.000Z");
    expect(search).toContain("publishedBefore=2026-10-24T12%3A00%3A00.000Z");
  });

  it("reads only the YouTube Data API, never video media or captions", async () => {
    const { urls } = await run({
      searchItems: () => [hit("v1", "2026-03-01T00:00:00Z")],
    });
    expect(
      urls.every((url) =>
        url.startsWith("https://www.googleapis.com/youtube/v3/"),
      ),
    ).toBe(true);
  });

  it("stamps each agency's videos with that agency's source id", async () => {
    const { sourceDir } = await run({
      searchItems: (url) =>
        url.includes("Irving") ? [hit("v1", "2026-03-01T00:00:00Z")] : [],
      agencies: [
        agency("a1", "Irving Police Department", "TX", "Irving"),
        agency("a2", "Plano Police Department", "TX", "Plano"),
      ],
    });

    const files = await envelopes(sourceDir);
    expect(files.sort()).toEqual([
      "irving-police-department.a1.videos.json",
      "plano-police-department.a2.videos.json",
    ]);
    const irving = JSON.parse(
      await readFile(
        path.join(sourceDir, "irving-police-department.a1.videos.json"),
        "utf8",
      ),
    );
    expect(irving.agency).toEqual({
      id: "a1",
      name: "Irving Police Department",
      state: "TX",
      county: "",
      place: "Irving",
    });
    expect(irving.channel).toEqual({
      id: CHANNEL_ID,
      handle: "@AuditTheAudit",
    });
    expect(irving.window).toEqual({
      startsAt: "2021-10-24T12:00:00.000Z",
      endsAt: NOW,
    });
    expect(irving.retrievedAt).toBe(NOW);
    expect(irving.videos).toEqual([
      {
        videoId: "v1",
        title: "v1 title",
        description: "v1 description",
        publishedAt: "2026-03-01T00:00:00Z",
        channelId: CHANNEL_ID,
        url: "https://www.youtube.com/watch?v=v1",
      },
    ]);
  });

  it("keeps same-named agencies in different states apart", async () => {
    const { sourceDir } = await run({
      searchItems: (url) =>
        url.includes("Springfield+Police+Department+Springfield+IL")
          ? [hit("il1", "2026-03-01T00:00:00Z")]
          : [hit("mo1", "2026-03-02T00:00:00Z")],
      agencies: [
        agency("il-1", "Springfield Police Department", "IL", "Springfield IL"),
        agency("mo-1", "Springfield Police Department", "MO", "Springfield MO"),
      ],
    });

    const files = await envelopes(sourceDir);
    expect(files.sort()).toEqual([
      "springfield-police-department.il-1.videos.json",
      "springfield-police-department.mo-1.videos.json",
    ]);
    const illinois = JSON.parse(
      await readFile(
        path.join(sourceDir, "springfield-police-department.il-1.videos.json"),
        "utf8",
      ),
    );
    expect(illinois.videos.map((v: { videoId: string }) => v.videoId)).toEqual([
      "il1",
    ]);
  });

  it("backfills one older year per run and accumulates the cached videos", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "youtube-ata-state-"));
    tempDirs.push(dir);

    const first = await run({
      state: dir,
      searchItems: () => [hit("v2026", "2026-03-01T00:00:00Z")],
    });
    const second = await run({
      state: dir,
      searchItems: () => [hit("v2025", "2025-03-01T00:00:00Z")],
    });

    expect(first.urls.find((url) => url.includes("/search?"))).toContain(
      "publishedAfter=2026-01-01T00%3A00%3A00.000Z",
    );
    const secondSearch = second.urls.find((url) => url.includes("/search?"))!;
    expect(secondSearch).toContain(
      "publishedAfter=2025-01-01T00%3A00%3A00.000Z",
    );
    expect(secondSearch).toContain(
      "publishedBefore=2026-01-01T00%3A00%3A00.000Z",
    );

    const envelope = JSON.parse(
      await readFile(
        path.join(second.sourceDir, "irving-police-department.a1.videos.json"),
        "utf8",
      ),
    );
    expect(
      envelope.videos.map((v: { videoId: string }) => v.videoId).sort(),
    ).toEqual(["v2025", "v2026"]);
  });

  it("does not duplicate a video when an unchanged year is re-searched", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "youtube-ata-rerun-"));
    tempDirs.push(dir);
    const searchItems = () => [hit("v1", "2026-03-01T00:00:00Z")];

    await run({ state: dir, searchItems });
    const again = await run({ state: dir, searchItems });

    const envelope = JSON.parse(
      await readFile(
        path.join(again.sourceDir, "irving-police-department.a1.videos.json"),
        "utf8",
      ),
    );
    expect(envelope.videos.map((v: { videoId: string }) => v.videoId)).toEqual([
      "v1",
    ]);
  });

  it("skips an agency whose search fails, visibly, and leaves it uncached", async () => {
    const { sourceDir, logs } = await run({
      searchStatus: () => 404,
      searchItems: () => [],
    });
    expect(await envelopes(sourceDir)).toEqual([]);
    expect(logs.some((line) => line.includes("search failed, skipped"))).toBe(
      true,
    );
    expect(logs.at(-1)).toContain("1 skipped after errors");
  });

  it("stops the run on an exhausted quota and resumes next run", async () => {
    const { logs, urls } = await run({
      searchStatus: () => 403,
      agencies: [
        agency("a1", "Irving Police Department", "TX", "Irving"),
        agency("a2", "Plano Police Department", "TX", "Plano"),
      ],
    });
    // Only the first agency was searched; the second is left for the next run.
    expect(urls.filter((url) => url.includes("/search?"))).toHaveLength(1);
    expect(logs.at(-1)).toContain("stopped on quota");
  });

  it("rejects a search hit from another channel", async () => {
    const { sourceDir, logs } = await run({
      searchItems: () => [hit("vx", "2026-03-01T00:00:00Z", "UCsomeoneelse")],
    });
    // A foreign hit is an agency-level failure: nothing is stored for it.
    expect(await envelopes(sourceDir)).toEqual([]);
    expect(
      logs.some((line) => line.includes("not UCc-0YpRpqgA5lPTpSQ5uo-Q")),
    ).toBe(true);
  });
});
