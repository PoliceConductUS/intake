import type { ChannelSourceConfig } from "../lib/youtube-channel.js";

// LegalEagle — rank 6 of the board's subscriber-ordered YouTube intake queue
// (INS-52). The board gave the channel as https://www.youtube.com/c/LegalEagle;
// acquire resolves the handle to the immutable channel id at run time and
// records it in channel.json, rather than pinning an id this repo cannot verify
// until YOUTUBE_API_KEY is provisioned (INS-53).
export const config: ChannelSourceConfig = {
  namespace: "youtube.legaleagle",
  handle: "@LegalEagle",
  sourceName: "LegalEagle",
  windowYears: 5,
};
