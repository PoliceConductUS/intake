import {
  CHANNEL_SOURCE_PRODUCES,
  createChannelTransform,
} from "../lib/youtube-channel.js";
import { config } from "./config.js";

export const produces = CHANNEL_SOURCE_PRODUCES;

export const description =
  "LegalEagle (YouTube) — videos found by searching the channel per agency within a rolling five-year window, linked to any officer at that agency the video names (resolved via the fuzzy agency_personnel resolver, ADR 0022/0023). The channel's framing is an attributed claim; only the resolved officer link is a fact, cited to the naming passage. Links only — no video media is stored.";

export const transform = createChannelTransform(config);
