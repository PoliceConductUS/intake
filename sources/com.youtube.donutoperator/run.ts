import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  RunDeps,
  SourceRun,
} from "../../src/cli/run/source-run.js";
import { CHANNEL_DISPLAY_NAME, CHANNEL_ID, watchUrl } from "./channel.js";

export const produces: readonly ImportArtifactKind[] = ["CoverageLinks"];

/**
 * Donut Operator uploads → one CoverageLink per public video, keyed by the
 * YouTube video ID.
 *
 * This source catalogs media. It deliberately emits no
 * `CoverageLinkAgencyOfficers`: attaching a video to a named officer would mean
 * matching a person out of a video title or description, and this source has no
 * stable officer identifier to match on. Linking coverage to named personnel is
 * a separate, reviewed decision — not a byproduct of ingesting a channel.
 *
 * Deterministic: reads only the preserved acquire snapshot, no network, clock,
 * or randomness.
 */
export const description =
  "Donut Operator (YouTube @DonutOperator) — CoverageLink per public upload, keyed by video ID. Media catalog only; emits no officer associations.";

type PlaylistItem = {
  snippet?: {
    title?: unknown;
    channelId?: unknown;
  };
  contentDetails?: {
    videoId?: unknown;
    videoPublishedAt?: unknown;
  };
  status?: {
    privacyStatus?: unknown;
  };
};

type PlaylistItemsPage = { items?: unknown };
type ChannelsResponse = { items?: unknown };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function items(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * The acquired `channel.json` must be the pinned channel. Re-checking here (and
 * not only in acquire) means the identity guarantee survives replaying an
 * archived snapshot, where acquire never runs.
 */
async function assertPinnedChannel(channelPath: string): Promise<void> {
  const response = JSON.parse(
    await readFile(channelPath, "utf8"),
  ) as ChannelsResponse;
  const ids = items(response.items).map((item) => text(item.id));
  if (ids.length !== 1 || ids[0] !== CHANNEL_ID) {
    throw new Error(
      `com.youtube.donutoperator: ${path.basename(channelPath)} must describe exactly ` +
        `channel ${CHANNEL_ID}, found [${ids.join(", ")}].`,
    );
  }
}

export const run: SourceRun = async ({ paths, logger }: RunDeps) => {
  const log = logger ?? { info() {} };
  const channelPaths = paths.filter(
    (file) => path.basename(file) === "channel.json",
  );
  if (channelPaths.length !== 1) {
    throw new Error(
      `com.youtube.donutoperator: expected exactly one channel.json in the acquire ` +
        `snapshot, found ${channelPaths.length}.`,
    );
  }
  await assertPinnedChannel(channelPaths[0]);

  const uploadPaths = paths
    .filter((file) => /^uploads-\d+\.json$/.test(path.basename(file)))
    .sort();
  if (uploadPaths.length === 0) {
    throw new Error(
      "com.youtube.donutoperator: acquire snapshot has no uploads-NNNN.json pages.",
    );
  }

  const records: EmittedRecords = {};
  let nonPublic = 0;
  let unusable = 0;

  for (const uploadPath of uploadPaths) {
    const page = JSON.parse(
      await readFile(uploadPath, "utf8"),
    ) as PlaylistItemsPage;
    for (const raw of items(page.items)) {
      const item = raw as PlaylistItem;
      const videoId = text(item.contentDetails?.videoId);
      const title = text(item.snippet?.title);
      const publishedAt = text(item.contentDetails?.videoPublishedAt);
      const privacyStatus = text(item.status?.privacyStatus);
      const channelId = text(item.snippet?.channelId);

      // Private and deleted uploads stay in the playlist as placeholders whose
      // title is literally "Private video" / "Deleted video". Publishing those
      // as coverage would assert a video that no one can open.
      if (privacyStatus !== "public") {
        nonPublic += 1;
        continue;
      }
      if (videoId === "" || title === "" || publishedAt === "") {
        unusable += 1;
        continue;
      }
      // An upload attributed to another channel does not belong in this
      // namespace's identity space; a mixed page means the snapshot is wrong.
      if (channelId !== CHANNEL_ID) {
        throw new Error(
          `com.youtube.donutoperator: video ${videoId} in ${path.basename(uploadPath)} ` +
            `is attributed to channel ${channelId || "(none)"}, not ${CHANNEL_ID}.`,
        );
      }

      const url = watchUrl(videoId);
      records[videoId] = {
        spec: {
          url,
          // Built from the video ID, so it is already the canonical form —
          // no share links, playlist context, or tracking parameters to strip.
          normalized_url: url,
          title,
          source_name: CHANNEL_DISPLAY_NAME,
          published_at: publishedAt,
        },
      };
    }
  }

  log.info(
    `com.youtube.donutoperator: ${Object.keys(records).length} public uploads ` +
      `(${nonPublic} private/deleted, ${unusable} missing id/title/publish date) ` +
      `from ${uploadPaths.length} page(s)`,
  );

  return { artifacts: [{ kind: "CoverageLinks", records }] };
};
