import type { IntakeSource } from "../../../../src/cli/intake-source.js";
import { acquire } from "./acquire.js";
import { transform } from "./transform.js";

export const source = {
  description:
    "Washington Post Fatal Force v2 — source-attributed fatal shooting and reported agency records, staged privately.",
  produces: ["FatalShootings", "FatalShootingAgencies"],
  acquire,
  transform,
} satisfies IntakeSource;
