import type { ChannelSourceConfig } from "../lib/youtube-channel.js";

/**
 * Code Blue Cam — board-ranked #3 of the six accountability channels (#52).
 *
 * The channel id is pinned, not discovered. `@CodeBlueCam` is a mutable handle;
 * `UCCKkuXux09y-TCg-BQxCjNA` is the channel's permanent id. Acquire resolves the
 * handle each run and refuses to ingest if it no longer points here.
 */
export const CODE_BLUE_CAM: ChannelSourceConfig = {
  namespace: "youtube.codebluecam",
  sourceName: "Code Blue Cam",
  channelHandle: "@CodeBlueCam",
  channelId: "UCCKkuXux09y-TCg-BQxCjNA",
  channelIdProvenance:
    "read from the `externalId` field of https://www.youtube.com/@CodeBlueCam " +
    '(page title "Code Blue Cam - YouTube"), retrieved 2026-10-24; corroborated ' +
    "by the canonical /channel/UCCKkuXux09y-TCg-BQxCjNA links on that page",
};
