import { createChannelAcquire } from "../lib/youtube-channel.js";
import { config } from "./config.js";

export const acquire = createChannelAcquire(config);
