import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { acquire } from "../../../sources/youtube.codebluecam/acquire.js";
import { CODE_BLUE_CAM } from "../../../sources/youtube.codebluecam/channel.js";
import type { AcquireDeps } from "../../../src/cli/transform/source-transform.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  // Only the clock is faked. Faking setTimeout would deadlock the polite delay
  // between agency searches, which nothing in the test advances.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T00:00:00.000Z"));
});

type Call = { url: string };

/**
 * A fake YouTube endpoint. `channels?forHandle=…` answers with `handleResolvesTo`
 * so a renamed/transferred handle can be simulated; `search` answers with one
 * hit and records the window parameters it was called with.
 */
function stubYoutube(handleResolvesTo: string) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string): Promise<Response> => {
    const url = String(input);
    calls.push({ url });
    if (url.includes("/channels?")) {
      return json({ items: [{ id: handleResolvesTo }] });
    }
    if (url.includes("/search?")) {
      return json({
        items: [
          {
            id: { videoId: "vidAbC" },
            snippet: {
              title: "Bodycam: Irving PD",
              description: "Officer John Smith responds.",
              publishedAt: "2026-05-01T10:00:00Z",
              channelId: handleResolvesTo,
            },
          },
        ],
      });
    }
    // timedtext captions
    return new Response("", { status: 404 });
  });
  return calls;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function run(
  handleResolvesTo = CODE_BLUE_CAM.channelId,
  env: Record<string, string | undefined> = { YOUTUBE_API_KEY: "test-key" },
) {
  const root = await mkdtemp(path.join(tmpdir(), "cbc-acquire-"));
  tempDirs.push(root);
  const sourceDir = path.join(root, "source");
  const state = path.join(root, "state");
  const calls = stubYoutube(handleResolvesTo);
  const deps = {
    sourceDir,
    state,
    env,
    data: {
      agencies: async () => ({
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
    },
    logger: { info() {} },
  } as unknown as AcquireDeps;
  const result = await acquire(deps).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  return { result, calls, sourceDir, state };
}

describe("youtube.codebluecam acquire", () => {
  it("records the pinned channel id and its provenance", async () => {
    const { result, sourceDir } = await run();
    expect(result.ok).toBe(true);
    const channel = JSON.parse(
      await readFile(path.join(sourceDir, "channel.json"), "utf8"),
    );
    expect(channel.channelId).toBe("UCCKkuXux09y-TCg-BQxCjNA");
    expect(channel.handle).toBe("@CodeBlueCam");
    expect(channel.channelIdProvenance).toContain("youtube.com/@CodeBlueCam");
    expect(channel.rollingWindowYears).toBe(5);
  });

  it("refuses to ingest when the handle resolves to a different channel", async () => {
    // A handle can be renamed or transferred; ingesting another publisher's
    // videos under this source's name would publish mislabeled claims.
    const { result } = await run("UCsomeoneElsesChannel");
    expect(result.ok).toBe(false);
    expect(String((result as { error: unknown }).error)).toMatch(
      /pinned to UCCKkuXux09y-TCg-BQxCjNA/,
    );
  });

  it("bounds the channel search by the rolling five-year window", async () => {
    const { calls } = await run();
    const search = calls.find((c) => c.url.includes("/search?"));
    expect(search).toBeDefined();
    const params = new URL(search!.url).searchParams;
    expect(params.get("channelId")).toBe("UCCKkuXux09y-TCg-BQxCjNA");
    // First run searches the open (current) year, clamped to the window.
    expect(params.get("publishedAfter")).toBe("2026-01-01T00:00:00.000Z");
    expect(params.get("publishedBefore")).toBe("2027-01-01T00:00:00.000Z");
  });

  it("writes an agency envelope stamping the window, channel and retrieval time", async () => {
    const { sourceDir } = await run();
    const envelope = JSON.parse(
      await readFile(
        path.join(sourceDir, "irving-police-department.videos.json"),
        "utf8",
      ),
    );
    expect(envelope.agency.id).toBe("a1");
    expect(envelope.channel.channelId).toBe("UCCKkuXux09y-TCg-BQxCjNA");
    expect(envelope.window).toEqual({
      startAt: "2021-10-24T00:00:00.000Z",
      endAt: "2026-10-24T00:00:00.000Z",
    });
    expect(envelope.videos).toHaveLength(1);
    // The canonical URL is rebuilt from the id, preserving its case.
    expect(envelope.videos[0].url).toBe(
      "https://www.youtube.com/watch?v=vidAbC",
    );
    expect(envelope.videos[0].retrievedAt).toBe("2026-10-24T00:00:00.000Z");
    // No video media is stored — only metadata and the link.
    expect(Object.keys(envelope.videos[0]).sort()).toEqual([
      "captions",
      "channelId",
      "description",
      "publishedAt",
      "retrievedAt",
      "title",
      "url",
      "videoId",
    ]);
  });

  it("requires YOUTUBE_API_KEY", async () => {
    const { result } = await run(CODE_BLUE_CAM.channelId, {});
    expect(result.ok).toBe(false);
    expect(String((result as { error: unknown }).error)).toMatch(
      /YOUTUBE_API_KEY is required/,
    );
  });
});
