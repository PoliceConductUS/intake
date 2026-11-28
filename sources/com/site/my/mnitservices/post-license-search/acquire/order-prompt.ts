import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ORDER_ANALYSIS_INSTRUCTIONS = readFileSync(
  new URL("./order-analysis-prompt.txt", import.meta.url),
  "utf8",
);
export const ORDER_ANALYSIS_PROMPT_SHA256 = createHash("sha256")
  .update(ORDER_ANALYSIS_INSTRUCTIONS)
  .digest("hex");
