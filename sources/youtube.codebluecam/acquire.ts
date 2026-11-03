import type { SourceAcquire } from "../../src/cli/transform/source-transform.js";
import { createChannelAcquire } from "../lib/youtube-channel.js";
import { CODE_BLUE_CAM } from "./channel.js";

export const acquire: SourceAcquire = createChannelAcquire(CODE_BLUE_CAM);
