import type { IntakeSource } from "../../../../src/cli/intake-source.js";
import { acquire } from "./acquire.js";
import { transform } from "./transform.js";

export const source = {
  description:
    "PoliceActivity (YouTube) — videos found by searching the channel per agency, linked to any officer at that agency the video names (resolved via the fuzzy agency_personnel resolver, ADR 0022/0023). The channel's framing is an attributed claim; only the resolved officer link is a fact, cited to the naming passage. Each run considers only the rolling five-year window its evidence was acquired under.",
  produces: ["CoverageLinks", "CoverageLinkAgencyPersonnel"],
  acquire,
  transform,
} satisfies IntakeSource;
