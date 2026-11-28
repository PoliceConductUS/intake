import type { IntakeSource } from "../../../../src/cli/intake-source.js";
import { dailyDeps, runDaily } from "./daily.js";

export const source = {
  daily: (env) => runDaily(undefined, dailyDeps(env)),
} satisfies IntakeSource;
