import { createChannelTransform } from "../lib/youtube-channel.js";
import { CODE_BLUE_CAM } from "./channel.js";

const channel = createChannelTransform(CODE_BLUE_CAM);

export const produces = channel.produces;
export const transform = channel.transform;

export const description =
  "Code Blue Cam (YouTube) — videos published in the rolling five-year window, " +
  "found by searching the channel per agency and linked to any officer at that " +
  "agency the video names (resolved via the fuzzy agency_personnel resolver, " +
  "ADR 0022/0023). No video media is ingested, only links. The channel's framing " +
  "is an attributed claim; only the resolved officer link is a fact, cited to the " +
  "naming passage. A video that matches no existing officer is skipped and " +
  "reconsidered on every later run while it stays in the window.";
