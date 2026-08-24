import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import {
  produces,
  run,
} from "../../../sources/com.youtube.donutoperator/run.js";
import {
  CHANNEL_ID,
  SUBSCRIBER_SNAPSHOT,
} from "../../../sources/com.youtube.donutoperator/channel.js";
import { buildArtifactsEnvelope } from "../../../src/cli/run/source-run.js";
import { Artifacts } from "../../../src/shared/io/index.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

function playlistItem(overrides: {
  videoId?: string;
  title?: string;
  videoPublishedAt?: string | null;
  privacyStatus?: string;
  channelId?: string;
}): Record<string, unknown> {
  return {
    snippet: {
      title: overrides.title ?? "Bodycam: traffic stop breakdown",
      channelId: overrides.channelId ?? CHANNEL_ID,
    },
    contentDetails: {
      videoId: overrides.videoId ?? "aaaaaaaaaaa",
      ...(overrides.videoPublishedAt === null
        ? {}
        : {
            videoPublishedAt:
              overrides.videoPublishedAt ?? "2026-03-04T15:00:00Z",
          }),
    },
    status: { privacyStatus: overrides.privacyStatus ?? "public" },
  };
}

async function snapshot(
  pages: Array<Array<Record<string, unknown>>>,
  channelIds: string[] = [CHANNEL_ID],
): Promise<string[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "donutoperator-"));
  tempDirs.push(dir);
  const paths: string[] = [];

  const channelPath = path.join(dir, "channel.json");
  await writeFile(
    channelPath,
    JSON.stringify({ items: channelIds.map((id) => ({ id })) }),
    "utf8",
  );
  paths.push(channelPath);

  for (const [index, items] of pages.entries()) {
    const pagePath = path.join(
      dir,
      `uploads-${String(index + 1).padStart(4, "0")}.json`,
    );
    await writeFile(pagePath, JSON.stringify({ items }), "utf8");
    paths.push(pagePath);
  }
  return paths;
}

const deps = (paths: string[]) => ({
  paths,
  readXlsx: async () => [],
  state: "/state",
  emit: async () => {},
});

describe("com.youtube.donutoperator run", () => {
  it("declares only CoverageLinks — no officer associations", () => {
    expect(produces).toEqual(["CoverageLinks"]);
  });

  it("emits one CoverageLink per public upload, keyed by video ID", async () => {
    const paths = await snapshot([
      [
        playlistItem({
          videoId: "dQw4w9WgXcQ",
          title: "Officer body camera released",
          videoPublishedAt: "2026-01-15T18:30:00Z",
        }),
      ],
      [playlistItem({ videoId: "9bZkp7q19f0", title: "Second video" })],
    ]);

    const manifest = await run(deps(paths));

    expect(manifest.artifacts).toHaveLength(1);
    const coverage = manifest.artifacts[0];
    expect(coverage.kind).toBe("CoverageLinks");
    expect(Object.keys(coverage.records).sort()).toEqual([
      "9bZkp7q19f0",
      "dQw4w9WgXcQ",
    ]);
    expect(coverage.records["dQw4w9WgXcQ"].spec).toEqual({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      normalized_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Officer body camera released",
      source_name: "Donut Operator",
      published_at: "2026-01-15T18:30:00Z",
    });
  });

  it("skips private, deleted, and incomplete playlist entries", async () => {
    const paths = await snapshot([
      [
        playlistItem({ videoId: "keeper00001" }),
        playlistItem({
          videoId: "private0001",
          title: "Private video",
          privacyStatus: "private",
        }),
        playlistItem({
          videoId: "unlisted001",
          privacyStatus: "unlisted",
        }),
        // Deleted uploads keep their slot but lose videoPublishedAt.
        playlistItem({ videoId: "deleted0001", videoPublishedAt: null }),
        playlistItem({ videoId: "", title: "No id" }),
        playlistItem({ videoId: "notitle0001", title: "" }),
      ],
    ]);

    const manifest = await run(deps(paths));

    expect(Object.keys(manifest.artifacts[0].records)).toEqual(["keeper00001"]);
  });

  it("rejects a snapshot whose channel.json is not the pinned channel", async () => {
    const paths = await snapshot([[playlistItem({})]], ["UCsomeotherchannel"]);

    await expect(run(deps(paths))).rejects.toThrow(CHANNEL_ID);
  });

  it("rejects an upload attributed to another channel", async () => {
    const paths = await snapshot([
      [playlistItem({ videoId: "foreign0001", channelId: "UCnotdonut" })],
    ]);

    await expect(run(deps(paths))).rejects.toThrow("UCnotdonut");
  });

  it("fails loudly when the snapshot has no uploads pages", async () => {
    const paths = await snapshot([]);

    await expect(run(deps(paths))).rejects.toThrow("uploads-NNNN.json");
  });

  it("is deterministic", async () => {
    const paths = await snapshot([
      [
        playlistItem({ videoId: "det000000001".slice(0, 11) }),
        playlistItem({ videoId: "det000000002".slice(0, 11) }),
      ],
    ]);

    expect(await run(deps(paths))).toEqual(await run(deps(paths)));
  });

  it("pins the board-provided rank-1 subscriber snapshot", () => {
    expect(SUBSCRIBER_SNAPSHOT).toEqual({
      rank: 1,
      subscriberCount: 5_310_000,
      retrievedOn: "2026-08-24",
    });
  });
});

describe("com.youtube.donutoperator artifacts", () => {
  it("round-trips through root intake's Artifacts read gate", async () => {
    const paths = await snapshot([
      [
        playlistItem({
          videoId: "dQw4w9WgXcQ",
          title: "Officer body camera released",
        }),
      ],
    ]);
    const manifest = await run(deps(paths));
    const outputDir = await mkdtemp(path.join(tmpdir(), "donutoperator-out-"));
    tempDirs.push(outputDir);

    const written = await Artifacts.write(
      outputDir,
      buildArtifactsEnvelope("com.youtube.donutoperator", "abc123", manifest),
    );
    // The same call root intake makes in readArtifactsStage: it parses each
    // inline record against CoverageLinkSpec and throws on any that fails.
    const read = await Artifacts.read(written.path, {
      includeKinds: ["CoverageLinks"],
    });

    expect(read.metadata.namespace).toBe("com.youtube.donutoperator");
    expect(read.spec.artifacts).toHaveLength(1);
    expect(read.spec.artifacts[0].kind).toBe("CoverageLinks");
    expect(read.spec.artifacts[0].spec.records["dQw4w9WgXcQ"]).toMatchObject({
      normalized_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      source_name: "Donut Operator",
    });
  });
});
