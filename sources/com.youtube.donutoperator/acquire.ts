import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";
import {
  CHANNEL_DISPLAY_NAME,
  CHANNEL_HANDLE,
  CHANNEL_ID,
  CHANNEL_URL,
  SUBSCRIBER_SNAPSHOT,
} from "./channel.js";

/**
 * Acquired through the YouTube Data API v3 — the access channel YouTube
 * sanctions for this data. This source does not scrape youtube.com, does not
 * touch pages the site's robots.txt disallows, and does not work around the
 * API's quota.
 */
const API = "https://www.googleapis.com/youtube/v3";
const PAGE_SIZE = 50;
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60_000;

export const description =
  "Downloads the Donut Operator channel record and every uploads playlist page from the YouTube Data API v3, preserved as raw JSON.";

type ApiResponse = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function first(response: ApiResponse): Record<string, unknown> | undefined {
  const list = Array.isArray(response.items) ? response.items : [];
  return list.length === 1 ? (list[0] as Record<string, unknown>) : undefined;
}

function pageFileName(pageNumber: number): string {
  return `uploads-${String(pageNumber).padStart(4, "0")}.json`;
}

function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries throttling (429) and transient server errors (5xx) with capped
 * exponential backoff. A 403 is *not* retried: the YouTube API returns it for
 * quota exhaustion and for a bad key, and retrying either one is just hammering
 * a door that will not open until a human acts.
 */
async function fetchJson(url: string): Promise<ApiResponse> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      return (await response.json()) as ApiResponse;
    }
    const body = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error(
        `com.youtube.donutoperator: YouTube API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
      );
    }
    await sleep(backoffMs(attempt));
  }
}

function withKey(
  pathname: string,
  params: Record<string, string>,
  key: string,
): string {
  const search = new URLSearchParams({ ...params, key });
  return `${API}/${pathname}?${search.toString()}`;
}

export const acquire: SourceAcquire = async ({
  sourceDir,
  env,
  logger,
}: AcquireDeps) => {
  const log = logger ?? { info() {} };
  const apiKey = str(env.YOUTUBE_API_KEY);
  if (apiKey === "") {
    throw new Error(
      "com.youtube.donutoperator: YOUTUBE_API_KEY is required to read the YouTube Data API v3.",
    );
  }
  await mkdir(sourceDir, { recursive: true });

  // Resolve by channel ID, never by handle or title search: the ID is the only
  // identifier YouTube guarantees is stable for the life of the channel.
  const channelResponse = await fetchJson(
    withKey(
      "channels",
      { part: "snippet,contentDetails,statistics", id: CHANNEL_ID },
      apiKey,
    ),
  );
  const channel = first(channelResponse);
  if (channel === undefined || str(channel.id) !== CHANNEL_ID) {
    throw new Error(
      `com.youtube.donutoperator: channels.list did not return exactly channel ${CHANNEL_ID}.`,
    );
  }
  await writeFile(
    path.join(sourceDir, "channel.json"),
    JSON.stringify(channelResponse, null, 2),
    "utf8",
  );

  const snippet = (channel.snippet ?? {}) as Record<string, unknown>;
  const statistics = (channel.statistics ?? {}) as Record<string, unknown>;
  const observedHandle = str(snippet.customUrl);
  const observedTitle = str(snippet.title);
  // A renamed handle or title is drift worth seeing, not a failure: identity is
  // the channel ID, and ingestion must not break because a label moved.
  if (observedHandle.toLowerCase() !== CHANNEL_HANDLE.toLowerCase()) {
    log.info(
      `com.youtube.donutoperator: handle drift — pinned ${CHANNEL_HANDLE}, channel now reports ${observedHandle || "(none)"}.`,
    );
  }
  if (observedTitle !== CHANNEL_DISPLAY_NAME) {
    log.info(
      `com.youtube.donutoperator: display-name drift — pinned "${CHANNEL_DISPLAY_NAME}", channel now reports "${observedTitle}".`,
    );
  }

  const relatedPlaylists = (
    (channel.contentDetails ?? {}) as Record<string, unknown>
  ).relatedPlaylists as Record<string, unknown> | undefined;
  const uploadsPlaylistId = str(relatedPlaylists?.uploads);
  if (uploadsPlaylistId === "") {
    throw new Error(
      `com.youtube.donutoperator: channel ${CHANNEL_ID} has no contentDetails.relatedPlaylists.uploads.`,
    );
  }

  let pageToken = "";
  let pageNumber = 0;
  let itemCount = 0;
  do {
    pageNumber += 1;
    const page = await fetchJson(
      withKey(
        "playlistItems",
        {
          part: "snippet,contentDetails,status",
          playlistId: uploadsPlaylistId,
          maxResults: String(PAGE_SIZE),
          ...(pageToken === "" ? {} : { pageToken }),
        },
        apiKey,
      ),
    );
    await writeFile(
      path.join(sourceDir, pageFileName(pageNumber)),
      JSON.stringify(page, null, 2),
      "utf8",
    );
    itemCount += Array.isArray(page.items) ? page.items.length : 0;
    pageToken = str(page.nextPageToken);
  } while (pageToken !== "");

  const retrievedAt = new Date().toISOString();
  await writeFile(
    path.join(sourceDir, "provenance.json"),
    JSON.stringify(
      {
        channelId: CHANNEL_ID,
        pinnedHandle: CHANNEL_HANDLE,
        pinnedDisplayName: CHANNEL_DISPLAY_NAME,
        channelUrl: CHANNEL_URL,
        observedHandle,
        observedTitle,
        uploadsPlaylistId,
        // YouTube rounds subscriberCount to three significant figures; this is
        // ordering evidence for the intake-source queue, not a measurement.
        observedSubscriberCount: str(statistics.subscriberCount),
        boardSubscriberSnapshot: SUBSCRIBER_SNAPSHOT,
        accessMethod: "YouTube Data API v3 (channels.list, playlistItems.list)",
        retrievedAt,
        pages: pageNumber,
        items: itemCount,
      },
      null,
      2,
    ),
    "utf8",
  );

  log.info(
    `com.youtube.donutoperator: acquired ${itemCount} playlist item(s) across ${pageNumber} page(s) at ${retrievedAt}`,
  );
};
