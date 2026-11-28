import type { IntakeSource } from "../../../../../src/cli/intake-source.js";
import { acquire } from "./acquire.js";
import { transform } from "./transform.js";

export const source = {
  description:
    "US Census Gazetteer + TIGER — the canonical location-path tree (state/county/place, including local jurisdictions) with geometry; runs first so other sources resolve against it (ADR 0015).",
  produces: ["LocationPaths", "LocationPathAliases", "LocationPathGeometries"],
  acquire,
  transform,
} satisfies IntakeSource;
