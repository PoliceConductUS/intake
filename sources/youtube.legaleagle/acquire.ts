import { createChannelAcquire } from "../lib/youtube-rolling-channel.js";
import { config } from "./config.js";

export const acquire = createChannelAcquire(config);
