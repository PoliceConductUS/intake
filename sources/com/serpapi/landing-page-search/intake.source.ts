import type { IntakeSource } from "../../../../src/cli/intake-source.js";
import { runDaily } from "./daily.js";

export const source = {
  daily: runDaily,
} satisfies IntakeSource;
