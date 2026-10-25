import type { ChannelSourceConfig } from "../lib/youtube-channel.js";

// LegalEagle — rank 6 of the board's subscriber-ordered YouTube intake queue
// (INS-52).
//
// Channel id resolved 2026-10-24 and pinned, not looked up from the handle: a
// handle can be renamed or transferred to a different channel, which would
// silently re-point this source at someone else's videos.
//
// The board gave the channel as https://www.youtube.com/c/LegalEagle, a legacy
// `/c/` custom URL rather than a handle. Both that URL and
// https://www.youtube.com/@LegalEagle carry
// `<link rel="canonical" href="https://www.youtube.com/channel/UCpa-Zb0ZcQjTCPP1Dx_1M8Q">`
// and `"externalId":"UCpa-Zb0ZcQjTCPP1Dx_1M8Q"`, both titled "LegalEagle" — so
// the two URLs are confirmed to be the same channel. (Channel pages are outside
// the `Disallow: /api/` prefix in youtube.com/robots.txt; the caption endpoint
// is not, which is why this source reads no captions.)
export const config: ChannelSourceConfig = {
  namespace: "youtube.legaleagle",
  channelId: "UCpa-Zb0ZcQjTCPP1Dx_1M8Q",
  handle: "@LegalEagle",
  sourceName: "LegalEagle",
  windowYears: 5,
};
